# Contract mirror — aion public Eigent edge API v1

Byte-for-byte mirror of `aion-v1/api/eigent/v1/` (`openapi.yaml`,
`asyncapi.yaml`, `compatibility.json` — the authoritative copies live there;
this repo never edits them).

Sync rule: never hand-edit these files here. Re-copy them from aion-v1
together with `test/fixtures/aion/eigent/v1/` (one contract version, one
sync), record the aion-v1 commit below, then run `pnpm gen:aion-edge` so the
generated client under `../gen/` matches. `bazel test //:aion_edge_client_gen`
fails until mirror and generated output agree.

- Contract version: edge_api `1.11.0`
- Source path: `aion-v1/api/eigent/v1/`
- Last synced from: aion-v1 commit `43da052`, which adds the account and key
  plane (`/account`, `/keys` list + create, `/keys/{keyId}` revoke), together
  with `test/fixtures/aion/eigent/v1/` (which gains `account_response.json`,
  `key_list_response.json`, `create_key_request.json`,
  `create_key_response.json`, `create_key_replay_response.json`,
  `problem_key_ceiling_reached.json` and `problem_keys_not_configured.json`,
  and whose `integration_status_response.json` moves to the new `edge_api`).
  `create_key_response.json` carries a PLACEHOLDER in `raw_key`, not a
  credential-shaped string: these fixtures travel into evidence bundles whose
  redaction scan fails on one.
