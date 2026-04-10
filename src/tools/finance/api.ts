import { readCache, writeCache, describeRequest } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dexterPath } from '../../utils/paths.js';

const BASE_URL = 'https://api.financialdatasets.ai';

export interface ApiResponse {
  data: Record<string, unknown>;
  url: string;
}

type ApiUsageCounter = {
  endpoint: string;
  calls: number;
};

type ApiUsageState = {
  totalCalls: number;
  perEndpoint: Map<string, number>;
};

const apiUsageState: ApiUsageState = {
  totalCalls: 0,
  perEndpoint: new Map<string, number>(),
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getMaxCallsPerRun(): number {
  return parsePositiveInt(process.env.FINANCIAL_DATASETS_MAX_CALLS_PER_RUN, 500);
}

function getMaxCallsPerEndpointPerRun(): number {
  return parsePositiveInt(process.env.FINANCIAL_DATASETS_MAX_CALLS_PER_ENDPOINT_PER_RUN, 250);
}

function offlineReplayEnabled(): boolean {
  const value = (process.env.FINANCIAL_DATASETS_OFFLINE_REPLAY ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function incrementUsage(endpoint: string): void {
  const normalized = endpoint.split('?')[0];
  const totalLimit = getMaxCallsPerRun();
  const perEndpointLimit = getMaxCallsPerEndpointPerRun();
  const endpointCalls = (apiUsageState.perEndpoint.get(normalized) ?? 0) + 1;
  const totalCalls = apiUsageState.totalCalls + 1;

  if (totalCalls > totalLimit) {
    throw new Error(
      `[Financial Datasets API] call budget exceeded: ${totalCalls}/${totalLimit} requests in this run.`,
    );
  }
  if (endpointCalls > perEndpointLimit) {
    throw new Error(
      `[Financial Datasets API] endpoint budget exceeded for ${normalized}: ${endpointCalls}/${perEndpointLimit} in this run.`,
    );
  }

  apiUsageState.totalCalls = totalCalls;
  apiUsageState.perEndpoint.set(normalized, endpointCalls);
}

function buildUsageSnapshot(): { totalCalls: number; endpoints: ApiUsageCounter[] } {
  const endpoints = Array.from(apiUsageState.perEndpoint.entries())
    .map(([endpoint, calls]) => ({ endpoint, calls }))
    .sort((a, b) => b.calls - a.calls);
  return {
    totalCalls: apiUsageState.totalCalls,
    endpoints,
  };
}

export function getApiUsageSnapshot(): { totalCalls: number; endpoints: ApiUsageCounter[] } {
  return buildUsageSnapshot();
}

export function resetApiUsageCounters(): void {
  apiUsageState.totalCalls = 0;
  apiUsageState.perEndpoint.clear();
}

export function writeApiUsageReport(label: string): string {
  const baseDir = dexterPath('signal-engine', 'reports');
  mkdirSync(baseDir, { recursive: true });
  const target = path.join(baseDir, `api-usage-${label}.json`);
  writeFileSync(
    target,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        limits: {
          maxCallsPerRun: getMaxCallsPerRun(),
          maxCallsPerEndpointPerRun: getMaxCallsPerEndpointPerRun(),
        },
        usage: buildUsageSnapshot(),
      },
      null,
      2,
    ),
    'utf8',
  );
  return target;
}

/**
 * Remove redundant fields from API payloads before they are returned to the LLM.
 * This reduces token usage while preserving the financial metrics needed for analysis.
 */
export function stripFieldsDeep(value: unknown, fields: readonly string[]): unknown {
  const fieldsToStrip = new Set(fields);

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!node || typeof node !== 'object') {
      return node;
    }

    const record = node as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      if (fieldsToStrip.has(key)) {
        continue;
      }
      cleaned[key] = walk(child);
    }

    return cleaned;
  }

  return walk(value);
}

function getApiKey(): string {
  return process.env.FINANCIAL_DATASETS_API_KEY || '';
}

/**
 * Shared request execution: handles API key, error handling, logging, and response parsing.
 */
async function executeRequest(
  url: string,
  endpoint: string,
  label: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();

  if (!apiKey) {
    logger.warn(`[Financial Datasets API] call without key: ${label}`);
  }

  let response: Response;
  try {
    incrementUsage(endpoint);
    response = await fetch(url, {
      ...init,
      headers: {
        'x-api-key': apiKey,
        ...init.headers,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Financial Datasets API] network error: ${label} — ${message}`);
    throw new Error(`[Financial Datasets API] request failed for ${label}: ${message}`);
  }

  if (!response.ok) {
    const detail = `${response.status} ${response.statusText}`;
    logger.error(`[Financial Datasets API] error: ${label} — ${detail}`);
    throw new Error(`[Financial Datasets API] request failed: ${detail}`);
  }

  const data = await response.json().catch(() => {
    const detail = `invalid JSON (${response.status} ${response.statusText})`;
    logger.error(`[Financial Datasets API] parse error: ${label} — ${detail}`);
    throw new Error(`[Financial Datasets API] request failed: ${detail}`);
  });

  return data as Record<string, unknown>;
}

export const api = {
  async get(
    endpoint: string,
    params: Record<string, string | number | string[] | undefined>,
    options?: { cacheable?: boolean; ttlMs?: number },
  ): Promise<ApiResponse> {
    const label = describeRequest(endpoint, params);

    // Check local cache first — avoids redundant network calls for immutable data
    if (options?.cacheable) {
      const cached = readCache(endpoint, params, options.ttlMs);
      if (cached) {
        return cached;
      }
      if (offlineReplayEnabled()) {
        throw new Error(
          `[Financial Datasets API] offline replay enabled and cache miss for ${label}.`,
        );
      }
    } else if (offlineReplayEnabled()) {
      throw new Error(
        `[Financial Datasets API] offline replay enabled but uncached endpoint requested: ${label}.`,
      );
    }

    const url = new URL(`${BASE_URL}${endpoint}`);

    // Add params to URL, handling arrays
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, v));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const data = await executeRequest(url.toString(), endpoint, label, {});

    // Persist for future requests when the caller marked the response as cacheable
    if (options?.cacheable) {
      writeCache(endpoint, params, data, url.toString());
    }

    return { data, url: url.toString() };
  },

  async post(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<ApiResponse> {
    const label = `POST ${endpoint}`;
    const url = `${BASE_URL}${endpoint}`;

    const data = await executeRequest(url, endpoint, label, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { data, url };
  },
};

/** @deprecated Use `api.get` instead */
export const callApi = api.get;
