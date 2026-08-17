# Contract mirror — aion public Eigent edge API v1

Byte-for-byte mirror of `aion-v1/api/eigent/v1/` (`openapi.yaml`,
`asyncapi.yaml`, `compatibility.json` — the authoritative copies live there;
this repo never edits them).

Sync rule: never hand-edit these files here. Re-copy them from aion-v1
together with `test/fixtures/aion/eigent/v1/` (one contract version, one
sync), record the aion-v1 commit below, then run `pnpm gen:aion-edge` so the
generated client under `../gen/` matches. `bazel test //:aion_edge_client_gen`
fails until mirror and generated output agree.

- Contract version: edge_api `1.16.0`
- Source path: `aion-v1/api/eigent/v1/`
- Last synced from: aion-v1 commit `b874efd`, which adds attachments:
  `POST /projects/{projectId}/attachments` takes `{name, media_type,
  data_base64}` and answers 201 with the published `Artifact` (re-uploading
  the same name mints the next version; identical bytes dedupe in the CAS,
  so there is deliberately no Idempotency-Key on this route), and
  `SubmitCommand` accepts `attachment_ids` naming published artifacts the
  run's first message should carry as typed image/document parts. Two new
  problems: 422 `attachment_invalid` (the plane refused the attachment
  itself — on upload, or at submit when an id names an unpublished or
  undeliverable artifact) and 501 `artifacts_not_configured` (no object
  store behind this deployment); an oversize decoded body is the existing
  413 `payload_too_large` at a 3 MiB per-attachment ceiling. Synced
  together with `test/fixtures/aion/eigent/v1/` (which gains
  `upload_attachment_request.json`, `upload_attachment_response.json`,
  `problem_attachment_invalid.json` and
  `problem_artifacts_not_configured.json`, and whose
  `integration_status_response.json` and `account_response.json` move with
  the contract).
- Previously synced from aion-v1 commit `46b7d6a`, which adds the `run_recovery`
  event: a run entering one of the durable recovery labels used to be written
  onto its own row and nowhere else, so a run parked behind a quarantined
  record was indistinguishable from one still thinking — both are a stream that
  stopped. It is deliberately NOT a terminal, because the run still holds the
  Project's active-run slot and a terminal still follows if one resolves it;
  `blocking` separates the labels that only need waiting out from the poison
  label, where nothing moves until an operator intervenes. Synced together with
  `test/fixtures/aion/eigent/v1/` (which gains `event_run_recovery.json`, and
  whose `integration_status_response.json` and `account_response.json` move
  with the contract).
- Previously synced from aion-v1 commit `c45fbc7`, which gives the Project grouping
  a row of its own: `/spaces` (list, create), `/spaces/{spaceId}` (get, update,
  delete), the named `archive`/`unarchive` actions, and
  `PUT|DELETE /projects/{projectId}/space` to file or unfile a Project. Every
  Space carries a `project_count` taken inside the write that returned it, so a
  client never re-reads to render the row it just edited; `Project` gains the
  optional `space_id` it is filed under (OMITTED when filed nowhere, which a
  client renders differently from a Space named ""), and `/projects` gains a
  `space_id` filter that answers an unknown id with an empty list rather than a
  404. Synced together with `test/fixtures/aion/eigent/v1/` (which gains
  `space_list_response.json`, `space_response.json`,
  `create_space_request.json`, `update_space_request.json`,
  `set_project_space_request.json` and `problem_space_in_use.json`, and whose
  `project_list_response.json`, `integration_status_response.json` and
  `account_response.json` move with the contract).
- Previously synced from aion-v1 commit `9352bd4`, which adds the artifact listing
  (`GET /projects/{projectId}/artifacts`, paged and published-only) and the two
  additive `Artifact` fields a listing needs that a single event never did —
  `version`, so two writes of the same report name are two distinguishable
  rows, and an optional `published_at`, omitted on the `artifact_created` event
  because the event's own arrival is the publication. A listed row carries no
  `download_url`: a presigned GET is a time-boxed grant against a default-deny
  bucket, and `GET /artifacts/{artifactId}` still mints one on demand. Synced
  together with `test/fixtures/aion/eigent/v1/` (which gains
  `artifact_list_response.json`, and whose `event_artifact_created.json`,
  `integration_status_response.json` and `account_response.json` move with the
  contract).
- Previously synced from aion-v1 commit `65ef6fb`, which adds the memory plane
  (`/memory` list, `/memory/search`, `/memory/clear`, and get/put/delete on
  `/memory/{key}`), together with the fixtures
  `memory_catalog_response.json`, `memory_doc_response.json`,
  `memory_search_response.json`, `put_memory_request.json`,
  `put_memory_response.json`, `clear_memory_response.json` and the four
  `problem_memory_*.json` refusals.
  `create_key_response.json` carries a PLACEHOLDER in `raw_key`, not a
  credential-shaped string: these fixtures travel into evidence bundles whose
  redaction scan fails on one.
