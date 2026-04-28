// SEC EDGAR financial extractor
// Fetches XBRL company-facts + recent submissions (10-K, 10-Q, 8-K, DEF 14A)
// and returns a snapshot + multi-period table for the requested ticker.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// SEC requires a descriptive User-Agent on every request.
const UA = "Ledger Lovable App contact@example.com";

type FactUnit = {
  end: string;
  start?: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  accn?: string;
};

type CompanyFacts = {
  cik: number;
  entityName: string;
  facts: {
    "us-gaap"?: Record<string, { units: Record<string, FactUnit[]> }>;
    dei?: Record<string, { units: Record<string, FactUnit[]> }>;
  };
};

type Period = {
  key: string; // e.g. FY2023 or Q3-2024
  label: string;
  fy: number;
  fp: string; // FY | Q1 | Q2 | Q3 | Q4
  end: string;
  form: string;
  values: Record<string, number | null>;
};

// ---- helpers ---------------------------------------------------------------

async function secFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/html",
    },
  });
}

async function resolveCik(ticker: string): Promise<{ cik: string; name: string } | null> {
  const res = await secFetch("https://www.sec.gov/files/company_tickers.json");
  if (!res.ok) return null;
  const data = await res.json() as Record<string, { cik_str: number; ticker: string; title: string }>;
  const upper = ticker.toUpperCase();
  for (const k of Object.keys(data)) {
    if (data[k].ticker === upper) {
      return {
        cik: String(data[k].cik_str).padStart(10, "0"),
        name: data[k].title,
      };
    }
  }
  return null;
}

// Pick the unit array we want (USD by default, shares for share counts)
function pickUnits(
  facts: CompanyFacts,
  conceptCandidates: string[],
  preferredUnits: string[],
): FactUnit[] {
  const ns = facts.facts["us-gaap"] ?? {};
  const dei = facts.facts.dei ?? {};
  for (const c of conceptCandidates) {
    const node = ns[c] ?? dei[c];
    if (!node) continue;
    for (const u of preferredUnits) {
      if (node.units[u]) return node.units[u];
    }
    // fall back to first unit available
    const firstKey = Object.keys(node.units)[0];
    if (firstKey) return node.units[firstKey];
  }
  return [];
}

// Group filings by (fy, fp) and end date
function groupPeriods(units: FactUnit[]): Map<string, FactUnit> {
  const out = new Map<string, FactUnit>();
  for (const u of units) {
    if (!u.fy || !u.fp || !u.form) continue;
    if (!["10-K", "10-Q", "10-K/A", "10-Q/A"].includes(u.form)) continue;
    const key = `${u.fy}-${u.fp}`;
    const prev = out.get(key);
    // Prefer non-amended, then latest filed
    if (!prev) {
      out.set(key, u);
    } else {
      const prevAmended = prev.form?.endsWith("/A") ? 1 : 0;
      const curAmended = u.form?.endsWith("/A") ? 1 : 0;
      if (curAmended < prevAmended) out.set(key, u);
      else if (curAmended === prevAmended && (u.filed ?? "") > (prev.filed ?? "")) out.set(key, u);
    }
  }
  return out;
}

// Concept dictionaries — try multiple synonyms because tags vary by filer
const CONCEPTS = {
  Revenue: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
  ],
  GrossProfit: ["GrossProfit"],
  OperatingIncome: ["OperatingIncomeLoss"],
  NetIncome: [
    "NetIncomeLoss",
    "ProfitLoss",
    "NetIncomeLossAvailableToCommonStockholdersBasic",
  ],
  NetIncomeToCommon: [
    "NetIncomeLossAvailableToCommonStockholdersBasic",
    "NetIncomeLoss",
  ],
  EPSDiluted: ["EarningsPerShareDiluted"],
  EPSBasic: ["EarningsPerShareBasic"],
  OpCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  CapEx: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ],
  DepreciationAmortization: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "Depreciation",
  ],
  InterestExpense: ["InterestExpense"],
  IncomeTax: ["IncomeTaxExpenseBenefit"],
  // Balance sheet
  Cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ],
  ShortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent"],
  LongTermDebt: ["LongTermDebt", "LongTermDebtNoncurrent"],
  ShortTermDebt: [
    "ShortTermBorrowings",
    "LongTermDebtCurrent",
    "DebtCurrent",
  ],
  TotalAssets: ["Assets"],
  TotalEquity: [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ],
  CurrentAssets: ["AssetsCurrent"],
  CurrentLiabilities: ["LiabilitiesCurrent"],
  SharesOutstanding: [
    "CommonStockSharesOutstanding",
    "EntityCommonStockSharesOutstanding",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
  ],
  DividendsPerShare: [
    "CommonStockDividendsPerShareDeclared",
    "CommonStockDividendsPerShareCashPaid",
  ],
  DividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
};

