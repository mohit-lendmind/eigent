# Recon: MoneySavingExpert Mortgage Best Buys (browser-use sourcing target)

Date: 2026-08-20. Method: live Chrome session (Claude browser pane) + WebFetch/WebSearch + curl probe. Read-only; no auth, no form submission beyond the tool's own search.

## 1. Entry URLs and flow

The tool is a single React SPA mounted at `https://www.moneysavingexpert.com/mortgages/best-buys/` (bundle: `/mse/best-buys/assets/index-CAnw-H3E.js`, config at `/mse/best-buys/config.js`). The subdomain `mortgages.moneysavingexpert.com` does NOT exist (NXDOMAIN) — ignore it.

Three flows, each with a deep-linkable results URL (the SPA reads and rewrites query params; **deep links fully drive the tool** — no clicking needed to run a search):

- Home mover:
  `https://www.moneysavingexpert.com/mortgages/best-buys/home-purchase/results?mortgageChannel=HomePurchase&repaymentMethod=Repayment&addFeesToBalance=false&requiredTermYears=25&propertyValue=400000&depositAmount=170000&sortResultsBy=MonthlyPayment&firstTimeBuyer=false&borrowMore=false&onlyShowWithNoUpfrontFees=false`
- First-time buyer:
  `https://www.moneysavingexpert.com/mortgages/best-buys/first-time-buyer/results?mortgageChannel=FirstTimeBuyer&repaymentMethod=Repayment&addFeesToBalance=false&requiredTermYears=25&propertyValue=280000&depositAmount=80000&sortResultsBy=MonthlyPayment&firstTimeBuyer=true&borrowMore=false&onlyShowWithNoUpfrontFees=false`
- Remortgage:
  `https://www.moneysavingexpert.com/mortgages/best-buys/remortgage/results?mortgageChannel=Remortgage&repaymentMethod=Repayment&addFeesToBalance=false&requiredTermYears=20&requiredTermMonths=0&propertyValue=360000&mortgageAmount=160000&sortResultsBy=MonthlyPayment&firstTimeBuyer=false&borrowMore=false&onlyShowWithNoUpfrontFees=false`

Old-style params seen in Google-indexed URLs (`mortgagetype=REMORTGAGE&amountborrow=...&propertyworth=...`) are legacy and are ignored — the SPA falls back to defaults. Use the schema above.

Flow steps if driving the form instead of deep links:
1. Land on `/mortgages/best-buys/` → cookie-consent modal ("Accept our cookies?") — click **"Essential only"** (results do not render until consent is answered).
2. Select "What are you looking for?" → Remortgage / First-time buyer / Home mover.
3. Fill Property value + Deposit amount (purchase flows) or Balance left to pay (remortgage). Tool live-computes "Your borrowing amount is £X and your loan-to-value ratio is Y%".
4. Pick Mortgage term, Repayment method; optionally tick filters.
5. Click "UPDATE RESULTS". Results paginate 10 at a time via "SEE MORE DEALS".

## 2. Input fields (exact DOM ids, values, validation)

Shared:
- `journey__mortgageChannel` (select): `Remortgage` | `FirstTimeBuyer` | `HomePurchase` (labels: Remortgage / First-time buyer / Home mover)

Purchase flows (FTB + home mover share the `enquiry_purchase__*` namespace):
- `enquiry_purchase__propertyValue` — text input, `inputmode=numeric`, displays comma-grouped (e.g. `300,000`); URL param `propertyValue` is plain integer
- `enquiry_purchase__depositAmount` — same format; URL param `depositAmount`
- `enquiry_purchase__requiredTermYears` — select, integer values 1–40; URL `requiredTermYears` (remortgage also carries `requiredTermMonths`)
- `enquiry_purchase__repaymentMethod` — select: `Repayment` | `InterestOnly`
- `enquiry_purchase__addFeesToBalance` — checkbox → URL `addFeesToBalance=true|false`

