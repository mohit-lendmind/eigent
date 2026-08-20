# Specification Quality Checklist: crm-domain-core

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — *Note: this is an infrastructure/domain-layer feature; some technology names (localStorage, JSON, zustand) are load-bearing on the feature's meaning per the architecture doc and are treated as domain vocabulary here rather than incidental implementation.*
- [x] Focused on user value and business needs (FCA/Consumer Duty defensibility; the substrate that unlocks F02–F17)
- [x] Written for stakeholders (product + engineering + compliance) — non-technical stakeholders may skim the entity model but the user journeys, trade-offs and success criteria are readable
- [x] All mandatory sections completed (User Scenarios & Testing; Requirements; Success Criteria; Assumptions; plus User Journeys explicitly required by the brief)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the six deferred trade-offs are resolved explicitly in the Trade-off Resolutions section
- [x] Requirements are testable and unambiguous (each FR names inputs, outputs, and observable state changes; every SC is a numeric or byte-equality check)
- [x] Success criteria are measurable (SC-001 through SC-007 all cite exact numbers, exact behaviour, or a gate that either passes or fails)
- [x] Success criteria are technology-agnostic where possible; the ones that name gates (design-token, no-legacy-backend, dead-brain, vitest baseline) name repo-level quality gates whose existence is baked into this codebase per the architecture doc
- [x] All acceptance scenarios are defined (each of the three user stories has ≥5 Given/When/Then scenarios)
- [x] Edge cases are identified (dangling refs, remove-while-referenced, schema drift, env switch, cap eviction, money precision, idempotence, empty selectors, JSON safety)
- [x] Scope is clearly bounded — FR-047 spells out the no-UI, no-deps, no-routes, no-network non-goals; GDPR anonymisation is explicitly deferred
- [x] Dependencies and assumptions identified (Assumptions section names zustand, date-fns, generateUniqueId, getAuthEnvironmentKey, dev flag pattern, base branch)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria (every FR maps to a scenario in one of the three user stories, or to an SC)
- [x] User scenarios cover primary flows (seed-and-read; atomic conflict resolution with audit; export-and-wipe) — all three explicitly required by the brief and present
- [x] Feature meets measurable outcomes defined in Success Criteria (SC-005 requires ≥60 tests; SC-006 measures F02–F05 type stability retroactively)
- [x] No implementation details leak into specification beyond what the domain-layer feature's meaning requires

## Trade-off Resolutions (feature-specific)

- [x] TO-1 fact-find value typing — resolved (FR-004)
- [x] TO-2 stream-entry cap — resolved (FR-030)
- [x] TO-3 ownership fields — resolved (FR-022)
- [x] TO-4 client-erasure semantics — resolved (FR-016 + edge case)
- [x] TO-5 single ordered integrity repair — resolved (FR-036)
- [x] TO-6 conflict record shape and composite addressing — resolved (FR-032, FR-033)

## Field enumeration coverage

- [x] Every fact-find field key enumerated per section per applicant category (employed and self-employed) in FR-006 — no "see design reference" evasions

## Notes

- Iteration 1 of validation: all items pass. No [NEEDS CLARIFICATION] markers remain — the six explicit trade-offs were resolved directly in the spec rather than deferred.
- The three required user journeys (seed-and-read, atomic conflict resolution with audit, export-and-wipe) are all present under both `## User Scenarios & Testing` (as user stories) and `## User Journeys` (as an alias section for the post-merge validator to locate by heading).
- No fixture data or code was written in this phase; the spec is planning input for `/speckit-plan` and `/speckit-tasks`.
