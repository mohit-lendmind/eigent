# FCA Compliance Constraints for an Agentic UK Mortgage Advice Platform

**Product:** Lendmind — a mesh of AI agents assisting a human FCA-authorised mortgage adviser (typically an Appointed Representative (AR) under a network principal).
**Date of research:** 2026-08-20. Handbook citations verified against handbook.fca.org.uk on this date unless marked [VERIFY].
**Posture assumed:** every regulated output (advice, recommendation, suitability assessment, financial promotion) is approved by the human adviser before it reaches the client. This document defines where that line legally sits, not just where we choose to draw it.

Regulatory frame: the adviser's firm carries permissions for *advising on regulated mortgage contracts* and *arranging*; as an AR, the **principal (network) is responsible for the AR's regulated activities under s39 FSMA** and supervises them under SUP 12. Practically this means Lendmind's agent behaviour must be defensible not only to the FCA but to the **network's compliance function** — networks typically impose stricter file-check and promotions sign-off standards than the Handbook minimum. [VERIFY exact SUP 12 provision for network oversight duties — SUP 12.6 covers principals' continuing obligations.]

---

## 1. The advice boundary (MCOB 4.7A / MCOB 4.8A / PERG 4.6)

### 1.1 What counts as advice at all (PERG 4.6)

- **PERG 4.6.13G**: advice requires "an element of opinion... in effect, a recommendation as to a course of action." Information is "objective statements of facts and figures."
- **PERG 4.6.14G**: purely factual information does not become advice merely because it influences a decision — but a communication that goes beyond information and is *objectively likely to influence the customer's decision* can be advice.
- **PERG 4.6.16A** (implicit steering): the test is whether an impartial observer, given the full context, would conclude the customer could reasonably have understood the communication as advice. **Steering = advice even without the word "recommend."** "This is a very good deal, but it's your decision" is advice (PERG 4.6.16B–16C).
- **PERG 4.6.25B** (product filtering — directly on point for our sourcing/criteria agents): simple objective filtering (price, eligibility criteria) typically is not advice. But systems that **balance multiple customer preferences, or automated systems incorporating substantial customer data inputs, are "more likely" to be advising**. A criteria agent that ranks or shortlists "best for you" products from a fact find is on the advice side of the line.
- **PERG 4.6.21G–4.6.25G** (decision trees / pre-sale questioning): factual filter journeys presenting *balanced results matching stated criteria* avoid advice; journeys incorporating judgement, or highlighting specific products, likely involve advising. **PERG 4.6.22G**: the questioner must avoid making any judgement on the suitability of one or more products for the borrower.
- **PERG 4.6.5G–4.6.6G**: advice must relate to a *particular* regulated mortgage contract. "Fix your rate" generically is unregulated; "the HSBC 5yr fix at 4.1%" is particular.

**Design consequence:** any agent output that names particular products *and* ranks, filters on soft preferences, or contextualises them against the client's fact find is regulated advice territory. It must flow only to the human adviser, never directly to the client, until the adviser adopts it as their advice.

### 1.2 Advised sales — suitability (MCOB 4.7A)

- **MCOB 4.7A.2R**: firm must take reasonable steps to ensure a recommended contract is suitable for that customer.
- **MCOB 4.7A.5R**: suitable = appropriate to the customer's needs and circumstances, based on facts disclosed by the customer **and other relevant facts the firm is or should reasonably be aware of** (this captures everything the document-intelligence agent extracts — the firm is deemed aware of it), and there must be no recommendation if no suitable product exists in the firm's range.
- **MCOB 4.7A.6R**: mandatory suitability factors, including eligibility, whether the mortgage type/term is appropriate, payment stability needs, interest-rate exposure, early-repayment needs, product features, credit history, and how fees are treated (added to loan vs paid up front).
- **MCOB 4.7A.24R**: a customer who rejects advice may proceed execution-only only under the MCOB 4.8A.14R conditions.

### 1.3 Execution-only is effectively unavailable to us (MCOB 4.8A)

- **MCOB 4.8A.14R**: execution-only requires the customer to have identified the specific product themselves (lender, rate, term, amount, product type), be told the firm is not assessing suitability (4.8A.14R(4)), and make a **positive election** in writing or orally (4.8A.14R(5)).
- **MCOB 4.8A.16B**: **"interactive dialogue" includes SMS, mobile instant messaging, email and social media.** Any two-way channel conversation during the sale pulls the journey out of pure execution-only and triggers advised-sale obligations. Our onboarding and comms agents *are* interactive dialogue by definition.
- **MCOB 4.8A.7R**: execution-only prohibited anyway where the main purpose is debt consolidation, for right-to-buy, and shared-equity — common broker cases.
- **MCOB 4.8A.18R**: execution-only records kept minimum 3 years.

**Design consequence:** Lendmind should build the whole journey as an **advised sale**. Because agents talk to clients over interactive channels, we cannot plausibly claim execution-only, and shouldn't try. Every client-facing agent message must be written on the assumption it will be judged against the advised-sale standard.

### 1.4 Human vs agent split at the boundary

| Must remain a human adviser act | May be automated (with controls) |
|---|---|
| The personal recommendation itself and the suitability judgement (MCOB 4.7A.2R/5R) | Gathering and structuring fact-find data (information, not advice) |
| Signing off the suitability report / reasons-why letter | Producing draft suitability analysis *for the adviser* |
| Any client-facing statement of opinion about a particular product | Objective product/criteria/rate retrieval presented neutrally or adviser-only |
| Deciding to advise against or decline (no-suitable-product finding, 4.7A.5R) | Flagging eligibility failures to the adviser |
| Handling rejected-advice / insistent-client conversations | Scheduling, chasing documents, status updates (pure service comms) |

---

## 2. Disclosure obligations and timing (MCOB 4.4A / MCOB 5A)

### 2.1 Initial disclosure (MCOB 4.4A)

- **MCOB 4.4A.1R**: disclose whether there are limitations in the product range (scope of service).
- **MCOB 4.4A.4R**: a firm that is not "unlimited" in range must either name all lenders it uses (if an MCD credit intermediary) or state the number of lenders and offer the full list on request. **MCOB 4.4A.4R(3): the word "independent" may only be used if the firm's product consideration is unlimited across the market.** "Whole of market" representations must match the actual sourcing footprint — if the sourcing agent only drives MoneySavingExpert/one sourcing system, marketing and agent copy must not say or imply whole-of-market unless the panel genuinely is. This is the rule the comms-drafting agent is most likely to trip.
- **MCOB 4.4A.8R**: disclose fees charged and when payable, **whether the firm receives commission (procuration fees) from lenders**, and any offsetting arrangements. For MCD contracts, actual commission amounts not known at the outset are disclosed later via the ESIS.
- **MCOB 4.4A.12R** (timing): for MCD credit intermediaries, disclosure must be made **"in good time before carrying out any MCD credit intermediation activity"**; for advisers, before providing advice; for others, "during the course of the initial contact."
- **MCOB 4.4A.9R** (medium): MCD intermediaries must use a **durable medium**; where there is spoken interaction, key messages orally; in electronic non-spoken journeys, the customer must not be able to progress until the disclosure information has been conveyed.

**Does the onboarding agent's first email trigger disclosure?** The safe engineering answer is yes-in-substance: the first substantive contact that begins intermediation (inviting the client into the process, collecting documents for a mortgage application) is "initial contact" / the start of intermediation activity. The clean pattern: the onboarding agent's first email **carries the firm's initial disclosure document (scope of service, fee, commission statement) as a durable-medium attachment/link**, template locked by compliance, before any fact-find or document collection begins. That makes timing compliance a property of the workflow rather than a judgement call.

### 2.2 ESIS (MCOB 5A)

- **MCOB 5A.4.1R** (timing triggers): the ESIS must be provided (a) before the consumer submits an application, (2)(a) **where the firm advises: at the point the recommendation is made** (within 5 business days if by phone), (2)(c) in execution-only once the consumer indicates the product, and always (3)(a) "without undue delay after the consumer has given the necessary information" and (3)(b) "in good time before the consumer is bound."
- **MCOB 5A.4.9R**: the firm dealing directly with the consumer is responsible for ESIS content/timing compliance — i.e., **the intermediary firm, not the lender**, owns this when we drive the journey. [VERIFY precise provision number for the responsibility split — confirmed in substance on MCOB 5A.4.]
- **MCOB 5A.5.5R**: the ESIS must contain **only** the prescribed material and be a separate document; **MCOB 5A.6.1R**: extra information only in a separate annexed document. Agents must never "helpfully" merge ESIS content into a friendly summary email — an AI-rewritten ESIS is a breach, not an improvement. Rate-summary emails must be clearly distinct documents and must not mimic or dilute the ESIS.

**Agent touchpoint map:** onboarding agent first email → initial disclosure (4.4A). Adviser makes recommendation (drafted by agents, approved by human) → ESIS at that point (5A.4.1R(2)(a)), generated from sourcing-system output, delivered unmodified. Sourcing agent producing a shortlist shown only to the adviser → no ESIS trigger yet. Comms agent sending client rate summaries pre-recommendation → not an ESIS, but is a financial promotion (section 6) and must not be a pseudo-ESIS (5A.5.5R).

---

## 3. Suitability evidence and records (MCOB 4.7A.25R / MCOB 2.8 / SYSC 9)

- **MCOB 4.7A.25R**: keep a record of the customer information obtained, the reasons the contract was considered suitable, customer fee-payment choices, and cost explanations — **minimum 3 years from the date of advice**.
- **MCOB 4.8A.18R**: execution-only records, minimum 3 years.
- **MCOB 2.8.20R / 2.8.33G**: records must be readily accessible to the FCA — guidance: available within 2 business days of request. **MCOB 2.8.40R**: any form, including electronic, provided accurate and protected from unauthorised alteration (i.e., the audit trail must be tamper-evident). **MCOB 2.8.52G**: each MCOB rule sets its own retention period; firms may keep records longer.
- **SYSC 9.1.1R**: general obligation to keep orderly records of business and internal organisation sufficient for the FCA to monitor compliance. [VERIFY exact retention wording as applied to non-common-platform mortgage intermediaries — SYSC application to intermediaries is partly "guidance" rather than rule; check SYSC 1 Annex 1.]
- **Practical retention**: 3 years is the MCOB floor, but FOS complaints about mortgage advice can arrive decades later (mortgage term + 3 years from awareness under limitation rules). Industry and network standards are effectively **retain the advice file for the life of the mortgage plus 6 years**; build retention policy to that, with GDPR justification documented (section 8).

**What the agents must write to the file to make advice defensible:**

1. **Sourcing agent**: full result set (not just the shortlist) as returned by the sourcing portal, with timestamp, portal name/version, search inputs used, and screenshots/exports of the run. This evidences "research of the market" and why the recommended product beat alternatives. Browser-use agents must capture the evidence at execution time — sourcing results are unreproducible hours later as rates churn.
2. **Criteria agent**: which lender criteria were checked, source (criteria system/lender page + date), and pass/fail reasoning per lender excluded — exclusions are as important to suitability as inclusions (MCOB 4.7A.5R(3): no recommendation if nothing suitable).
3. **Affordability agent**: inputs, assumptions, calculator versions, lender-calculator outputs with timestamps.
4. **Document intelligence agent**: source document → extracted field mapping, confidence, and **what the human verified**. If the fact find is machine-populated, the file must show human verification of material fields (income, commitments) because the suitability assessment legally rests on facts "the firm is or should reasonably be aware of" (MCOB 4.7A.5R) — extraction errors become the firm's knowledge problem.
5. **Every agent**: prompt/version identifiers and the approving human's identity and timestamp for anything that left the building. This is also what the FCA's AI Update expects of governance (section 7).

---

## 4. Affordability and stress testing (MCOB 11.6 / FPC)

- **MCOB 11.6.2R**: the **mortgage lender** must assess whether the customer can pay the sums due before entering/varying the contract. Affordability is legally the lender's assessment.
- **MCOB 11.6.9G(6)**: a lender may use information from an intermediary but "retain[s] responsibility for compliance."
- **MCOB 11.6.8R**: income must be evidenced, the evidence source **independent of the customer**, and **self-certification of income is prohibited**.
- **MCOB 11.6.18R**: lenders must consider the effect of market-expected interest-rate rises over a **minimum of 5 years**, assuming rates rise by a **minimum of 1 percentage point** even if market expectation is lower.
- **FPC**: the FPC's own affordability-test Recommendation (reversion rate + 3pp) was **withdrawn from 1 August 2022** (Bank of England confirmation, June 2022). The **LTI flow limit remains**: no more than 15% of a lender's new residential mortgages at ≥4.5× income. Lender calculators embody both MCOB 11.6.18R stress and LTI caps.

**What our affordability agent may and may not claim:**
- MAY: run indicative affordability/stress models, replicate lender calculators, compare likely maximum borrowing across lenders, flag stress-test risk to the adviser, pre-check LTI banding.
- MUST NOT: present output to the client as a decision or promise ("you can afford £X", "you will be approved"). Every client-visible affordability figure must be labelled **indicative, subject to the lender's own affordability assessment and underwriting** (MCOB 11.6.2R makes the lender's assessment the operative one).
- MUST NOT: coach data to fit (e.g., suggesting the client restate income or omit commitments) — that walks into false-information territory and mortgage fraud, and the adviser's suitability duty independently requires accurate expenditure capture.
- SHOULD: record the stressed-rate scenario shown to the adviser, since ability-to-pay under rate rises is a suitability factor (MCOB 4.7A.6R interest-rate-exposure limb).