Remortgage flow (`enquiry_remortgage__*`):
- `enquiry_remortgage__propertyValue`, `enquiry_remortgage__mortgageAmount` (label: "Balance left to pay") → URL `mortgageAmount`
- `enquiry_remortgage__borrowMore` — toggle "Do you want to borrow more?" → URL `borrowMore=true|false`
- plus term/repayment/fees fields as above

Filters (optional):
- Product type checkboxes `...__productTypes--{Fixed|Variable|Discounted|Tracker}` (labels: Fixed rate / Standard variable / Discounted variable / Tracker)
- Initial-term checkboxes `...__termTypes--{TwoYears|ThreeYears|FiveYears|FiveYearsPlus|Lifetime}`
- Lender filter: "(81) All lenders" multi-select
- `filters_*__onlyShowWithNoUpfrontFees`, `filters_*__onlyWithoutERC`
- Sort: `product-sort-selection` select: `InitialRate` | `MonthlyPayment` | `MseTotalCost` | `SetUpFees` → URL `sortResultsBy`

## 3. Output structure per product row

Rendered row shows: initial-term badge (e.g. "2 YEARS TRACKER"), lender logo (image — lender NAME is not in visible text; get it from the API JSON or img alt/src), Initial rate % ("For 24 months" / "Until 31/12/2028"), Monthly payment £, Set-up fees £ ("One off"), APRC %, "MSE total cost" £ ("For year 1"), HOW TO APPLY, and availability line: "Available direct from the lender or via a broker" / "This product is only available from a broker" / "This product is only available from the lender".

**Better: read the JSON API.** The SPA calls (same-origin, session-cookied):
- `POST /mse/best-buys/api/v1/session` → session bootstrap
- `POST /mse/best-buys/api/v1/enquiry` → full results JSON (10/page, `pagesAvailable`, `totalProductsFiltered`)
- `GET /mse/best-buys/api/v1/topical-messages`, `POST .../events` (analytics)

Per-product JSON fields (observed): `id`, `name` (internal product name, includes "DIRECT ONLY" markers and LTV notes), `lender.{name,logoUrl,code,clientReference}`, `category.{productType,termInYears,lifetime}`, `initialInterestRate`, `initialTermMonths`, `initialTermEndDate`, `initialTermMonthlyPayment`, `interestRates[]` (each: rate, rateType Tracker/Variable/Fixed, basisRate Base/SVR, months, monthlyPayment, starting/remainingBalance — includes the revert-to SVR leg), `fees[]` (feeType Arrangement/Booking/ValuationSurvey/CHAPS/Other, amount, timing, canAddFeeToLoan), `incentives[]` (Cashback with maxAmount, ValuationFeeContribution, etc.), `earlyRepayment.overpayment.accepted`, `schemes[]` (Green/SharedOwnership/SharedEquity/HelpToBuy/Offset availability), `property.locations` (England/Wales/Scotland/NorthernIreland), `costs{aprc, totalFees, productFees, initialTermCost, simpleAnnualisedIntroCost` (= "MSE total cost" year-1 figure)`, totalCost, repayments, interest, costOfDeal{...}}`, `distributions` (["Broker","Direct"]), `fulfilments[]` — application routes: direct lender URL (sometimes affiliate-tracked via `clk.omgt1.com`, flagged `isCommercial`), broker URL (`landc.co.uk` — L&C is the tied broker) and L&C phone number.

Data provider: **Podium Solutions** (lender logos served from `cdn.live.podium-solutions.co.uk/static/clients/mse/...`).

## 4. Anti-automation

