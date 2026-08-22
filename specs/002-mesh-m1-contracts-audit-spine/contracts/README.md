# Frozen contract surfaces — mesh-m1-contracts-audit-spine

These `.d.ts` files are the M1 contract freeze (FR-006). They are the surface M2+ builds against.
A breaking change to any declaration here after M1 merges is a defect (SC-006: target zero; one major bump triggers a retro).
Additive optional fields are permitted. Runtime code in `src/crm/agentContracts/` and `src/crm/fold/` must satisfy these shapes exactly (a type-level assignability test pins this).