---

## 5. Consumer Duty (PRIN 12 / PRIN 2A / PS22/9 / FG22/5 / FG21/1)

**Principle 12** (PRIN 2A operationalises it): "A firm must act to deliver good outcomes for retail customers." In force for open products since July 2023, closed products July 2024 (FCA AI Update, para 3.23). Applies to the AR's principal and through the distribution chain — including to outcomes produced *by our agents*.

Cross-cutting rules: **PRIN 2A.2.1R** act in good faith; **PRIN 2A.2.8R** avoid foreseeable harm; **PRIN 2A.2.14R** enable and support customers to pursue their financial objectives. The FCA has said in terms that **AI that embeds or amplifies bias, causing worse outcomes for some groups, "might not be acting in good faith"** (AI Update para 3.26, citing PS22/9 and FG22/5).

The four outcomes applied to agentic journeys:

1. **Products & services (PRIN 2A.3)**: the *advice service as designed* — including its agentic delivery — must meet the needs of the target market. Distributor obligations (PRIN 2A.3.14R) apply to intermediaries. An automated intake that structurally underserves offline/low-digital-confidence customers is a design defect under this outcome.
2. **Price & value (PRIN 2A.4.2R–4.3R)**: fee + procuration income must represent fair value for the service. Automation lowering the firm's cost-to-serve while fees stay static is exactly the kind of question networks' fair-value assessments now ask; keep the value assessment updated as agent leverage grows.
3. **Consumer understanding (PRIN 2A.5.3R, 2A.5.8R, 2A.5.10R)**: communications must meet information needs, be tailored to characteristics **including vulnerability**, and — critically for the comms-drafting agent — **firms must test communications where appropriate (PRIN 2A.5.10R)**. AI-drafted client comms need: template-level compliance approval, plain-language testing, and outcome monitoring (did clients act as informed readers would?). Free-form per-client generation without a tested template is hard to defend.
4. **Consumer support (PRIN 2A.6.2R)**: support must work for vulnerable customers and must not create unreasonable barriers (2A.6.2R(4)). An agent-only channel with no easy path to a human is a sludge-practice red flag; every agent touchpoint needs a visible "talk to your adviser" escape hatch.

