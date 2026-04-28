import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { LineChart, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TickerForm } from "@/components/ledger/TickerForm";
import { SnapshotCard } from "@/components/ledger/SnapshotCard";
import { HistoryTable } from "@/components/ledger/HistoryTable";
import { FilingsPanel } from "@/components/ledger/FilingsPanel";
import { Card } from "@/components/ui/card";
import type { SecResponse } from "@/lib/sec-types";

const Index = () => {
  const [data, setData] = useState<SecResponse | null>(null);
  const [ticker, setTicker] = useState<string>("");

  const mutation = useMutation({
    mutationFn: async (params: { ticker: string; startYear: number; endYear: number }) => {
      const { data, error } = await supabase.functions.invoke<SecResponse>("sec-financials", {
        body: params,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("No data returned");
      // edge function returns { error } on failure
      // @ts-expect-error tolerated narrowing
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (res, params) => {
      setData(res);
      setTicker(params.ticker);
      toast.success(`Loaded ${res.snapshot.entityName}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to load data");
    },
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-b from-secondary/30 to-transparent">
        <div className="mx-auto max-w-7xl px-6 py-10 bg-grid">
          <div className="flex items-center gap-3 mb-2">
            <div className="size-9 rounded-md bg-[image:var(--gradient-amber)] flex items-center justify-center shadow-[var(--shadow-glow)]">
              <LineChart className="size-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-mono-num font-bold tracking-tight">
              Ledger
            </h1>
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground border border-border rounded-full px-2 py-0.5">
              SEC EDGAR
            </span>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Pull every <span className="text-foreground">10-K, 10-Q, 8-K and DEF 14A</span> filing for a US-listed
            company between a year range. Extracts core financials, profitability, balance sheet
            and cash flow metrics from XBRL company facts.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <Card className="p-5 bg-card border-border shadow-[var(--shadow-elev)]">
          <TickerForm
            onSubmit={(p) => mutation.mutate(p)}
            loading={mutation.isPending}
          />
        </Card>

        {mutation.isError && (
          <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm flex items-start gap-3">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-destructive">Extraction failed</div>
              <div className="text-muted-foreground">
                {mutation.error instanceof Error ? mutation.error.message : "Unknown error"}
              </div>
            </div>
          </Card>
        )}

        {!data && !mutation.isPending && !mutation.isError && (
          <Card className="p-10 bg-card/40 border-dashed border-border text-center">
            <p className="text-muted-foreground text-sm">
              Enter a ticker (e.g. <span className="font-mono-num text-primary">AAPL</span>,{" "}
              <span className="font-mono-num text-primary">MSFT</span>,{" "}
              <span className="font-mono-num text-primary">NVDA</span>) and a year range to extract
              its SEC filings.
            </p>
          </Card>
        )}

        {data && (
          <>
            <SnapshotCard snapshot={data.snapshot} />
            <HistoryTable periods={data.periods} ticker={ticker} />
            <FilingsPanel
              recent10K={data.filings.recent10K}
              recent8K={data.filings.recent8K}
              recentDEF14A={data.filings.recentDEF14A}
            />
            <p className="text-[11px] text-muted-foreground/70 text-center pb-4">
              Data sourced from SEC EDGAR (data.sec.gov XBRL company facts). Some figures (insider
              %, ex-dividend dates, split factors) live in 8-K / DEF 14A narrative text — direct
              filing links are provided above.
            </p>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
