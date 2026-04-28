// SEC EDGAR financial extractor
// Fetches XBRL company-facts + recent submissions (10-K, 10-Q, 8-K, DEF 14A)
// and returns a snapshot + multi-period table for the requested ticker.
//
// Period model (v2):
// XBRL company-facts contain MANY facts per filing — a 10-Q includes 3-month
// current quarter + 9-month YTD + prior-year comparatives. The filer-reported
// `fy`/`fp` describe the FILING that supplied the fact, not the fact's period.
// We therefore classify each fact by its actual (start, end, duration) and
// dedupe by picking the most recently filed value for each canonical period.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  key: string;
  label: string;
  fy: number;
  fp: string; // FY | Q1 | Q2 | Q3 | Q4
  end: string;
  start: string | null;
  form: string;
  values: Record<string, number | null>;
};

// ---- helpers ---------------------------------------------------------------

async function secFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json, text/html" },
  });
}

async function resolveCik(ticker: string): Promise<{ cik: string; name: string } | null> {
  const res = await secFetch("https://www.sec.gov/files/company_tickers.json");
  if (!res.ok) return null;
  const data = (await res.json()) as Record<
    string,
    { cik_str: number; ticker: string; title: string }
  >;
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
    const firstKey = Object.keys(node.units)[0];
    if (firstKey) return node.units[firstKey];
  }
  return [];
}

// Concept dictionaries — multiple synonyms because tags vary by filer
const CONCEPTS = {
  Revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
  ],
  CostOfRevenue: [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
    "CostOfServices",
  ],
  GrossProfit: ["GrossProfit"],
  OperatingIncome: ["OperatingIncomeLoss"],
  NetIncome: ["NetIncomeLoss", "ProfitLoss"],
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
  // Balance sheet (instant)
  Cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ],
  ShortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent"],
  LongTermDebt: [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
  ],
  ShortTermDebt: [
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
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
  ],
  WeightedAvgDilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  DividendsPerShare: [
    "CommonStockDividendsPerShareDeclared",
    "CommonStockDividendsPerShareCashPaid",
  ],
  DividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
};

// ---- period classification -------------------------------------------------

type PeriodKind = "annual" | "quarterly" | "instant";

function durationDays(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  return Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
  );
}

function classify(u: FactUnit): { kind: PeriodKind; days: number | null } {
  if (!u.start) return { kind: "instant", days: null };
  const d = durationDays(u.start, u.end)!;
  if (d >= 350 && d <= 380) return { kind: "annual", days: d };
  if (d >= 80 && d <= 100) return { kind: "quarterly", days: d };
  // YTD or other — ignore (we'll re-derive from quarters)
  return { kind: "annual", days: d }; // mark as annual-ish, then filtered
}

// Map an end date to a fiscal year + quarter label.
// We use the calendar year/quarter of the END date — works for ~99% of US filers
// (calendar fiscal year). For off-cycle fiscal years we still produce a sensible
// per-quarter label even if "fiscal year" labelling differs slightly.
function quarterLabelForEnd(end: string): { fy: number; fp: string; label: string } {
  const d = new Date(end);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-12
  let q: 1 | 2 | 3 | 4 = 1;
  if (m <= 3) q = 1;
  else if (m <= 6) q = 2;
  else if (m <= 9) q = 3;
  else q = 4;
  return { fy: y, fp: `Q${q}`, label: `Q${q} ${y}` };
}

function annualLabelForEnd(end: string): { fy: number; fp: string; label: string } {
  const y = new Date(end).getUTCFullYear();
  return { fy: y, fp: "FY", label: `FY${y}` };
}

// Bucket facts of a flow concept (revenue, net income, etc.) into:
// - quarterly buckets keyed by Q?-YYYY (using END date)
// - annual buckets keyed by FY-YYYY  (using END date)
// In each bucket pick the most recently filed value (handles restatements / splits).
function bucketFlow(units: FactUnit[]): {
  quarterly: Map<string, FactUnit>;
  annual: Map<string, FactUnit>;
} {
  const quarterly = new Map<string, FactUnit>();
  const annual = new Map<string, FactUnit>();

  for (const u of units) {
    if (!u.start) continue;
    const c = classify(u);
    if (c.kind === "quarterly") {
      const { fy, fp } = quarterLabelForEnd(u.end);
      const key = `${fy}-${fp}`;
      const prev = quarterly.get(key);
      if (!prev || (u.filed ?? "") > (prev.filed ?? "")) quarterly.set(key, u);
    } else if (c.kind === "annual" && c.days && c.days >= 350 && c.days <= 380) {
      const { fy } = annualLabelForEnd(u.end);
      const key = `${fy}`;
      const prev = annual.get(key);
      if (!prev || (u.filed ?? "") > (prev.filed ?? "")) annual.set(key, u);
    }
    // YTD (e.g. 6-month, 9-month) ignored — we'll derive Q4 below
  }

  // Derive Q4 if missing: Q4 = Annual − (Q1+Q2+Q3) (best-effort)
  for (const [yKey, ann] of annual) {
    const fy = Number(yKey);
    const q4Key = `${fy}-Q4`;
    if (quarterly.has(q4Key)) continue;
    const q1 = quarterly.get(`${fy}-Q1`);
    const q2 = quarterly.get(`${fy}-Q2`);
    const q3 = quarterly.get(`${fy}-Q3`);
    if (q1 && q2 && q3) {
      quarterly.set(q4Key, {
        end: ann.end,
        start: q3.end, // approximate
        val: ann.val - q1.val - q2.val - q3.val,
        form: ann.form,
        filed: ann.filed,
      });
    }
  }

  return { quarterly, annual };
}

