import { fetchCompanyNews } from '../../data/market.js';
import { AnalysisContext } from './types.js';

type SentimentProviderKind =
  | 'structured_news'
  | 'llm_headline'
  | 'neutral_fallback';

type SentimentEvidence = {
  title: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  score: number;
  confidence: number;
  relevance: number;
  weight: number;
  method: 'structured' | 'llm';
};

type ScoredArticle = {
  id: string;
  title: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  score: number | null;
  confidence: number;
  relevance: number;
  isRelevant: boolean;
};

export interface SentimentSignal {
  ticker: string;
  score: number;
  summary: string;
  positive: number;
  negative: number;
  provider: SentimentProviderKind;
  articleCount: number;
  usedArticleCount: number;
  ignoredArticleCount: number;
  pitAvailabilityMissing: boolean;
  evidence: SentimentEvidence[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function daysBefore(date: string, days: number): string {
  const dt = new Date(date);
  dt.setDate(dt.getDate() - days);
  return dt.toISOString().slice(0, 10);
}

function parseLabelScore(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['very_positive', 'strong_positive', 'positive', 'bullish'].includes(normalized))
    return 0.8;
  if (['slightly_positive'].includes(normalized)) return 0.35;
  if (['very_negative', 'strong_negative', 'negative', 'bearish'].includes(normalized))
    return -0.8;
  if (['slightly_negative'].includes(normalized)) return -0.35;
  if (['neutral', 'mixed'].includes(normalized)) return 0;
  return null;
}

function parseScore(article: Record<string, unknown>): number | null {
  const numericKeys = [
    'sentiment_score',
    'sentimentScore',
    'overall_sentiment_score',
    'news_sentiment_score',
    'polarity',
  ];
  for (const key of numericKeys) {
    const value = article[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (Math.abs(value) > 1.5) {
        return clamp(value / 100, -1, 1);
      }
      return clamp(value, -1, 1);
    }
  }

  const labelKeys = ['sentiment', 'sentiment_label', 'overall_sentiment_label', 'tone'];
  for (const key of labelKeys) {
    const parsed = parseLabelScore(article[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseConfidence(article: Record<string, unknown>): number {
  const raw = article.sentiment_confidence ?? article.confidence ?? article.relevance_confidence;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1) return clamp(raw / 100, 0, 1);
    return clamp(raw, 0, 1);
  }
  return 0.6;
}

function parseRelevance(article: Record<string, unknown>): number | null {
  const raw = article.relevance_score ?? article.relevance ?? article.ticker_relevance;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1) return clamp(raw / 100, 0, 1);
    return clamp(raw, 0, 1);
  }
  return null;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isRelevantHeadline(
  title: string,
  ticker: string,
  companyName?: string,
  relevanceHint?: number | null,
): { isRelevant: boolean; relevance: number } {
  if (relevanceHint !== null && relevanceHint !== undefined) {
    return {
      isRelevant: relevanceHint >= 0.35,
      relevance: clamp(relevanceHint, 0.1, 1),
    };
  }

  const normalizedTitle = normalizeText(title);
  const tickerHit = normalizedTitle.includes(ticker.toLowerCase());
  const companyTerms =
    companyName
      ?.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4) ?? [];
  const companyHit = companyTerms.some((term) => normalizedTitle.includes(term));
  if (tickerHit || companyHit) {
    return { isRelevant: true, relevance: 0.75 };
  }
  return { isRelevant: false, relevance: 0.2 };
}

function recencyWeight(publishedAt: string | null, endDate?: string): number {
  if (!publishedAt || !endDate) return 0.7;
  const published = Date.parse(`${publishedAt}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(published) || !Number.isFinite(end)) return 0.7;
  const ageDays = Math.max((end - published) / (24 * 60 * 60 * 1000), 0);
  return clamp(Math.exp(-ageDays / 5), 0.2, 1);
}

function dedupeArticles(rows: ScoredArticle[]): ScoredArticle[] {
  const seen = new Set<string>();
  const out: ScoredArticle[] = [];
  for (const row of rows) {
    const key = row.url ? normalizeText(row.url) : normalizeText(row.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function classifyWithLlm(
  ticker: string,
  companyName: string | undefined,
  rows: ScoredArticle[],
): Promise<Map<string, { score: number; relevance: number; confidence: number }>> {
  const [{ callLlm }, { z }] = await Promise.all([
    import('../../model/llm.js'),
    import('zod'),
  ]);
  const llmSentimentSchema = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        score: z.number().min(-1).max(1),
        relevance: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      }),
    ),
  });

  const promptRows = rows.slice(0, 6).map((row) => ({
    id: row.id,
    title: row.title,
    source: row.source,
    publishedAt: row.publishedAt,
  }));
  if (!promptRows.length) return new Map();

  const prompt = [
    'Classify each finance headline for company-specific sentiment.',
    `Ticker: ${ticker}`,
    `Company: ${companyName ?? ticker}`,
    'Return structured values only: score [-1..1], relevance [0..1], confidence [0..1].',
    'Ignore macro headlines not specific to the company.',
    JSON.stringify(promptRows),
  ].join('\n');

  const response = await callLlm(prompt, {
    model: process.env.SIGNAL_SENTIMENT_LLM_MODEL ?? 'claude-sonnet-4-5',
    outputSchema: llmSentimentSchema,
  });
  const parsed = llmSentimentSchema.parse(response.response);
  const mapped = new Map<string, { score: number; relevance: number; confidence: number }>();
  for (const item of parsed.items) {
    mapped.set(item.id, {
      score: clamp(item.score, -1, 1),
      relevance: clamp(item.relevance, 0, 1),
      confidence: clamp(item.confidence, 0, 1),
    });
  }
  return mapped;
}

function parseArticle(
  article: Record<string, unknown>,
  ticker: string,
  companyName: string | undefined,
): ScoredArticle {
  const title = String(article.title ?? article.headline ?? '').trim();
  const urlRaw = article.url ?? article.link ?? article.article_url;
  const url = typeof urlRaw === 'string' && urlRaw.trim().length > 0 ? urlRaw.trim() : null;
  const publishedAt = toDateOnly(
    article.publish_date ??
      article.published_at ??
      article.datetime ??
      article.date ??
      article.created_at,
  );
  const relevanceHint = parseRelevance(article);
  const relevance = isRelevantHeadline(title, ticker, companyName, relevanceHint);
  return {
    id: url ?? normalizeText(title),
    title,
    source: String(article.source ?? article.publisher ?? 'unknown'),
    url,
    publishedAt,
    score: parseScore(article),
    confidence: parseConfidence(article),
    relevance: relevance.relevance,
    isRelevant: relevance.isRelevant,
  };
}

function aggregateEvidence(
  rows: Array<ScoredArticle & { score: number; method: SentimentEvidence['method'] }>,
  endDate?: string,
): {
  score: number;
  evidence: SentimentEvidence[];
  positive: number;
  negative: number;
} {
  const evidence: SentimentEvidence[] = rows.map((row) => {
    const weight =
      clamp(row.confidence, 0.1, 1) *
      clamp(row.relevance, 0.1, 1) *
      recencyWeight(row.publishedAt, endDate);
    return {
      title: row.title,
      source: row.source,
      url: row.url,
      publishedAt: row.publishedAt,
      score: row.score,
      confidence: row.confidence,
      relevance: row.relevance,
      weight,
      method: row.method,
    };
  });
  const totalWeight = evidence.reduce((sum, row) => sum + row.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? evidence.reduce((sum, row) => sum + row.score * row.weight, 0) / totalWeight
      : 0;

  const positive = evidence.filter((row) => row.score >= 0.15).length;
  const negative = evidence.filter((row) => row.score <= -0.15).length;
  return {
    score: clamp(weightedScore, -1, 1),
    evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 5),
    positive,
    negative,
  };
}

export async function runSentimentAnalysis(
  ticker: string,
  context: AnalysisContext = {},
): Promise<SentimentSignal> {
  const endDate = context.asOfDate ?? context.endDate;
  const startDate = endDate ? daysBefore(endDate, 10) : undefined;
  const rawArticles = await fetchCompanyNews(ticker, 10, { startDate, endDate, asOfDate: context.asOfDate });
  const pitAvailabilityMissing = rawArticles.some(
    (article) =>
      article &&
      typeof article === 'object' &&
      Boolean((article as Record<string, unknown>).__pitMissingAvailability),
  );

  const parsed = dedupeArticles(
    rawArticles
      .filter((article): article is Record<string, unknown> => article && typeof article === 'object')
      .map((article) => parseArticle(article, ticker, context.companyName)),
  );
  const relevant = parsed.filter((row) => row.isRelevant && row.title.length > 0);

  const structuredRows = relevant
    .filter((row): row is ScoredArticle & { score: number } => row.score !== null)
    .map((row) => ({ ...row, method: 'structured' as const }));

  let provider: SentimentProviderKind = 'neutral_fallback';
  let scoredRows: Array<ScoredArticle & { score: number; method: SentimentEvidence['method'] }> =
    structuredRows;

  if (structuredRows.length > 0) {
    provider = 'structured_news';
  } else if (
    (process.env.SIGNAL_SENTIMENT_LLM_FALLBACK ?? '').toLowerCase() === 'true' ||
    process.env.SIGNAL_SENTIMENT_LLM_FALLBACK === '1'
  ) {
    try {
      const llmMap = await classifyWithLlm(ticker, context.companyName, relevant);
      scoredRows = relevant
        .map((row) => {
          const llm = llmMap.get(row.id);
          if (!llm) return null;
          return {
            ...row,
            score: llm.score,
            relevance: clamp((row.relevance + llm.relevance) / 2, 0, 1),
            confidence: clamp((row.confidence + llm.confidence) / 2, 0, 1),
            method: 'llm' as const,
          };
        })
        .filter((row): row is ScoredArticle & { score: number; method: 'llm' } => Boolean(row));
      if (scoredRows.length > 0) provider = 'llm_headline';
    } catch {
      scoredRows = [];
    }
  }

  if (scoredRows.length === 0) {
    return {
      ticker,
      score: 0,
      summary: pitAvailabilityMissing
        ? 'No structured sentiment evidence available | PIT availability incomplete'
        : 'No structured sentiment evidence available',
      positive: 0,
      negative: 0,
      provider: 'neutral_fallback',
      articleCount: rawArticles.length,
      usedArticleCount: 0,
      ignoredArticleCount: parsed.length,
      pitAvailabilityMissing,
      evidence: [],
    };
  }

  const aggregated = aggregateEvidence(scoredRows, endDate);
  const score = clamp(
    aggregated.score * (pitAvailabilityMissing ? 0.85 : 1),
    -1,
    1,
  );

  return {
    ticker,
    score,
    summary: pitAvailabilityMissing
      ? `Sentiment ${provider}: ${aggregated.positive} positive / ${aggregated.negative} negative (used ${scoredRows.length}) | PIT availability incomplete`
      : `Sentiment ${provider}: ${aggregated.positive} positive / ${aggregated.negative} negative (used ${scoredRows.length})`,
    positive: aggregated.positive,
    negative: aggregated.negative,
    provider,
    articleCount: rawArticles.length,
    usedArticleCount: scoredRows.length,
    ignoredArticleCount: Math.max(parsed.length - scoredRows.length, 0),
    pitAvailabilityMissing,
    evidence: aggregated.evidence,
  };
}