**Vulnerability in automated intake (FG21/1, Guidance for firms on the fair treatment of vulnerable customers):** technology-agnostic and explicitly applies to firms "using AI or data solutions" (AI Update para 3.28–3.29). Requirements in practice:
- The intake flow must be able to **detect and record vulnerability signals** (health, life events, resilience, capability) — the watcher/onboarding agents should route flagged cases to the human adviser rather than advancing the workflow automatically.
- QA processes must exist to find where the automated service unintentionally harms vulnerable customers (FG21/1, per AI Update 3.29).
- Vulnerability flags recorded on the file feed the suitability assessment (MCOB 4.7A.5R "should reasonably be aware") and constrain execution-only anyway (MCOB 4.8A).

---

## 6. Financial promotions (s21 FSMA / MCOB 3A)

**When is the comms agent's "best rates" email a financial promotion?** s21 FSMA: an invitation or inducement to engage in investment activity (which includes entering a regulated mortgage contract via "qualifying credit"), communicated in the course of business. A rate summary that showcases products and invites the client to proceed is an inducement — treat client-facing rate content as a **non-real-time financial promotion of qualifying credit** unless it is purely administrative.

- **Who may communicate/approve**: promotions must be communicated by, or their content approved by, an authorised person (s21). For an AR, **the principal/network approves promotions** — an AI agent cannot be the approver, and in most networks the AR cannot self-approve either. The s21 approver-gateway regime (in force Feb 2024) applies to approving promotions *for unauthorised persons*; within the AR relationship the principal's approval processes govern. Design: comms agent drafts → adviser reviews → only network-approved templates with locked risk warnings are sendable.
- **MCOB 3A.2.1R**: all customer communications fair, clear and not misleading; **MCOB 3A.2.4R**: for non-real-time qualifying-credit promotions the firm must be able to **demonstrate reasonable steps** to ensure this (i.e., keep the approval record).
- **MCOB 3A.3.1R**: promotions must be accurate, balanced, and must not emphasise benefits **"without also giving a fair and prominent indication of any relevant risks."**
- **MCOB 3A.3.2R**: non-real-time promotions must include the firm's name and a contact point.
- **MCOB 3A.3.5R**: no cold-calling qualifying credit without an established relationship.
- **MCOB 3A.5.1R–5.4R** (MCD promotions): where a promotion **indicates an interest rate or any figures relating to cost**, it must include the standard information (identity, security, rate type, total credit amount, **APRC**, duration, instalments, total payable) "clear, concise and prominent," given **by means of a representative example** (3A.5.2R), "representative" meaning ≥51% of responding consumers would be expected to get that rate or better (3A.5.3R). **This is the big one for the comms agent: quoting rates without the representative-example apparatus breaches MCOB 3A.5.** Either send rate content with full representative-example formatting, or keep pre-recommendation client comms rate-free.
- **Risk warning**: the famous prescribed wording "**Your home may be repossessed if you do not keep up repayments on your mortgage**" was the hard-wired rule at MCOB 3.6.13R in the pre-2016 sourcebook; the current MCOB 3A does not restate it verbatim as a universal rule [VERIFY — no verbatim rule found in MCOB 3A.2–3A.5 on inspection], but MCOB 3A.3.1R's fair-and-prominent-risk requirement is in practice satisfied by exactly this wording, it remains the universal market standard, and ASA/BCAP and network promotions rules expect it. **Hard-code it into every rate-bearing template**, with the debt-consolidation companion warning ("Think carefully before securing other debts against your home") whenever consolidation is in scope.