function ttmSum(units: FactUnit[], end: string, conceptIsFlow = true): number | null {
  // Sum the last 4 quarterly periods ending at or before `end`
  if (!conceptIsFlow) {
    // For point-in-time (balance sheet), just take latest
    const sorted = [...units].sort((a, b) => (a.end < b.end ? 1 : -1));
    const pick = sorted.find((u) => u.end <= end) ?? sorted[0];
    return pick?.val ?? null;
  }
  // Find quarterly facts (start defined, ~3 months)
  const quarters = units
    .filter((u) => u.start && u.end <= end)
    .map((u) => {
      const days = (new Date(u.end).getTime() - new Date(u.start!).getTime()) / 86400000;
      return { ...u, days };
    })
    .filter((u) => u.days > 60 && u.days < 100)
    .sort((a, b) => (a.end < b.end ? 1 : -1));

  // Dedup by end date — keep latest filed
  const byEnd = new Map<string, FactUnit & { days: number }>();
  for (const q of quarters) {
    const prev = byEnd.get(q.end);
    if (!prev || (q.filed ?? "") > (prev.filed ?? "")) byEnd.set(q.end, q);
  }
  const last4 = [...byEnd.values()]
    .sort((a, b) => (a.end < b.end ? 1 : -1))
    .slice(0, 4);

  if (last4.length === 0) return null;
  if (last4.length < 4) {
    // Try annual fallback
    const annual = units
      .filter((u) => u.fp === "FY" && u.end <= end)
      .sort((a, b) => (a.end < b.end ? 1 : -1));
    if (annual[0]) return annual[0].val;
    return null;
  }
  return last4.reduce((s, q) => s + q.val, 0);
}

function pointInTime(units: FactUnit[], end: string): FactUnit | null {
  const sorted = [...units].sort((a, b) => (a.end < b.end ? 1 : -1));
  return sorted.find((u) => u.end <= end) ?? sorted[0] ?? null;
}

function safeDiv(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !isFinite(a) || !isFinite(b) || b === 0) return null;
  return a / b;
}