// Bucket facts of an instant concept (balance sheet) by quarter end + year end.
function bucketInstant(units: FactUnit[]): {
  quarterly: Map<string, FactUnit>;
  annual: Map<string, FactUnit>;
} {
  const quarterly = new Map<string, FactUnit>();
  const annual = new Map<string, FactUnit>();
  for (const u of units) {
    if (u.start) continue;
    const d = new Date(u.end);
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const isQuarterEnd =
      (m === 3 && day >= 28) ||
      (m === 6 && day === 30) ||
      (m === 9 && day === 30) ||
      (m === 12 && day === 31);
    if (!isQuarterEnd) continue;
    const { fy, fp } = quarterLabelForEnd(u.end);
    const qKey = `${fy}-${fp}`;
    const qPrev = quarterly.get(qKey);
    if (!qPrev || (u.filed ?? "") > (qPrev.filed ?? "")) quarterly.set(qKey, u);
    if (fp === "Q4") {
      const yKey = `${fy}`;
      const yPrev = annual.get(yKey);
      if (!yPrev || (u.filed ?? "") > (yPrev.filed ?? "")) annual.set(yKey, u);
    }
  }
  return { quarterly, annual };
}

const FLOW_CONCEPTS = new Set([
  "Revenue",
  "CostOfRevenue",
  "GrossProfit",
  "OperatingIncome",
  "NetIncome",
  "NetIncomeToCommon",
  "OpCashFlow",
  "CapEx",
  "DepreciationAmortization",
  "InterestExpense",
  "IncomeTax",
  "DividendsPaid",
  "DividendsPerShare",
  "EPSDiluted",
  "EPSBasic",
]);

const INSTANT_CONCEPTS = new Set([
  "Cash",
  "ShortTermInvestments",
  "LongTermDebt",
  "ShortTermDebt",
  "TotalAssets",
  "TotalEquity",
  "CurrentAssets",
  "CurrentLiabilities",
  "SharesOutstanding",
]);

