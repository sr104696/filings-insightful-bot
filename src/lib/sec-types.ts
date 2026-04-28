export type SnapshotData = {
  ticker: string;
  entityName: string;
  cik: string;
  latestEnd: string | null;
  fiscalYear: number | null;
  fiscalYearEnd: string | null;
  mostRecentQuarterEnd: string | null;

  profitMargin: number | null;
  operatingMargin: number | null;
  returnOnAssets: number | null;
  returnOnEquity: number | null;

  revenueTTM: number | null;
  revenuePerShareTTM: number | null;
  quarterlyRevenueGrowthYoY: number | null;
  grossProfitTTM: number | null;
  ebitdaTTM: number | null;
  netIncomeToCommonTTM: number | null;
  dilutedEPSTTM: number | null;
  quarterlyEarningsGrowthYoY: number | null;

  totalCashMRQ: number | null;
  totalCashPerShareMRQ: number | null;
  totalDebtMRQ: number | null;
  totalDebtToEquityMRQ: number | null;
  currentRatioMRQ: number | null;
  bookValuePerShareMRQ: number | null;

  operatingCashFlowTTM: number | null;
  leveredFreeCashFlowTTM: number | null;

  sharesOutstanding: number | null;

  forwardAnnualDividendRate: number | null;
  trailingAnnualDividendRate: number | null;
  payoutRatio: number | null;
};

export type Period = {
  key: string;
  label: string;
  fy: number;
  fp: string;
  end: string;
  form: string;
  values: Record<string, number | null>;
};

export type FilingMeta = {
  form: string;
  filed: string;
  reportDate: string;
  accession: string;
  url: string;
};

export type SecResponse = {
  snapshot: SnapshotData;
  periods: Period[];
  filings: {
    recent10K: FilingMeta[];
    recent8K: FilingMeta[];
    recentDEF14A: FilingMeta[];
  };
};

// ---- formatters ----------------------------------------------------------

export function fmtMoney(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const compact = opts?.compact ?? true;
  const abs = Math.abs(v);
  if (compact) {
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  }
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtShares(v: number | null | undefined): string {
  return fmtMoney(v, { compact: true });
}