**Practical rule for the comms agent:** two message classes only — (a) *service messages* (document chasing, appointment logistics, status): no promotion content, no product names/rates, may be sent autonomously from approved templates; (b) *promotional/product messages* (anything naming products, rates, "deals"): generated only from network-approved templates with representative example + risk warning, individually released by the human adviser, archived with approval metadata.

---

## 7. Automation and AI accountability (SYSC / SM&CR / FCA AI Update 2024 / DP5/22)

**FCA's stated position (AI Update, April 2024):** technology-agnostic, principles-based, outcomes-focused; no new AI rulebook — existing framework applies (paras 3.2–3.5). Key mappings the FCA itself makes:

- **Principles 2 & 3** (skill/care/diligence; management and control) apply to AI use (para 3.10). **Principle 9** (suitability of advice) called out for advice firms (para 3.27).
- **SYSC 4.1.1R**: robust governance, clear lines of responsibility, effective risk processes, "effective control and safeguard arrangements for information processing systems" (para 3.39) — the anchor rule for agent-mesh governance.
- **SYSC 7** risk controls; **SYSC 4.1** business continuity (para 3.12).
- **SYSC 15A operational resilience**: identify Important Business Services, set impact tolerances, remain within them under severe-but-plausible scenarios — explicitly includes "a firm's use of AI where it supports an IBS" (paras 3.13–3.14). (Applies directly to enhanced firms/lenders; small intermediary firms are largely out of SYSC 15A scope but networks apply equivalents. [VERIFY scope for the specific principal.])
- **SYSC 8 outsourcing**: reasonable steps to avoid undue operational risk when outsourcing critical functions; see also **FG16/5** cloud/third-party IT guidance (para 3.15). **The firm remains fully responsible for regulatory compliance regardless of outsourcing.** Lendmind-the-vendor is an outsourced critical service to the advice firm/network — expect due-diligence, audit-access and exit-plan clauses; build for them (export-everything, model/version documentation).
- **Critical Third Parties regime** (CP26/23 → now in force): systemic AI/cloud providers can be designated; broad enough to cover common AI models (para 3.17).
- **SM&CR** (paras 3.40–3.41): no dedicated AI Senior Manager; instead **every activity including "any use of AI in relation to an activity... would fall within the scope of a SMF manager's responsibilities."** Senior managers must take reasonable steps to ensure the business they're responsible for is effectively controlled — for an AR firm, accountability runs through the network's SMFs and the AR's approved persons regime [VERIFY: ARs are outside SM&CR proper; their staff are approved persons of neither firm — the principal's SMF for AR oversight is the accountable senior manager].
- **Consumer Duty board oversight** (para 3.43): annual board report on outcomes should cover AI where it affects retail outcomes.
- **Contestability/redress** (paras 3.44–3.47): "Firms that use AI... remain responsible for ensuring compliance with our rules" where "an AI system produces decisions or outcomes which cause consumer harm" (para 3.45); complaints about AI decisions go through DISP and the FOS (para 3.46); UK GDPR Art 22 right not to be subject to solely automated significant decisions, with a right to contest (para 3.47).
- **DP5/22** (AI Discussion Paper, joint with BoE, 2022) + **Feedback Statement FS2/23 (2023)**: respondents endorsed using existing SM&CR/governance rather than new AI rules; the FCA keeps "whether amendments are needed" under review (paras 2.1–2.4). [Newer FCA AI statements post-April-2024 exist (e.g. AI Lab / sprint updates); positions above remain the operative framework — VERIFY for updates after research date.]

