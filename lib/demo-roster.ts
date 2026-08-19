import { AssetClass, Chamber, Party, Politician } from "./types";
import { politicianId } from "./normalize";

/**
 * Demo roster for the built-in simulator.
 *
 * These filers are FICTIONAL, on purpose. The simulator invents transactions,
 * and attributing invented trades to real, named officials would manufacture
 * financial records about identifiable people — a screenshot of that is
 * misinformation even with a "simulated" banner on it. So the demo dataset uses
 * invented filers with realistic structure (chamber, party, state, district,
 * committee assignments), and real officials' names appear in this dashboard
 * only when a live provider is configured and returns actual filings.
 *
 * Tickers referenced by the simulator are real public-company symbols, which is
 * fine: they identify securities, not people.
 */

interface DemoFiler {
  name: string;
  chamber: Chamber;
  party: Party;
  state: string;
  district?: number;
  role: string;
  committees: string[];
  /** Relative portfolio weight — drives which tier they land in. */
  weight: number;
  /** Asset classes this filer favours, so profiles look individuated. */
  bias: AssetClass[];
}

const FILERS: DemoFiler[] = [
  // --- Very large portfolios (land in MEGA) ---
  { name: "Jordan Avery", chamber: "house", party: "D", state: "CA", district: 12, role: "Representative", committees: ["Financial Services", "Ways and Means"], weight: 62, bias: ["stock", "option", "etf"] },
  { name: "Marcus Whitfield", chamber: "senate", party: "R", state: "TX", role: "Senator", committees: ["Banking, Housing, and Urban Affairs", "Finance"], weight: 55, bias: ["stock", "corporate_bond", "reit"] },
  { name: "Eleanor Vance", chamber: "senate", party: "D", state: "NY", role: "Senator", committees: ["Commerce, Science, and Transportation"], weight: 48, bias: ["stock", "etf", "municipal_bond"] },
  { name: "Charles Okonkwo", chamber: "house", party: "R", state: "FL", district: 7, role: "Representative", committees: ["Energy and Commerce"], weight: 41, bias: ["stock", "treasury"] },
  { name: "Diane Sutcliffe", chamber: "executive", party: "unknown", state: "US", role: "Cabinet Secretary", committees: [], weight: 38, bias: ["treasury", "mutual_fund", "etf"] },

  // --- Large ---
  { name: "Raymond Castellanos", chamber: "house", party: "D", state: "IL", district: 4, role: "Representative", committees: ["Appropriations"], weight: 27, bias: ["stock", "etf"] },
  { name: "Priya Raghunathan", chamber: "house", party: "D", state: "WA", district: 9, role: "Representative", committees: ["Science, Space, and Technology"], weight: 24, bias: ["stock", "ipo"] },
  { name: "Thomas Beaulieu", chamber: "senate", party: "R", state: "LA", role: "Senator", committees: ["Armed Services", "Energy and Natural Resources"], weight: 22, bias: ["stock", "corporate_bond"] },
  { name: "Katherine Lindqvist", chamber: "senate", party: "I", state: "VT", role: "Senator", committees: ["Health, Education, Labor, and Pensions"], weight: 19, bias: ["mutual_fund", "treasury"] },
  { name: "Andre Mbeki", chamber: "house", party: "R", state: "OH", district: 3, role: "Representative", committees: ["Transportation and Infrastructure"], weight: 17, bias: ["stock", "reit"] },
  { name: "Susan Kalani", chamber: "house", party: "D", state: "HI", district: 1, role: "Representative", committees: ["Natural Resources"], weight: 15, bias: ["etf", "municipal_bond"] },
  { name: "Gregory Halstead", chamber: "senate", party: "R", state: "IN", role: "Senator", committees: ["Judiciary"], weight: 14, bias: ["stock", "option"] },

  // --- Medium ---
  { name: "Naomi Feldstein", chamber: "house", party: "D", state: "MA", district: 5, role: "Representative", committees: ["Education and the Workforce"], weight: 9.5, bias: ["stock", "etf"] },
  { name: "Victor Ramirez", chamber: "house", party: "R", state: "AZ", district: 6, role: "Representative", committees: ["Homeland Security"], weight: 8.8, bias: ["stock", "crypto"] },
  { name: "Yolanda Pierce", chamber: "house", party: "D", state: "GA", district: 13, role: "Representative", committees: ["Oversight and Accountability"], weight: 7.9, bias: ["etf", "mutual_fund"] },
  { name: "Samuel Draycott", chamber: "senate", party: "D", state: "CO", role: "Senator", committees: ["Agriculture, Nutrition, and Forestry"], weight: 7.2, bias: ["stock", "treasury"] },
  { name: "Hana Sorensen", chamber: "house", party: "D", state: "MN", district: 2, role: "Representative", committees: ["Veterans' Affairs"], weight: 6.4, bias: ["etf", "stock"] },
  { name: "Lionel Boudreaux", chamber: "house", party: "R", state: "MS", district: 2, role: "Representative", committees: ["Agriculture"], weight: 5.6, bias: ["stock", "corporate_bond"] },
  { name: "Georgina Achebe", chamber: "executive", party: "unknown", state: "US", role: "Agency Administrator", committees: [], weight: 5.1, bias: ["mutual_fund", "treasury"] },
  { name: "Peter Nakamura", chamber: "house", party: "R", state: "NV", district: 2, role: "Representative", committees: ["Small Business"], weight: 4.5, bias: ["stock", "crypto"] },
  { name: "Rosalind Etheridge", chamber: "senate", party: "R", state: "SC", role: "Senator", committees: ["Foreign Relations"], weight: 3.9, bias: ["stock", "etf"] },
  { name: "Curtis Delacroix", chamber: "house", party: "D", state: "MI", district: 11, role: "Representative", committees: ["Budget"], weight: 3.3, bias: ["etf", "municipal_bond"] },

  // --- Small ---
  { name: "Alina Petrov", chamber: "house", party: "D", state: "NJ", district: 8, role: "Representative", committees: ["Foreign Affairs"], weight: 2.1, bias: ["mutual_fund"] },
  { name: "Desmond Frye", chamber: "house", party: "R", state: "TN", district: 5, role: "Representative", committees: ["Rules"], weight: 1.7, bias: ["stock"] },
  { name: "Beatrice Nwosu", chamber: "house", party: "D", state: "MD", district: 4, role: "Representative", committees: ["Ethics"], weight: 1.3, bias: ["treasury", "mutual_fund"] },
  { name: "Harold Ingram", chamber: "senate", party: "R", state: "WY", role: "Senator", committees: ["Environment and Public Works"], weight: 1.1, bias: ["stock", "etf"] },
  { name: "Clara Nystrom", chamber: "house", party: "D", state: "OR", district: 3, role: "Representative", committees: ["Judiciary"], weight: 0.85, bias: ["etf"] },
  { name: "Isaiah Bramwell", chamber: "house", party: "R", state: "KY", district: 1, role: "Representative", committees: ["Armed Services"], weight: 0.6, bias: ["stock"] },
  { name: "Meredith Kang", chamber: "house", party: "D", state: "VA", district: 10, role: "Representative", committees: ["Intelligence"], weight: 0.45, bias: ["mutual_fund", "treasury"] },
  { name: "Omar Haddad", chamber: "house", party: "D", state: "PA", district: 2, role: "Representative", committees: ["Financial Services"], weight: 0.3, bias: ["crypto", "stock"] },
];

