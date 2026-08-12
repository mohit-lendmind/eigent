# Golden fixtures — aion public Eigent contract v1

Byte-for-byte mirror of `aion-v1/testdata/eigent/v1/` (the authoritative copy,
owned by `api/eigent/v1` in the aion-v1 repository alongside `openapi.yaml`).

Sync rule: never hand-edit these files here. Re-copy the whole directory from
aion-v1 (including `manifest.json`) when the contract adds fixtures, and record
the aion-v1 commit below. The desktop test suite iterates `manifest.json`, so a
fixture added upstream fails loudly here until this mirror is refreshed.

- Contract version: schema_version 1.x (compatibility tuple edge_api `1.4.0`)
- Source path: `aion-v1/testdata/eigent/v1/`
- Last synced from: aion-v1 commit
  `abb1a4d` (main; squash merge of PR #154, the SkillStore train)
