import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText } from "lucide-react";
import type { FilingMeta } from "@/lib/sec-types";

type Props = {
  recent10K: FilingMeta[];
  recent8K: FilingMeta[];
  recentDEF14A: FilingMeta[];
};

function FilingList({ title, filings, hint }: { title: string; filings: FilingMeta[]; hint: string }) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-primary font-semibold">{title}</h3>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <ul className="space-y-1">
        {filings.length === 0 && (
          <li className="text-xs text-muted-foreground/60">No recent filings.</li>
        )}
        {filings.map((f) => (
          <li key={f.accession}>
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-secondary/40 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono-num text-foreground">{f.reportDate}</span>
                <Badge variant="outline" className="border-border text-[10px] py-0 px-1 font-normal">
                  {f.form}
                </Badge>
              </span>
              <ExternalLink className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FilingsPanel({ recent10K, recent8K, recentDEF14A }: Props) {
  return (
    <Card className="bg-card border-border p-5 shadow-[var(--shadow-elev)]">
      <h2 className="text-sm uppercase tracking-wider text-primary font-semibold mb-4">
        Source Filings
      </h2>
      <div className="grid md:grid-cols-3 gap-6">
        <FilingList title="10-K" filings={recent10K} hint="Annual financials" />
        <FilingList
          title="8-K"
          filings={recent8K}
          hint="Material events: dividends declared, splits, ex-div dates"
        />
        <FilingList
          title="DEF 14A"
          filings={recentDEF14A}
          hint="Proxy statement: insider ownership %"
        />
      </div>
    </Card>
  );
}