export interface DemoFilerWithId extends DemoFiler {
  id: string;
}

export const DEMO_FILERS: DemoFilerWithId[] = FILERS.map((f) => ({
  ...f,
  id: politicianId(f.name, f.chamber),
}));

export function demoRoster(): Map<string, Politician> {
  return new Map(
    DEMO_FILERS.map((f) => [
      f.id,
      {
        id: f.id,
        name: f.name,
        chamber: f.chamber,
        party: f.party,
        state: f.state,
        district: f.district,
        role: f.role,
        committees: f.committees,
      },
    ]),
  );
}

/** Asset universe for the simulator. Real symbols, invented transactions. */
export interface DemoAsset {
  ticker?: string;
  name: string;
  assetClass: AssetClass;
  /** Relative likelihood of being traded. */
  weight: number;
  /** Reference price used to seed the synthetic price series. */
  referencePrice?: number;
}

export const DEMO_ASSETS: DemoAsset[] = [
  { ticker: "NVDA", name: "NVIDIA Corporation", assetClass: "stock", weight: 10, referencePrice: 178 },
  { ticker: "MSFT", name: "Microsoft Corporation", assetClass: "stock", weight: 9.5, referencePrice: 508 },
  { ticker: "AAPL", name: "Apple Inc.", assetClass: "stock", weight: 9, referencePrice: 232 },
  { ticker: "AMZN", name: "Amazon.com, Inc.", assetClass: "stock", weight: 8, referencePrice: 231 },
  { ticker: "GOOGL", name: "Alphabet Inc. Class A", assetClass: "stock", weight: 7.5, referencePrice: 205 },
  { ticker: "META", name: "Meta Platforms, Inc.", assetClass: "stock", weight: 6.5, referencePrice: 742 },
  { ticker: "TSLA", name: "Tesla, Inc.", assetClass: "stock", weight: 6, referencePrice: 421 },
  { ticker: "AVGO", name: "Broadcom Inc.", assetClass: "stock", weight: 5, referencePrice: 342 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", assetClass: "stock", weight: 5, referencePrice: 289 },
  { ticker: "UNH", name: "UnitedHealth Group Incorporated", assetClass: "stock", weight: 4, referencePrice: 312 },
  { ticker: "LMT", name: "Lockheed Martin Corporation", assetClass: "stock", weight: 3.8, referencePrice: 468 },
  { ticker: "RTX", name: "RTX Corporation", assetClass: "stock", weight: 3.5, referencePrice: 158 },
  { ticker: "XOM", name: "Exxon Mobil Corporation", assetClass: "stock", weight: 3.5, referencePrice: 118 },
  { ticker: "CVX", name: "Chevron Corporation", assetClass: "stock", weight: 3, referencePrice: 155 },
  { ticker: "PFE", name: "Pfizer Inc.", assetClass: "stock", weight: 2.8, referencePrice: 25 },
  { ticker: "LLY", name: "Eli Lilly and Company", assetClass: "stock", weight: 2.8, referencePrice: 795 },
  { ticker: "COST", name: "Costco Wholesale Corporation", assetClass: "stock", weight: 2.5, referencePrice: 925 },
  { ticker: "WMT", name: "Walmart Inc.", assetClass: "stock", weight: 2.5, referencePrice: 102 },
  { ticker: "DIS", name: "The Walt Disney Company", assetClass: "stock", weight: 2.2, referencePrice: 113 },
  { ticker: "BA", name: "The Boeing Company", assetClass: "stock", weight: 2.2, referencePrice: 213 },
  { ticker: "GE", name: "GE Aerospace", assetClass: "stock", weight: 2, referencePrice: 275 },
  { ticker: "CAT", name: "Caterpillar Inc.", assetClass: "stock", weight: 2, referencePrice: 412 },
  { ticker: "NFLX", name: "Netflix, Inc.", assetClass: "stock", weight: 2, referencePrice: 1180 },
  { ticker: "CRM", name: "Salesforce, Inc.", assetClass: "stock", weight: 1.8, referencePrice: 262 },
  { ticker: "AMD", name: "Advanced Micro Devices, Inc.", assetClass: "stock", weight: 1.8, referencePrice: 168 },
  { ticker: "INTC", name: "Intel Corporation", assetClass: "stock", weight: 1.6, referencePrice: 24 },
  { ticker: "PLTR", name: "Palantir Technologies Inc.", assetClass: "stock", weight: 1.6, referencePrice: 172 },
  { ticker: "COIN", name: "Coinbase Global, Inc.", assetClass: "stock", weight: 1.4, referencePrice: 318 },
  { ticker: "NEE", name: "NextEra Energy, Inc.", assetClass: "stock", weight: 1.4, referencePrice: 72 },
  { ticker: "T", name: "AT&T Inc.", assetClass: "stock", weight: 1.2, referencePrice: 28 },
  { ticker: "KO", name: "The Coca-Cola Company", assetClass: "stock", weight: 1.2, referencePrice: 70 },
  { ticker: "MRK", name: "Merck & Co., Inc.", assetClass: "stock", weight: 1.2, referencePrice: 98 },

  // ETFs
  { ticker: "SPY", name: "SPDR S&P 500 ETF Trust", assetClass: "etf", weight: 7, referencePrice: 668 },
  { ticker: "QQQ", name: "Invesco QQQ Trust Series 1", assetClass: "etf", weight: 5, referencePrice: 592 },
  { ticker: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "etf", weight: 4, referencePrice: 328 },
  { ticker: "IWM", name: "iShares Russell 2000 ETF", assetClass: "etf", weight: 2.5, referencePrice: 242 },
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", assetClass: "etf", weight: 3.5, referencePrice: 614 },
  { ticker: "AGG", name: "iShares Core U.S. Aggregate Bond ETF", assetClass: "etf", weight: 2, referencePrice: 101 },
  { ticker: "ITA", name: "iShares U.S. Aerospace & Defense ETF", assetClass: "etf", weight: 1.5, referencePrice: 188 },

  // Bonds / treasuries
  { name: "U.S. Treasury Bill, 26-week", assetClass: "treasury", weight: 4 },
  { name: "U.S. Treasury Note, 10-year", assetClass: "treasury", weight: 3.5 },
  { name: "U.S. Series I Savings Bond", assetClass: "treasury", weight: 2 },
  { name: "California State GO Bond, Series 2031", assetClass: "municipal_bond", weight: 2.5 },
  { name: "New York City Municipal Water Finance Authority Revenue Bond", assetClass: "municipal_bond", weight: 2 },
  { name: "Texas Transportation Commission Municipal Bond", assetClass: "municipal_bond", weight: 1.5 },
  { name: "Apple Inc. Corporate Bond, note due 2032", assetClass: "corporate_bond", weight: 1.8 },
  { name: "Verizon Communications Corporate Bond, note due 2030", assetClass: "corporate_bond", weight: 1.5 },

  // Funds
  { name: "Vanguard 500 Index Fund Admiral Shares mutual fund", assetClass: "mutual_fund", weight: 4 },
  { name: "Fidelity Contrafund mutual fund", assetClass: "mutual_fund", weight: 3 },
  { name: "American Funds Growth Fund of America mutual fund", assetClass: "mutual_fund", weight: 2.5 },
  { name: "T. Rowe Price Blue Chip Growth mutual fund", assetClass: "mutual_fund", weight: 2 },

  // REITs, crypto, options, IPO
  { ticker: "AMT", name: "American Tower Corporation REIT", assetClass: "reit", weight: 1.5, referencePrice: 195 },
  { ticker: "PLD", name: "Prologis, Inc. REIT", assetClass: "reit", weight: 1.2, referencePrice: 108 },
  { name: "Bitcoin (BTC) digital asset", assetClass: "crypto", weight: 1.8 },
  { name: "Ethereum (ETH) digital asset", assetClass: "crypto", weight: 1.2 },
  { ticker: "NVDA", name: "NVIDIA Corporation call option, strike $200, expires 2027-01-15", assetClass: "option", weight: 1.2 },
  { ticker: "SPY", name: "SPDR S&P 500 ETF Trust put option, strike $600, expires 2026-12-18", assetClass: "option", weight: 1 },
  { name: "Cerulean Robotics Inc. IPO allocation", assetClass: "ipo", weight: 0.8 },
  { name: "Helios Fusion Systems IPO allocation", assetClass: "ipo", weight: 0.6 },
];
