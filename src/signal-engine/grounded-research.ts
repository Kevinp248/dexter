import { exaSearch } from '../tools/search/exa.js';
import { perplexitySearch } from '../tools/search/perplexity.js';
import { tavilySearch } from '../tools/search/tavily.js';

export const TRUSTED_SOURCE_DOMAINS = [
  'sec.gov',
  'www.sec.gov',
  'sedarplus.ca',
  'www.sedarplus.ca',
  'investor.apple.com',
  'investor.microsoft.com',
  'www.nasdaq.com',
  'www.nyse.com',
  'www.theglobeandmail.com',
  'www.reuters.com',
  'www.bloomberg.com',
  'www.wsj.com',
] as const;

export type TrustTier = 'tier1' | 'rejected';

export interface EvidenceReference {
  source: string;
  url: string;
  snippet: string;
}

export interface EvidenceItem {
  claim: string;
  source: string;
  url: string;
  retrievedAt: string;
  trustTier: TrustTier;
  snippet: string;
}

export interface EvidenceBundle {
  claim: string;
  retrievedAt: string;
  accepted: EvidenceItem[];
  rejected: EvidenceItem[];
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isTrustedSourceUrl(url: string): boolean {
  const host = normalizeHost(url);
  if (!host) return false;
  return TRUSTED_SOURCE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function formatEvidenceBundle(
  claim: string,
  references: EvidenceReference[],
  retrievedAt = new Date().toISOString(),
): EvidenceBundle {
  const accepted: EvidenceItem[] = [];
  const rejected: EvidenceItem[] = [];

  for (const reference of references) {
    const tier: TrustTier = isTrustedSourceUrl(reference.url) ? 'tier1' : 'rejected';
    const item: EvidenceItem = {
      claim,
      source: reference.source,
      url: reference.url,
      retrievedAt,
      trustTier: tier,
      snippet: reference.snippet,
    };
    if (tier === 'tier1') accepted.push(item);
    else rejected.push(item);
  }

  return {
    claim,
    retrievedAt,
    accepted,
    rejected,
  };
}

function normalizeSearchResults(raw: unknown): EvidenceReference[] {
  if (!raw || typeof raw !== 'object') return [];
  const candidateRows = (raw as { data?: { results?: unknown[] } }).data?.results;
  if (!Array.isArray(candidateRows)) return [];
  const out: EvidenceReference[] = [];
  for (const row of candidateRows) {
    if (!row || typeof row !== 'object') continue;
    const source = String((row as { title?: unknown }).title ?? 'Unknown');
    const url = String((row as { url?: unknown }).url ?? '');
    if (!url) continue;
    const snippet = String((row as { snippet?: unknown }).snippet ?? '');
    out.push({ source, url, snippet });
  }
  return out;
}

export async function runGroundedSearch(
  query: string,
): Promise<EvidenceReference[]> {
  const input = { query };
  if (process.env.PERPLEXITY_API_KEY) {
    return normalizeSearchResults(await perplexitySearch.invoke(input));
  }
  if (process.env.EXASEARCH_API_KEY) {
    return normalizeSearchResults(await exaSearch.invoke(input));
  }
  if (process.env.TAVILY_API_KEY) {
    return normalizeSearchResults(await tavilySearch.invoke(input));
  }
  return [];
}