- **Cloudflare**: plain `curl` (even with browser UA) gets a Cloudflare *managed challenge* ("Just a moment...") on `/mortgages/best-buys/`. A real browser passes silently (invisible `jsd/oneshot` challenge fires post-load). Headless-browser automation must be non-obvious (real Chrome profile is fine); raw HTTP scraping of the page is blocked.
- **WebFetch-class AI agents**: robots.txt explicitly welcomes agentic AI (`Content-Signal: ai-train=yes, search=yes, ai-input=yes` for CCBot/ClaudeBot/GPTBot etc., no disallows) — and MSE's Cloudflare config let our AI fetcher through on some pages, but the tool itself is client-rendered so fetch-only agents see just the page title. Browser required.
- **robots.txt** (`https://www.moneysavingexpert.com/robots.txt`): no Disallow on `/mortgages/`; general disallows only for /cache/, /includes/, /redir/ etc. No crawl-delay.
- **Consent wall**: OneTrust-style modal (`/cookie-consent-v2/msmCookieConsent.js`) blocks the UI until answered. "Essential only" works and results render.
- **Client-rendered**: 100% JS (Vite/React). Results need ~2–4s after consent. Session handshake (`POST .../session`) precedes the enquiry call — calling the enquiry API standalone without the session cookie/CSRF context is untested and likely Cloudflare-gated.
- No CAPTCHA, no login, no visible rate-limit headers observed in normal single-user use.

## 5. Personalization / evidence-source caveats

- Results are **illustrative, not lender-verified**: no credit check, income, or eligibility assessment — purely LTV/term/type-filtered product tables. Eligibility notes are limited (e.g. "Home Buyer Only", green/EPC A-B conditions embedded in product names, scheme availability flags).
- Coverage, in their own words: "We aim to bring you the most powerful mortgage best buy table possible, including all deals available to brokers and crucially direct-only deals too. And we don't promote 'featured commercial partners'." Their cheap-mortgages guide adds: MSE's tool "has all deals available direct, plus most available through brokers" but "it's very hard for mortgage comparison sites to know about every single deal."
- So: **near-whole-of-market but not guaranteed complete** — do not cite as whole-of-market evidence; cite as "MSE Best Buys (Podium Solutions data), includes direct-only deals, N products for the case". 81 lenders in the filter list; ~1,746 products for a vanilla 58%-LTV home-mover case.
- "MSE total cost" = their own year-1 true-cost metric (`simpleAnnualisedIntroCost`: 12 monthly payments + set-up fees annualised over the intro term). APRC also shown per row.
- Broker fulfilment is exclusively L&C; some direct links are affiliate-tracked (`isCommercial: true`). Regulatory footer on every results page: "Your home may be repossessed if you do not keep up repayments on your mortgage."

## 6. Fallback sources to spec

- **Rightmove mortgage tools** (rightmove.co.uk/mortgages) — rate-check + monthly-cost calculator powered by a broker feed; good for sanity-checking a case.
- **Moneyfacts** (moneyfactscompare.co.uk) — the classic best-buy-table publisher; closest to whole-of-market product data, server-rendered tables, easier to scrape.
- **MoneySuperMarket / CompareTheMarket / Uswitch mortgage channels** — comparison tables with similar inputs; commercial panels, not whole-of-market.
- **L&C (landc.co.uk)** — free broker; its online mortgage-finder is effectively the same fulfilment MSE hands off to.
- **Lender direct rate pages** — HSBC, Halifax, Nationwide, Santander, Barclays, NatWest all publish full product/rate PDFs or tables; authoritative for direct-only deals, one lender at a time.
- **Bank of England / FCA data** — Bankstats average quoted rates for benchmarking a case rate vs market average (not product-level).

## Automation recipe (TL;DR for the sourcing agent)

1. Launch real Chrome, navigate to the flow-specific deep link with case params (Section 1 schema).
2. Dismiss cookie modal via "Essential only" button.
3. Wait for `POST /mse/best-buys/api/v1/enquiry` (200) — scrape its JSON response from the network layer rather than the DOM (lender names are logo images in the DOM).
4. Page via "SEE MORE DEALS" (10 products/page, `pagesAvailable` in JSON) or re-issue with `pageNumber`.
5. Record `enquiryId`, timestamp, sort order, and the coverage caveat (Section 5) alongside extracted products.