**Audit-trail expectations, translated:** per agent action keep — timestamp; agent + model/prompt version; inputs consumed; output produced; whether/by whom a human approved; and downstream effect (email sent, field written, portal action). Tamper-evident storage (MCOB 2.8.40R), retrievable within 2 business days (MCOB 2.8.33G). The browser-use sourcing agent additionally needs screen/state capture, because portal results are the *only* contemporaneous evidence of the market at decision time.

---

## 8. Data protection / ICO overlap for the document-collection agent

The FCA explicitly defers to the ICO on data protection but treats UK GDPR compliance as part of fair AI use (AI Update paras 3.31–3.33, 3.37, 3.47):

- **Lawful basis & transparency (UK GDPR Arts 5, 6, 13–14)**: privacy notice at first contact (fits naturally alongside MCOB 4.4A initial disclosure in the onboarding email) must disclose **the existence of automated decision-making/profiling and meaningful information about the logic** where significant effects arise (Art 13(2)(f), AI Update 3.37).
- **Article 22**: right not to be subject to *solely* automated decisions with legal/similarly significant effects. Our human-approval gate on regulated outputs is also the Art 22 safeguard — document it. Watcher-agent workflow advancement is fine; auto-*declining* a client without human review would not be.
- **Special category data**: mortgage packs contain health data (protection/vulnerability disclosures), and bank statements reveal it inferentially; vulnerability records are special-category — Art 9 condition needed (substantial public interest / DPA 2018 Sch 1 safeguarding conditions; ICO vulnerability guidance) [VERIFY chosen condition with DPO].
- **Security (Art 5(1)(f), Art 32)**: secure document-request links must be expiring, single-purpose, authenticated; email itself is not a secure channel for returned documents — the link pattern (upload portal, not attachments) is the right one. FCA overlay: SYSC 4.1.1R "safeguard arrangements for information processing systems" makes poor data security a *conduct* issue too.
- **Retention (Art 5(1)(e) storage limitation) vs FCA record-keeping**: the tension resolves by documented retention schedule — advice-file records kept life-of-mortgage + 6 years *because* of MCOB/FOS exposure (legitimate legal-obligation/legitimate-interest basis); raw collected documents not needed for the advice record (e.g., superseded uploads) deleted on a shorter cycle. Never "keep everything forever."
- **ICO AI guidance** (Guidance on AI and Data Protection, referenced by the FCA at para 3.31): fairness in AI processing, DPIA required for large-scale profiling/automated processing — **run a DPIA for the doc-intelligence and affordability agents before launch**.
- **Equality Act 2010** (AI Update 3.33): model behaviour must not discriminate on protected characteristics — test extraction/affordability outputs across cohorts.

