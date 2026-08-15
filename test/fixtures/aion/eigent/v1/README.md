# Golden fixtures — aion public Eigent contract v1

Byte-for-byte mirror of `aion-v1/testdata/eigent/v1/` (the authoritative copy,
owned by `api/eigent/v1` in the aion-v1 repository alongside `openapi.yaml`).

Sync rule: never hand-edit these files here. Re-copy the whole directory from
aion-v1 (including `manifest.json`) when the contract adds fixtures, and record
the aion-v1 commit below. The desktop test suite iterates `manifest.json`, so a
fixture added upstream fails loudly here until this mirror is refreshed.

- Source path: `aion-v1/testdata/eigent/v1/`
- Synced from the commit recorded in
  [`src/api/aion/v1/contract/README.md`](../../../../src/api/aion/v1/contract/README.md).
  The pin lives there and only there: these two mirrors move in one commit, and
  a second copy of the version is a second thing to forget — which is how this
  file came to claim edge_api 1.5.0 three contract versions later.
