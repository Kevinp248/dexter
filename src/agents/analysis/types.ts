export interface AnalysisContext {
  asOfDate?: string;
  startDate?: string;
  endDate?: string;
  strictPointInTime?: boolean;
  companyName?: string;
  sector?: string;
  priceHistoryOverride?: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    adjustedClose?: number;
    volume: number;
  }>;
}