---

## 9. Practical translation table — the seven Lendmind agents

Legend: **AUTO** = may act autonomously; **HUMAN** = requires adviser (or network) approval before effect; **RECORDS** = must write to the audit file; **DISCLOSURES** = obligations it triggers.

### 9.1 Client onboarding agent (secure document-request emails)
- **AUTO:** send templated welcome/document-request emails from compliance-approved templates; issue expiring secure upload links; chase outstanding documents; answer purely factual process questions from an approved FAQ.
- **HUMAN:** any deviation from template; any message that mentions products, rates, or the merits of proceeding; onboarding of a client flagged vulnerable; template content itself (network promotions/compliance sign-off).
- **RECORDS:** message content + template version + send time; delivery of initial disclosure (durable medium, MCOB 4.4A.9R/12R); link issuance/access logs; consent and privacy-notice presentation.
- **DISCLOSURES:** carries the **initial disclosure document** (scope of service MCOB 4.4A.1R/4R, fees & commission MCOB 4.4A.8R) in/with the first substantive email; carries the **privacy notice** (UK GDPR Arts 13–14 incl. automated-processing statement). Its emails are interactive dialogue (MCOB 4.8A.16B) — locking the journey into advised-sale standards.

### 9.2 Watcher agent (workflow advancement on uploads)
- **AUTO:** detect uploads, advance workflow states, notify adviser and client of progress, schedule tasks, escalate stalled cases.
- **HUMAN:** any state transition that constitutes a decision about the client (decline/park a case, deprioritise); overriding a vulnerability hold; anything that results in a client-facing substantive communication outside approved service templates.
- **RECORDS:** every state transition with trigger, timestamp, and rule/version that fired — this is the backbone of the SYSC 4.1.1R audit trail.
- **DISCLOSURES:** none directly; must *not* advance past the recommendation gate unless ESIS issuance is recorded (MCOB 5A.4.1R) — build the disclosure checks into its state machine.

