import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  onSubmit: (params: { ticker: string; startYear: number; endYear: number }) => void;
  loading: boolean;
};

export function TickerForm({ onSubmit, loading }: Props) {
  const currentYear = new Date().getFullYear();
  const [ticker, setTicker] = useState("AAPL");
  const [startYear, setStartYear] = useState(currentYear - 5);
  const [endYear, setEndYear] = useState(currentYear);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ticker.trim()) return;
        onSubmit({ ticker: ticker.trim().toUpperCase(), startYear, endYear });
      }}
      className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto] items-end"
    >
      <div className="space-y-1.5">
        <Label htmlFor="ticker" className="text-xs uppercase tracking-wider text-muted-foreground">
          Ticker
        </Label>
        <Input
          id="ticker"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className="font-mono-num text-lg uppercase tracking-wider bg-secondary/40 border-border focus-visible:ring-primary"
          maxLength={10}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="start" className="text-xs uppercase tracking-wider text-muted-foreground">
          From year
        </Label>
        <Input
          id="start"
          type="number"
          min={1995}
          max={currentYear}
          value={startYear}
          onChange={(e) => setStartYear(Number(e.target.value))}
          className="font-mono-num bg-secondary/40 border-border"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="end" className="text-xs uppercase tracking-wider text-muted-foreground">
          To year
        </Label>
        <Input
          id="end"
          type="number"
          min={1995}
          max={currentYear}
          value={endYear}
          onChange={(e) => setEndYear(Number(e.target.value))}
          className="font-mono-num bg-secondary/40 border-border"
        />
      </div>
      <Button
        type="submit"
        disabled={loading}
        size="lg"
        className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide shadow-[var(--shadow-glow)]"
      >
        {loading ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Fetching
          </>
        ) : (
          <>
            <Search className="size-4 mr-2" />
            Extract
          </>
        )}
      </Button>
    </form>
  );
}
