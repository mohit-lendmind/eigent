# Contract mirror — aion public Eigent edge API v1

Byte-for-byte mirror of `aion-v1/api/eigent/v1/` (`openapi.yaml`,
`asyncapi.yaml`, `compatibility.json` — the authoritative copies live there;
this repo never edits them).

Sync rule: never hand-edit these files here. Re-copy them from aion-v1
together with `test/fixtures/aion/eigent/v1/` (one contract version, one
sync), record the aion-v1 commit below, then run `pnpm gen:aion-edge` so the
generated client under `../gen/` matches. `bazel test //:aion_edge_client_gen`
fails until mirror and generated output agree.

- Contract version: edge_api `1.10.0`
- Source path: `aion-v1/api/eigent/v1/`
- Last synced from: aion-v1 commit `b24269d`, which adds the
  `/schedules` plane (list, create, `{id}` get/put/delete, `{id}/pause`,
  `{id}/resume`, `{id}/requeue`, `{id}/events`), together with
  `test/fixtures/aion/eigent/v1/` (which gains
  `create_schedule_request.json`, `update_schedule_request.json`,
  `schedule_response.json`, `schedule_list_response.json`,
  `schedule_event_list_response.json`, `problem_schedule_cron_invalid.json`
  and `problem_schedule_cron_denied.json`, and whose
  `integration_status_response.json` moves to the new `edge_api`).
