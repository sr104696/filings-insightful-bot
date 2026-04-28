import { Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { fmtMoney, fmtPct, fmtNum, type Period } from "@/lib/sec-types";

type Row = {
  key: string;
  label: string;
  format: "money" | "pct" | "num";
};

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Income Statement",
    rows: [
      { key: "Revenue", label: "Revenue", format: "money" },
      { key: "GrossProfit", label: "Gross Profit", format: "money" },
      { key: "OperatingIncome", label: "Operating Income", format: "money" },
      { key: "EBITDA", label: "EBITDA (approx.)", format: "money" },
      { key: "NetIncome", label: "Net Income", format: "money" },
      { key: "EPSDiluted", label: "Diluted EPS", format: "num" },
    ],
  },
  {
    title: "Cash Flow",
    rows: [
      { key: "OpCashFlow", label: "Operating Cash Flow", format: "money" },
      { key: "CapEx", label: "CapEx", format: "money" },
      { key: "FreeCashFlow", label: "Free Cash Flow", format: "money" },
      { key: "DividendsPaid", label: "Dividends Paid", format: "money" },
    ],
  },
  {
    title: "Balance Sheet",
    rows: [
      { key: "Cash", label: "Cash & Equivalents", format: "money" },
      { key: "TotalAssets", label: "Total Assets", format: "money" },
      { key: "TotalEquity", label: "Total Equity", format: "money" },
      { key: "LongTermDebt", label: "Long-Term Debt", format: "money" },
      { key: "SharesOutstanding", label: "Shares Outstanding", format: "money" },
    ],
  },
  {
    title: "Margins",
    rows: [
      { key: "GrossMargin", label: "Gross Margin", format: "pct" },
      { key: "OperatingMargin", label: "Operating Margin", format: "pct" },
      { key: "NetMargin", label: "Net Margin", format: "pct" },
    ],
  },
];

function fmt(v: number | null | undefined, kind: Row["format"]) {
  if (v === null || v === undefined) return "—";
  if (kind === "pct") return fmtPct(v);
  if (kind === "num") return fmtNum(v);
  return fmtMoney(v);
}

function downloadCsv(periods: Period[], ticker: string) {
  const headers = ["Section", "Metric", ...periods.map((p) => p.label)];
  const lines: string[] = [headers.join(",")];
  for (const s of SECTIONS) {
    for (const r of s.rows) {
      const row = [
        s.title,
        r.label,
        ...periods.map((p) => {
          const v = p.values[r.key];
          if (v === null || v === undefined) return "";
          if (r.format === "pct") return (v * 100).toFixed(4);
          return String(v);
        }),
      ];
      lines.push(row.map((c) => (String(c).includes(",") ? `"${c}"` : c)).join(","));
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ticker}_ledger.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function HistoryTable({ periods, ticker }: { periods: Period[]; ticker: string }) {
  if (periods.length === 0) {
    return (
      <Card className="p-6 bg-card border-border text-muted-foreground text-sm">
        No filings found in this year range.
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border overflow-hidden shadow-[var(--shadow-elev)]">
      <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-primary font-semibold">
            Historical Periods
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {periods.length} filing{periods.length !== 1 ? "s" : ""} · 10-K (FY) and 10-Q
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(periods, ticker)}
          className="border-border hover:bg-secondary"
        >
          <Download className="size-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono-num">
          <thead className="bg-secondary/30 sticky top-0">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground uppercase tracking-wider text-[11px] sticky left-0 bg-secondary/60 backdrop-blur z-10 min-w-[200px]">
                Metric
              </th>
              {periods.map((p) => (
                <th
                  key={p.key}
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground uppercase tracking-wider text-[11px] whitespace-nowrap"
                >
                  <div className="text-foreground">{p.label}</div>
                  <div className="text-[10px] text-muted-foreground/70 normal-case mt-0.5">
                    {p.end} · {p.form}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((s, si) => (
              <Fragment key={`sec-${si}`}>
                <tr className="bg-secondary/20">
                  <td
                    colSpan={periods.length + 1}
                    className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-primary font-semibold sticky left-0 bg-secondary/40"
                  >
                    {s.title}
                  </td>
                </tr>
                {s.rows.map((r, ri) => (
                  <tr
                    key={`${si}-${ri}`}
                    className="border-t border-border/40 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="px-4 py-2 text-foreground sticky left-0 bg-card whitespace-nowrap">
                      {r.label}
                    </td>
                    {periods.map((p) => {
                      const v = p.values[r.key];
                      const isNeg = typeof v === "number" && v < 0;
                      return (
                        <td
                          key={p.key}
                          className={`px-3 py-2 text-right whitespace-nowrap ${
                            v === null || v === undefined
                              ? "text-muted-foreground/50"
                              : isNeg
                              ? "text-negative"
                              : "text-foreground"
                          }`}
                        >
                          {fmt(v, r.format)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