// Note: EPS and DividendsPerShare are per-share *flows* (not summable across
// quarters in the obvious way — but reported per period in 10-Q/10-K). We treat
// them like quarterly/annual values and just expose what the filer reports for
// that period, picking latest-filed (so post-split values win).

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
      return new Response(
        JSON.stringify({ error: `Ticker not found in SEC EDGAR: ${ticker}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    // Pull raw unit arrays for every concept
    const series: Record<string, FactUnit[]> = {};
    for (const [key, concepts] of Object.entries(CONCEPTS)) {
      series[key] = pickUnits(facts, concepts, ["USD", "USD/shares", "shares", "pure"]);
    }

    // Bucket each series
    const flowBuckets: Record<
      string,
      { quarterly: Map<string, FactUnit>; annual: Map<string, FactUnit> }
    > = {};
    const instantBuckets: Record<
      string,
      { quarterly: Map<string, FactUnit>; annual: Map<string, FactUnit> }
    > = {};

    for (const k of Object.keys(CONCEPTS)) {
      if (FLOW_CONCEPTS.has(k)) {
        flowBuckets[k] = bucketFlow(series[k]);
      } else if (INSTANT_CONCEPTS.has(k)) {
        instantBuckets[k] = bucketInstant(series[k]);
      }
    }

    // ---- Build period table ---------------------------------------------
    // Universe of period keys = union across all flow + instant buckets

    const allPeriodKeys = new Set<string>();
    for (const k of Object.keys(flowBuckets)) {
      flowBuckets[k].quarterly.forEach((_, kk) => allPeriodKeys.add(`Q:${kk}`));
      flowBuckets[k].annual.forEach((_, kk) => allPeriodKeys.add(`A:${kk}`));
    }
    for (const k of Object.keys(instantBuckets)) {
      instantBuckets[k].quarterly.forEach((_, kk) => allPeriodKeys.add(`Q:${kk}`));
      instantBuckets[k].annual.forEach((_, kk) => allPeriodKeys.add(`A:${kk}`));
    }

    const periods: Period[] = [];
    for (const pk of allPeriodKeys) {
      const isAnnual = pk.startsWith("A:");
      const rest = pk.slice(2); // "2024" or "2024-Q3"
      const fy = Number(isAnnual ? rest : rest.split("-")[0]);
      if (fy < startYear || fy > endYear) continue;

      const fp = isAnnual ? "FY" : rest.split("-")[1];
      const label = isAnnual ? `FY${fy}` : `${fp} ${fy}`;

      // Find a representative end date + form
      let end = "";
      let start: string | null = null;
      let form = "";
      let filed = "";

      const probeFlow = flowBuckets["Revenue"] ?? flowBuckets["NetIncome"];
      if (probeFlow) {
        const u = isAnnual
          ? probeFlow.annual.get(rest)
          : probeFlow.quarterly.get(rest);
        if (u) {
          end = u.end;
          start = u.start ?? null;
          form = u.form ?? "";
          filed = u.filed ?? "";
        }
      }
      if (!end) {
        // fallback to balance sheet
        const bs = instantBuckets["TotalAssets"];
        if (bs) {
          const u = isAnnual ? bs.annual.get(rest) : bs.quarterly.get(rest);
          if (u) {
            end = u.end;
            form = u.form ?? "";
            filed = u.filed ?? "";
          }
        }
      }

      const values: Record<string, number | null> = {};
      for (const k of Object.keys(CONCEPTS)) {
        const bucket = FLOW_CONCEPTS.has(k) ? flowBuckets[k] : instantBuckets[k];
        if (!bucket) {
          values[k] = null;
          continue;
        }
        const u = isAnnual ? bucket.annual.get(rest) : bucket.quarterly.get(rest);
        values[k] = u?.val ?? null;
      }

      // Derived
      // Free Cash Flow
      values["FreeCashFlow"] =
        values["OpCashFlow"] !== null && values["CapEx"] !== null
          ? values["OpCashFlow"]! - values["CapEx"]!
          : null;
      // Gross Profit fallback: Revenue - CostOfRevenue
      if (values["GrossProfit"] === null && values["Revenue"] !== null && values["CostOfRevenue"] !== null) {
        values["GrossProfit"] = values["Revenue"]! - values["CostOfRevenue"]!;
      }
      // EBITDA = OperatingIncome + D&A
      values["EBITDA"] =
        values["OperatingIncome"] !== null && values["DepreciationAmortization"] !== null
          ? values["OperatingIncome"]! + values["DepreciationAmortization"]!
          : values["OperatingIncome"];
      // Total Debt
      values["TotalDebt"] =
        values["LongTermDebt"] !== null || values["ShortTermDebt"] !== null
          ? (values["LongTermDebt"] ?? 0) + (values["ShortTermDebt"] ?? 0)
          : null;
      // Margins
      values["GrossMargin"] = safeDiv(values["GrossProfit"], values["Revenue"]);
      values["OperatingMargin"] = safeDiv(values["OperatingIncome"], values["Revenue"]);
      values["NetMargin"] = safeDiv(values["NetIncome"], values["Revenue"]);

      periods.push({
        key: pk,
        label,
        fy,
        fp,
        end: end || `${fy}-12-31`,
        start,
        form,
        values,
      });
    }
    // Sort newest-first
    periods.sort((a, b) => (a.end < b.end ? 1 : -1));

    // ---- Snapshot --------------------------------------------------------
    // Pick latest QUARTERLY period for MRQ context; latest ANNUAL for FY context.

    const latestAnnual = periods.find((p) => p.fp === "FY");
    const latestQuarter = periods.find((p) => p.fp !== "FY");
    const latestEnd = latestQuarter?.end ?? latestAnnual?.end ?? null;

    // TTM = sum of latest 4 quarters (regardless of FY boundary)
    function ttm(conceptKey: string): number | null {
      const bucket = flowBuckets[conceptKey];
      if (!bucket) return null;
      const sortedQ = [...bucket.quarterly.entries()]
        .sort((a, b) => (a[1].end < b[1].end ? 1 : -1));
      if (sortedQ.length === 0) {
        // fallback to latest annual
        const sortedA = [...bucket.annual.entries()].sort((a, b) =>
          a[1].end < b[1].end ? 1 : -1,
        );
        return sortedA[0]?.[1].val ?? null;
      }
      if (sortedQ.length < 4) {
        const sortedA = [...bucket.annual.entries()].sort((a, b) =>
          a[1].end < b[1].end ? 1 : -1,
        );
        return sortedA[0]?.[1].val ?? null;
      }
      return sortedQ.slice(0, 4).reduce((s, [, u]) => s + u.val, 0);
    }

    function pit(conceptKey: string): number | null {
      const bucket = instantBuckets[conceptKey];
      if (!bucket) return null;
      const merged = [
        ...bucket.quarterly.values(),
        ...bucket.annual.values(),
      ].sort((a, b) => (a.end < b.end ? 1 : -1));
      return merged[0]?.val ?? null;
    }

    const revenueTTM = ttm("Revenue");
    const cogsTTM = ttm("CostOfRevenue");
    let grossProfitTTM = ttm("GrossProfit");
    if (grossProfitTTM === null && revenueTTM !== null && cogsTTM !== null) {
      grossProfitTTM = revenueTTM - cogsTTM;
    }
    const opIncomeTTM = ttm("OperatingIncome");
    const netIncomeTTM = ttm("NetIncome");
    const netIncomeToCommonTTM = ttm("NetIncomeToCommon") ?? netIncomeTTM;
    const epsDilutedTTM = ttm("EPSDiluted");
    const ocfTTM = ttm("OpCashFlow");
    const capExTTM = ttm("CapEx");
    const daTTM = ttm("DepreciationAmortization");
    const dividendsPaidTTM = ttm("DividendsPaid");

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

    const ebitdaTTM =
      opIncomeTTM !== null && daTTM !== null ? opIncomeTTM + daTTM : opIncomeTTM;

    // Quarterly YoY growth
    function quarterlyYoY(conceptKey: string): number | null {
      const bucket = flowBuckets[conceptKey];
      if (!bucket) return null;
      const sortedQ = [...bucket.quarterly.values()].sort((a, b) =>
        a.end < b.end ? 1 : -1,
      );
      const latest = sortedQ[0];
      if (!latest) return null;
      const targetEnd = new Date(latest.end);
      targetEnd.setUTCFullYear(targetEnd.getUTCFullYear() - 1);
      const prev = sortedQ.find(
        (u) =>
          Math.abs(new Date(u.end).getTime() - targetEnd.getTime()) <
          20 * 86400000,
      );
      if (!prev || prev.val === 0) return null;
      return (latest.val - prev.val) / prev.val;
    }

    const revQYoY = quarterlyYoY("Revenue");
    const niQYoY = quarterlyYoY("NetIncome");

    // Recent submissions
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
          url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${acc}-index.htm`,
        });
      }
    }
    const recent10K = filings.filter((f) => f.form === "10-K").slice(0, 5);
    const recent8K = filings.filter((f) => f.form === "8-K").slice(0, 10);
    const recentDEF14A = filings.filter((f) => f.form === "DEF 14A").slice(0, 3);

    const mostRecent10K = recent10K[0];
    const fiscalYearEnd = mostRecent10K?.reportDate ?? null;
    const fiscalYear = fiscalYearEnd ? Number(fiscalYearEnd.slice(0, 4)) : null;

    const snapshot = {
      ticker,
      entityName: resolved.name,
      cik: resolved.cik,
      latestEnd,
      fiscalYear,
      fiscalYearEnd,
      mostRecentQuarterEnd: latestQuarter?.end ?? null,

      profitMargin: safeDiv(netIncomeTTM, revenueTTM),
      operatingMargin: safeDiv(opIncomeTTM, revenueTTM),
      returnOnAssets: safeDiv(netIncomeTTM, totalAssetsMRQ),
      returnOnEquity: safeDiv(netIncomeToCommonTTM, totalEquityMRQ),

      revenueTTM,
      revenuePerShareTTM: safeDiv(revenueTTM, sharesOutstanding),
      quarterlyRevenueGrowthYoY: revQYoY,
      grossProfitTTM,
      ebitdaTTM,
      netIncomeToCommonTTM,
      dilutedEPSTTM: epsDilutedTTM,
      quarterlyEarningsGrowthYoY: niQYoY,

      totalCashMRQ,
      totalCashPerShareMRQ: safeDiv(totalCashMRQ, sharesOutstanding),
      totalDebtMRQ,
      totalDebtToEquityMRQ:
        totalDebtMRQ !== null && totalEquityMRQ ? totalDebtMRQ / totalEquityMRQ : null,
      currentRatioMRQ: safeDiv(currentAssetsMRQ, currentLiabMRQ),
      bookValuePerShareMRQ: safeDiv(totalEquityMRQ, sharesOutstanding),

      operatingCashFlowTTM: ocfTTM,
      leveredFreeCashFlowTTM:
        ocfTTM !== null && capExTTM !== null ? ocfTTM - capExTTM : null,

      sharesOutstanding,

      forwardAnnualDividendRate: dividendPerShareTTM,
      trailingAnnualDividendRate: dividendPerShareTTM,
      payoutRatio: safeDiv(dividendsPaidTTM, netIncomeTTM),
    };

    return new Response(
      JSON.stringify({
        snapshot,
        periods,
        filings: { recent10K, recent8K, recentDEF14A },
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