### 9.3 Document intelligence agent (extraction into fact find)
- **AUTO:** classify documents, extract fields into the fact find with confidence scores, reconcile against client-stated figures, flag mismatches/anomalies (incl. potential fraud indicators), flag vulnerability signals found in documents.
- **HUMAN:** verification of material suitability/affordability fields (income, commitments, credit issues) before they feed a recommendation — MCOB 4.7A.5R deems the firm aware of what it holds, and MCOB 11.6.8R-grade income evidence must be human-checked; resolution of extraction conflicts; any special-category data handling decision.
- **RECORDS:** source-document → field lineage, model/prompt version, confidence, human verification events; DPIA on file; retention tags per document class.
- **DISCLOSURES:** none client-facing; its existence is disclosed in the privacy notice (automated processing, Art 13(2)(f)).

### 9.4 Browser-use sourcing agent (MSE, later Mortgage Brain/Twenty7Tec)
- **AUTO:** execute searches from adviser-set criteria; capture full result sets with screenshots/exports, timestamps, portal + version; re-run on rate-change; present results **to the adviser only**, ordered by objective sortable fields.
- **HUMAN:** the shortlist and any ranking/opinion ("best for this client") — that is the advice judgement (PERG 4.6.25B, MCOB 4.7A.2R); publishing any product result to the client; changing search criteria in ways that embed preference judgements.
- **RECORDS:** full search inputs and complete result sets (not just top hits), evidence of market coverage supporting the firm's scope-of-service claim (MCOB 4.4A.1R/4R), portal T&C compliance basis [VERIFY portal terms permit automated driving — MSE/consumer sites' ToS may prohibit bots; commercial sourcing systems (Mortgage Brain/Twenty7Tec) offer APIs — prefer them].
- **DISCLOSURES:** its actual coverage defines what the firm may say about range — feeds MCOB 4.4A.4R accuracy; no "independent"/"whole of market" claims beyond real coverage (MCOB 4.4A.4R(3)).

### 9.5 Criteria search agent
- **AUTO:** check lender criteria against fact-find facts; produce pass/fail/refer matrices with source citations and dates; monitor criteria changes affecting in-flight cases.
- **HUMAN:** excluding lenders from consideration for a specific client (an advice-shaping act); communicating eligibility conclusions to the client; the no-suitable-product conclusion (MCOB 4.7A.5R(3)).
- **RECORDS:** criteria consulted per lender with source + date, reasoning per exclusion, matrix version shown to the adviser — the "why not X" half of the suitability file (MCOB 4.7A.25R, 3-year minimum, keep longer).
- **DISCLOSURES:** none directly.

### 9.6 Affordability / stress-test agent
- **AUTO:** run indicative affordability and MCOB 11.6.18R-style stress scenarios (≥5yrs, ≥+1pp) and lender-calculator replicas for the adviser; flag LTI ≥4.5× banding (FPC flow limit); sensitivity analysis for the suitability discussion (MCOB 4.7A.6R rate-exposure limb).
- **HUMAN:** any affordability figure shown to the client (must go out adviser-approved and labelled indicative/subject to lender assessment — MCOB 11.6.2R); advice consequences (borrow less, longer term); treatment of non-standard income.
- **RECORDS:** inputs, assumptions, calculator/model versions, outputs, stressed scenarios, per-lender results with timestamps.
- **DISCLOSURES:** none itself, but its outputs must never be framed as a lending decision; client-facing wording standard: "Lenders make their own affordability assessment; these figures are indicative."

### 9.7 Comms drafting agent (rate summaries etc.)
- **AUTO:** draft; send **service-class** messages (no products/rates) from approved templates; log everything.
- **HUMAN:** release of every product/rate-bearing message (financial promotion — s21 FSMA; approval evidence per MCOB 3A.2.4R); any suitability-flavoured wording (steering = advice, PERG 4.6.16A); the suitability report itself is the adviser's document; network sign-off of all templates.
- **RECORDS:** draft → approved-version diff, approver identity + timestamp, template + risk-warning version, representative-example data source and 51% basis (MCOB 3A.5.2R–5.3R), send/delivery logs; Consumer Duty comms-testing evidence (PRIN 2A.5.10R) and comprehension monitoring.
- **DISCLOSURES/WARNINGS:** rate-bearing messages need MCOB 3A.5.1R standard information via representative example incl. APRC; prominent risk warning "Your home may be repossessed if you do not keep up repayments on your mortgage" (MCOB 3A.3.1R basis; prescribed-wording status [VERIFY], but treat as mandatory); "Think carefully before securing other debts against your home" for consolidation; firm name + contact (MCOB 3A.3.2R); must not resemble or restate the ESIS (MCOB 5A.5.5R); must not claim independence/whole-of-market beyond reality (MCOB 4.4A.4R(3)).

