# Contract mirror — aion public Eigent edge API v1

Byte-for-byte mirror of `aion-v1/api/eigent/v1/` (`openapi.yaml`,
`asyncapi.yaml`, `compatibility.json` — the authoritative copies live there;
this repo never edits them).

Sync rule: never hand-edit these files here. Re-copy them from aion-v1
together with `test/fixtures/aion/eigent/v1/` (one contract version, one
sync), record the aion-v1 commit below, then run `pnpm gen:aion-edge` so the
generated client under `../gen/` matches. `bazel test //:aion_edge_client_gen`
fails until mirror and generated output agree.

- Contract version: edge_api `1.9.0`
- Source path: `aion-v1/api/eigent/v1/`
- Last synced from: aion-v1 commit `6752080`, which adds the
  `/connectors` plane (list, `{id}/auth`, `{id}/grant`), together with
  `test/fixtures/aion/eigent/v1/` (which gains
  `connector_catalog_response.json`, `connector_auth_response.json`,
  `problem_connectors_not_configured.json` and
  `problem_connector_not_ready.json`).