// ---- main handler ----------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const startYear = Number(body.startYear ?? new Date().getFullYear() - 5);
    const endYear = Number(body.endYear ?? new Date().getFullYear());

    if (!ticker || ticker.length > 10) {
      return new Response(JSON.stringify({ error: "Invalid ticker" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolved = await resolveCik(ticker);
    if (!resolved) {
      return new Response(JSON.stringify({ error: `Ticker not found in SEC EDGAR: ${ticker}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch company-facts and submissions in parallel
    const [factsRes, subsRes] = await Promise.all([
      secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${resolved.cik}.json`),
      secFetch(`https://data.sec.gov/submissions/CIK${resolved.cik}.json`),
    ]);

    if (!factsRes.ok) {
      return new Response(
        JSON.stringify({ error: `SEC company-facts fetch failed (${factsRes.status})` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const facts = (await factsRes.json()) as CompanyFacts;
    const subs = subsRes.ok ? await subsRes.json() : null;

    // ---- Build period-by-period table -------------------------------------

    const series: Record<string, FactUnit[]> = {};
    for (const [key, concepts] of Object.entries(CONCEPTS)) {
      const units = pickUnits(facts, concepts, ["USD", "USD/shares", "shares", "pure"]);
      series[key] = units;
    }

    // Determine the universe of (fy, fp) periods from Revenue (most reliable)
    // Falls back to NetIncome
    const revGroup = groupPeriods(series.Revenue);
    const niGroup = groupPeriods(series.NetIncome);
    const allKeys = new Set<string>([...revGroup.keys(), ...niGroup.keys()]);

    const periods: Period[] = [];
    for (const k of allKeys) {
      const sample = revGroup.get(k) ?? niGroup.get(k);
      if (!sample) continue;
      const fy = sample.fy!;
      if (fy < startYear || fy > endYear) continue;
      const fp = sample.fp!;
      const label = fp === "FY" ? `FY${fy}` : `${fp} ${fy}`;
      const values: Record<string, number | null> = {};
      for (const k2 of Object.keys(CONCEPTS)) {
        const grp = groupPeriods(series[k2]);
        values[k2] = grp.get(k)?.val ?? null;
      }
      // Derived
      values["FreeCashFlow"] =
        values["OpCashFlow"] !== null && values["CapEx"] !== null
          ? values["OpCashFlow"]! - values["CapEx"]!
          : null;
      values["GrossMargin"] = safeDiv(values["GrossProfit"], values["Revenue"]);
      values["OperatingMargin"] = safeDiv(values["OperatingIncome"], values["Revenue"]);
      values["NetMargin"] = safeDiv(values["NetIncome"], values["Revenue"]);
      values["EBITDA"] =
        values["OperatingIncome"] !== null && values["DepreciationAmortization"] !== null
          ? values["OperatingIncome"]! + values["DepreciationAmortization"]!
          : values["OperatingIncome"];

      periods.push({
        key: k,
        label,
        fy,
        fp,
        end: sample.end,
        form: sample.form ?? "",
        values,
      });
    }
    // sort newest first
    periods.sort((a, b) => (a.end < b.end ? 1 : -1));

    // ---- Snapshot ---------------------------------------------------------

    // Find latest end date across revenue/netIncome
    const latestEnd =
      periods[0]?.end ??
      [...series.Revenue, ...series.NetIncome]
        .map((u) => u.end)
        .sort()
        .reverse()[0];

    const ttm = (k: keyof typeof CONCEPTS) =>
      latestEnd ? ttmSum(series[k], latestEnd, true) : null;
    const pit = (k: keyof typeof CONCEPTS) =>
      latestEnd ? pointInTime(series[k], latestEnd)?.val ?? null : null;

    const revenueTTM = ttm("Revenue");
    const grossProfitTTM = ttm("GrossProfit");
    const opIncomeTTM = ttm("OperatingIncome");
    const netIncomeTTM = ttm("NetIncome");
    const netIncomeToCommonTTM = ttm("NetIncomeToCommon") ?? netIncomeTTM;
    const epsDilutedTTM = ttm("EPSDiluted");
    const ocfTTM = ttm("OpCashFlow");
    const capExTTM = ttm("CapEx");
    const daTTM = ttm("DepreciationAmortization");
    const dividendsPaidTTM = ttm("DividendsPaid");
    const interestExpenseTTM = ttm("InterestExpense");

    const cashMRQ = pit("Cash");
    const stInvMRQ = pit("ShortTermInvestments");
    const totalCashMRQ =
      cashMRQ !== null || stInvMRQ !== null
        ? (cashMRQ ?? 0) + (stInvMRQ ?? 0)
        : null;
    const ltDebt = pit("LongTermDebt");
    const stDebt = pit("ShortTermDebt");
    const totalDebtMRQ =
      ltDebt !== null || stDebt !== null ? (ltDebt ?? 0) + (stDebt ?? 0) : null;
    const totalAssetsMRQ = pit("TotalAssets");
    const totalEquityMRQ = pit("TotalEquity");
    const currentAssetsMRQ = pit("CurrentAssets");
    const currentLiabMRQ = pit("CurrentLiabilities");
    const sharesOutstanding = pit("SharesOutstanding");
    const dividendPerShareTTM = ttm("DividendsPerShare");

    // EBITDA TTM
    const ebitdaTTM =
      opIncomeTTM !== null && daTTM !== null ? opIncomeTTM + daTTM : opIncomeTTM;

    // Quarterly YoY growth
    const quarterlyOf = (units: FactUnit[]) => {
      return units
        .filter((u) => u.start && u.end)
        .map((u) => {
          const days = (new Date(u.end).getTime() - new Date(u.start!).getTime()) / 86400000;
          return { ...u, days };
        })
        .filter((u) => u.days > 60 && u.days < 100);
    };
    const latestQ = quarterlyOf(series.Revenue).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    let revQYoY: number | null = null;
    if (latestQ) {
      const prevYearQ = quarterlyOf(series.Revenue).find(
        (u) => Math.abs(new Date(u.end).getTime() - new Date(latestQ.end).getTime() - 365 * 86400000) < 30 * 86400000,
      );
      if (prevYearQ && prevYearQ.val) revQYoY = (latestQ.val - prevYearQ.val) / prevYearQ.val;
    }
    const latestQNI = quarterlyOf(series.NetIncome).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    let niQYoY: number | null = null;
    if (latestQNI) {
      const prevYearQ = quarterlyOf(series.NetIncome).find(
        (u) => Math.abs(new Date(u.end).getTime() - new Date(latestQNI.end).getTime() - 365 * 86400000) < 30 * 86400000,
      );
      if (prevYearQ && prevYearQ.val) niQYoY = (latestQNI.val - prevYearQ.val) / prevYearQ.val;
    }

    // Recent submissions (10-K, 8-K, DEF 14A)
    type FilingMeta = {
      form: string;
      filed: string;
      reportDate: string;
      accession: string;
      url: string;
    };
    const filings: FilingMeta[] = [];
    if (subs?.filings?.recent) {
      const r = subs.filings.recent;
      const n = r.accessionNumber.length;
      for (let i = 0; i < n; i++) {
        const form = r.form[i];
        if (!["10-K", "10-Q", "8-K", "DEF 14A"].includes(form)) continue;
        const filed = r.filingDate[i];
        const reportDate = r.reportDate[i] || filed;
        const acc = r.accessionNumber[i] as string;
        const accNoDash = acc.replace(/-/g, "");
        const cikInt = parseInt(resolved.cik, 10);
        filings.push({
          form,
          filed,
          reportDate,
          accession: acc,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikInt}&type=${encodeURIComponent(form)}&dateb=&owner=include&count=40`,
        });
        // also direct filing url
        filings[filings.length - 1].url = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${acc}-index.htm`;
      }
    }

    // Last 8-K mentioning a stock split / dividend declaration — best-effort: just expose latest 8-Ks; full text parse skipped.
    const recent8K = filings.filter((f) => f.form === "8-K").slice(0, 10);
    const recentDEF14A = filings.filter((f) => f.form === "DEF 14A").slice(0, 3);
    const recent10K = filings.filter((f) => f.form === "10-K").slice(0, 5);

    const mostRecent10K = recent10K[0];
    const fiscalYearEnd = mostRecent10K?.reportDate ?? null;
    const fiscalYear = fiscalYearEnd ? Number(fiscalYearEnd.slice(0, 4)) : null;

    // Snapshot
    const snapshot = {
      ticker,
      entityName: resolved.name,
      cik: resolved.cik,
      latestEnd,
      fiscalYear,
      fiscalYearEnd,
      mostRecentQuarterEnd: latestEnd,

      // Profitability
      profitMargin: safeDiv(netIncomeTTM, revenueTTM),
      operatingMargin: safeDiv(opIncomeTTM, revenueTTM),

      // Mgmt Effectiveness
      returnOnAssets: safeDiv(netIncomeTTM, totalAssetsMRQ),
      returnOnEquity: safeDiv(netIncomeToCommonTTM, totalEquityMRQ),

      // Income Statement
      revenueTTM,
      revenuePerShareTTM: safeDiv(revenueTTM, sharesOutstanding),
      quarterlyRevenueGrowthYoY: revQYoY,
      grossProfitTTM,
      ebitdaTTM,
      netIncomeToCommonTTM,
      dilutedEPSTTM: epsDilutedTTM,
      quarterlyEarningsGrowthYoY: niQYoY,

      // Balance Sheet
      totalCashMRQ,
      totalCashPerShareMRQ: safeDiv(totalCashMRQ, sharesOutstanding),
      totalDebtMRQ,
      totalDebtToEquityMRQ:
        totalDebtMRQ !== null && totalEquityMRQ ? totalDebtMRQ / totalEquityMRQ : null,
      currentRatioMRQ: safeDiv(currentAssetsMRQ, currentLiabMRQ),
      bookValuePerShareMRQ: safeDiv(totalEquityMRQ, sharesOutstanding),

      // Cash Flow
      operatingCashFlowTTM: ocfTTM,
      // Levered FCF ≈ OCF − CapEx (approximation; true levered also subtracts mandatory debt repayments)
      leveredFreeCashFlowTTM:
        ocfTTM !== null && capExTTM !== null ? ocfTTM - capExTTM : null,

      // Share Stats
      sharesOutstanding,
      // Insider % is in DEF 14A (text), not XBRL — we expose a link instead.

      // Dividends
      forwardAnnualDividendRate: dividendPerShareTTM, // approx using TTM declared
      trailingAnnualDividendRate: dividendPerShareTTM,
      payoutRatio: safeDiv(dividendsPaidTTM, netIncomeTTM),
      // Last dividend date / ex-dividend date / split factor / split date come from 8-K text;
      // we expose the latest 8-K filings list for the user to inspect.
    };

    return new Response(
      JSON.stringify({
        snapshot,
        periods,
        filings: {
          recent10K,
          recent8K,
          recentDEF14A,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("sec-financials error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
