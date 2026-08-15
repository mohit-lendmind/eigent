# Contract mirror — aion public Eigent edge API v1

Byte-for-byte mirror of `aion-v1/api/eigent/v1/` (`openapi.yaml`,
`asyncapi.yaml`, `compatibility.json` — the authoritative copies live there;
this repo never edits them).

Sync rule: never hand-edit these files here. Re-copy them from aion-v1
together with `test/fixtures/aion/eigent/v1/` (one contract version, one
sync), record the aion-v1 commit below, then run `pnpm gen:aion-edge` so the
generated client under `../gen/` matches. `bazel test //:aion_edge_client_gen`
fails until mirror and generated output agree.

- Contract version: edge_api `1.12.0`
- Source path: `aion-v1/api/eigent/v1/`
- Last synced from: aion-v1 commit `65ef6fb`, which adds the memory plane
  (`/memory` list, `/memory/search`, `/memory/clear`, and get/put/delete on
  `/memory/{key}`), together with `test/fixtures/aion/eigent/v1/` (which gains
  `memory_catalog_response.json`, `memory_doc_response.json`,
  `memory_search_response.json`, `put_memory_request.json`,
  `put_memory_response.json`, `clear_memory_response.json` and the four
  `problem_memory_*.json` refusals, and whose `integration_status_response.json`
  and `account_response.json` move to the new `edge_api`).
  `create_key_response.json` carries a PLACEHOLDER in `raw_key`, not a
  credential-shaped string: these fixtures travel into evidence bundles whose
  redaction scan fails on one.