---

## 10. Top engineering-facing rules of thumb

1. Build the entire journey as an **advised sale**; interactive agents make execution-only unavailable (MCOB 4.8A.16B).
2. **No agent states an opinion about a particular product to a client, ever.** Opinion-to-client is the adviser's monopoly (PERG 4.6.16A, MCOB 4.7A.2R).
3. First onboarding email = initial disclosure + privacy notice, durable medium, before intermediation begins (MCOB 4.4A.12R, 4.4A.9R).
4. Two comms classes (service vs promotional); promotional requires human release + representative example + risk warning (MCOB 3A.5, 3A.3.1R).
5. ESIS at recommendation, verbatim from the sourcing system, never paraphrased by an LLM (MCOB 5A.4.1R, 5A.5.5R).
6. Record full sourcing result sets and criteria exclusions at execution time; 3-year MCOB floor, retain life-of-mortgage + 6 in practice (MCOB 4.7A.25R, 2.8).
7. Affordability outputs are always "indicative — the lender decides" (MCOB 11.6.2R); stress at ≥+1pp over ≥5 years mirrors MCOB 11.6.18R; FPC affordability test is gone (Aug 2022) but the 4.5× LTI flow limit is not.
8. Vulnerability detection routes to human, never auto-advance; QA the automated journey for vulnerable-customer harm (FG21/1, PRIN 2A.5.8R/2A.6.2R).
9. Human approval gates double as UK GDPR Art 22 safeguards; run DPIAs; secure-link uploads, not attachments.
10. Map every agent to a named accountable human (adviser day-to-day; network SMF ultimately); version and log everything — "firms that use AI remain responsible" (FCA AI Update para 3.45; SYSC 4.1.1R).

---

## Sources

- FCA Handbook: [MCOB 4.7A](https://www.handbook.fca.org.uk/handbook/MCOB/4/7A.html), [MCOB 4.8A](https://www.handbook.fca.org.uk/handbook/MCOB/4/8A.html), [MCOB 4.4A](https://www.handbook.fca.org.uk/handbook/MCOB/4/4A.html), [MCOB 5A](https://www.handbook.fca.org.uk/handbook/MCOB/5A/), [MCOB 11.6](https://www.handbook.fca.org.uk/handbook/MCOB/11/6.html), [MCOB 3A.2](https://www.handbook.fca.org.uk/handbook/MCOB/3A/2.html), [MCOB 3A.3](https://www.handbook.fca.org.uk/handbook/MCOB/3A/3.html), [MCOB 3A.5](https://www.handbook.fca.org.uk/handbook/MCOB/3A/5.html), [MCOB 2.8](https://www.handbook.fca.org.uk/handbook/MCOB/2/8.html), [PERG 4.6](https://www.handbook.fca.org.uk/handbook/PERG/4/6.html), [PRIN 2A](https://www.handbook.fca.org.uk/handbook/PRIN/2A/)
- [FCA AI Update (April 2024), PDF](https://www.fca.org.uk/publication/corporate/ai-update.pdf) — paras cited in text
- [Bank of England: FPC confirms withdrawal of mortgage market affordability test (June 2022)](https://www.bankofengland.co.uk/news/2022/june/financial-policy-committee-confirms-withdrawal-of-mortgage-market-affordability-test); [FCA: FPC mortgage market recommendations](https://www.fca.org.uk/firms/fpcs-mortgage-market-recommendation)
- Historic prescribed risk warning: [MCOB 3.6.13R (pre-2016 sourcebook)](https://www.handbook.fca.org.uk/handbook/MCOB/3/6.html?date=2016-03-07)
- Consumer Duty: PS22/9, FG22/5; Vulnerability: FG21/1 (as cited within FCA AI Update paras 3.26, 3.28)
- AI policy lineage: DP5/22 (AI Discussion Paper, FCA/BoE 2022), FS2/23 Feedback Statement, AIPPF Final Report (2022), FG16/5 cloud outsourcing guidance, CP26/23 Critical Third Parties
