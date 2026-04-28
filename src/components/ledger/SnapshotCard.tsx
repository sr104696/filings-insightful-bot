import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { fmtMoney, fmtPct, fmtNum, fmtShares, type SnapshotData } from "@/lib/sec-types";

type Row = {
  label: string;
  value: string;
  pct?: number | null; // for delta coloring
};

type Section = {
  title: string;
  rows: Row[];
};

function trend(v: number | null | undefined) {
  if (v === null || v === undefined || !isFinite(v)) return <Minus className="size-3 text-muted-foreground" />;
  if (v > 0) return <TrendingUp className="size-3 text-positive" />;
  if (v < 0) return <TrendingDown className="size-3 text-negative" />;
  return <Minus className="size-3 text-muted-foreground" />;
}

export function SnapshotCard({ snapshot }: { snapshot: SnapshotData }) {
  const sections: Section[] = [
    {
      title: "Financial Highlights",
      rows: [
        { label: "Fiscal Year", value: snapshot.fiscalYear ? String(snapshot.fiscalYear) : "—" },
        { label: "Fiscal Year Ends", value: snapshot.fiscalYearEnd ?? "—" },
        { label: "Most Recent Quarter (mrq)", value: snapshot.mostRecentQuarterEnd ?? "—" },
      ],
    },
    {
      title: "Profitability",
      rows: [
        { label: "Profit Margin", value: fmtPct(snapshot.profitMargin), pct: snapshot.profitMargin },
        { label: "Operating Margin (ttm)", value: fmtPct(snapshot.operatingMargin), pct: snapshot.operatingMargin },
      ],
    },
    {
      title: "Management Effectiveness",
      rows: [
        { label: "Return on Assets (ttm)", value: fmtPct(snapshot.returnOnAssets), pct: snapshot.returnOnAssets },
        { label: "Return on Equity (ttm)", value: fmtPct(snapshot.returnOnEquity), pct: snapshot.returnOnEquity },
      ],
    },
    {
      title: "Income Statement",
      rows: [
        { label: "Revenue (ttm)", value: fmtMoney(snapshot.revenueTTM) },
        { label: "Revenue Per Share (ttm)", value: fmtNum(snapshot.revenuePerShareTTM) },
        {
          label: "Quarterly Revenue Growth (yoy)",
          value: fmtPct(snapshot.quarterlyRevenueGrowthYoY),
          pct: snapshot.quarterlyRevenueGrowthYoY,
        },
        { label: "Gross Profit (ttm)", value: fmtMoney(snapshot.grossProfitTTM) },
        { label: "EBITDA", value: fmtMoney(snapshot.ebitdaTTM) },
        { label: "Net Income Avi to Common (ttm)", value: fmtMoney(snapshot.netIncomeToCommonTTM) },
        { label: "Diluted EPS (ttm)", value: fmtNum(snapshot.dilutedEPSTTM) },
        {
          label: "Quarterly Earnings Growth (yoy)",
          value: fmtPct(snapshot.quarterlyEarningsGrowthYoY),
          pct: snapshot.quarterlyEarningsGrowthYoY,
        },
      ],
    },
    {
      title: "Balance Sheet",
      rows: [
        { label: "Total Cash (mrq)", value: fmtMoney(snapshot.totalCashMRQ) },
        { label: "Total Cash Per Share (mrq)", value: fmtNum(snapshot.totalCashPerShareMRQ) },
        { label: "Total Debt (mrq)", value: fmtMoney(snapshot.totalDebtMRQ) },
        { label: "Total Debt/Equity (mrq)", value: fmtNum(snapshot.totalDebtToEquityMRQ) },
        { label: "Current Ratio (mrq)", value: fmtNum(snapshot.currentRatioMRQ) },
        { label: "Book Value Per Share (mrq)", value: fmtNum(snapshot.bookValuePerShareMRQ) },
      ],
    },
    {
      title: "Cash Flow Statement",
      rows: [
        { label: "Operating Cash Flow (ttm)", value: fmtMoney(snapshot.operatingCashFlowTTM) },
        { label: "Levered Free Cash Flow (ttm)", value: fmtMoney(snapshot.leveredFreeCashFlowTTM) },
      ],
    },
    {
      title: "Share Statistics",
      rows: [
        { label: "Shares Outstanding", value: fmtShares(snapshot.sharesOutstanding) },
        { label: "% Held by Insiders", value: "See DEF 14A" },
      ],
    },
    {
      title: "Dividends & Splits",
      rows: [
        { label: "Forward Annual Dividend Rate", value: fmtNum(snapshot.forwardAnnualDividendRate) },
        { label: "Trailing Annual Dividend Rate", value: fmtNum(snapshot.trailingAnnualDividendRate) },
        { label: "Payout Ratio", value: fmtPct(snapshot.payoutRatio), pct: snapshot.payoutRatio },
        { label: "Dividend Date", value: "See 8-K filings" },
        { label: "Ex-Dividend Date", value: "See 8-K filings" },
        { label: "Last Split Factor", value: "See 8-K filings" },
        { label: "Last Split Date", value: "See 8-K filings" },
      ],
    },
  ];

  return (
    <Card className="bg-card border-border overflow-hidden shadow-[var(--shadow-elev)]">
      <div className="bg-gradient-to-br from-secondary/40 to-card p-6 border-b border-border flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-mono-num font-bold tracking-tight text-primary">
              {snapshot.ticker}
            </h2>
            <Badge variant="outline" className="border-border text-muted-foreground font-normal">
              CIK {parseInt(snapshot.cik, 10)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{snapshot.entityName}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">As of</div>
          <div className="font-mono-num text-foreground">{snapshot.latestEnd ?? "—"}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-border">
        {sections.map((s) => (
          <div key={s.title} className="bg-card p-4 space-y-2">
            <h3 className="text-[11px] uppercase tracking-wider text-primary font-semibold pb-1 border-b border-border/60">
              {s.title}
            </h3>
            <dl className="space-y-1.5">
              {s.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground truncate">{r.label}</dt>
                  <dd className="font-mono-num text-foreground flex items-center gap-1 shrink-0">
                    {"pct" in r && r.pct !== undefined ? trend(r.pct) : null}
                    <span
                      className={
                        r.pct === undefined
                          ? ""
                          : r.pct !== null && r.pct > 0
                          ? "text-positive"
                          : r.pct !== null && r.pct < 0
                          ? "text-negative"
                          : ""
                      }
                    >
                      {r.value}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
