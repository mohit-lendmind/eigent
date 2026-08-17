import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  EDGE_API_VERSION,
  EVENT_SCHEMA_VERSION,
  MINIMUM_DESKTOP_VERSION,
} from '@/api/aion/v1/gen/meta';
import { EdgeProblemError, isCursorExpiredProblem } from '@/api/aion/v1/problems';
import {
  EdgeTransport,
  parseEventStream,
  type ProjectEventFrame,
} from '@/api/aion/v1/transport';

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixtureText = (name: string): string =>
  readFileSync(join(fixturesDir, name), 'utf-8');
const fixture = (name: string): unknown => JSON.parse(fixtureText(name));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function problemResponse(name: string, status: number): Response {
  return new Response(fixtureText(name), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

function sseResponse(frames: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

function transportWith(response: Response | ((url: string, init?: RequestInit) => Response)) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return typeof response === 'function' ? response(url, init) : response;
  });
  const transport = new EdgeTransport({
    baseUrl: 'https://edge.local/eigent/v1/',
    apiKey: 'sk-test-key',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { transport, fetchImpl };
}

function requestOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchImpl.mock.calls[call] as [string, RequestInit];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe('EdgeTransport REST (golden fixtures)', () => {
  it('creates a project from the golden request/response pair', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('create_project_response.json'), 201)
    );
    const project = await transport.createProject(
      fixture('create_project_request.json') as Parameters<
        typeof transport.createProject
      >[0]
    );
    expect(project.project_id).toBe('prj_01JY0000000000000000000001');
    expect(project.status).toBe('active');

    const { url, init, headers } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/projects');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe('Bearer sk-test-key');
    // The contract requires an Idempotency-Key (16..128 chars) on every
    // mutation — the live edge rejects the request without one.
    expect(headers['Idempotency-Key']).toMatch(/^idk_[0-9a-f]{32}$/);
    expect(JSON.parse(init.body as string)).toEqual(
      fixture('create_project_request.json')
    );
  });

  it('submits a command with command_id as the idempotency key', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('submit_command_response.json'), 202)
    );
    const request = fixture('submit_command_request.json') as Parameters<
      typeof transport.submitCommand
    >[1];
    const receipt = await transport.submitCommand('prj_1', request);
    expect(receipt.run_id).toBe('run_01JY0000000000000000000001');
    expect(receipt.accepted_sequence).toBe('1');

    const { url, headers } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/projects/prj_1/commands');
    expect(headers['Idempotency-Key']).toBe(request.command_id);
  });

  it('sends a contract-conforming idempotency key on cancel and approval response', async () => {
    const { transport, fetchImpl } = transportWith(() => jsonResponse({}, 202));
    await transport.cancelRun('prj_1', 'run_1', { expected_run_epoch: '1' });
    await transport.respondToApproval('prj_1', 'apr_1', {
      decision: 'allow',
    } as Parameters<typeof transport.respondToApproval>[2]);
    for (const call of [0, 1]) {
      const { headers } = requestOf(fetchImpl, call);
      expect(headers['Idempotency-Key']).toMatch(/^idk_[0-9a-f]{32}$/);
    }
  });

  // The real edge accepts these mutations with headers ONLY (202, empty
  // body) — a body-expecting decode would turn every recorded decision into
  // a client-side "delivery failed" error.
  it('resolves accepted mutations that carry no response body', async () => {
    const empty202 = () => new Response(null, { status: 202 });
    const { transport } = transportWith(empty202);
    await expect(
      transport.respondToApproval('prj_1', 'apr_1', {
        decision: 'deny',
      } as Parameters<typeof transport.respondToApproval>[2])
    ).resolves.toBeUndefined();
    await expect(
      transport.cancelRun('prj_1', 'run_1', { expected_run_epoch: '1' })
    ).resolves.toBeUndefined();
  });

  it('decodes the model alias catalog', async () => {
    const { transport } = transportWith(
      jsonResponse(fixture('models_catalog_response.json'))
    );
    const catalog = await transport.listModelAliases();
    expect(catalog.aliases).toHaveLength(3);
    expect(catalog.aliases[0]).toMatchObject({
      alias: 'aion-default',
      is_default: true,
    });
    expect(catalog.aliases[1].alias).toBe('aion-fast');
    // Internal rows stay on the wire (the picker filters them client-side).
    expect(catalog.aliases[2]).toMatchObject({
      alias: 'aion-fixture',
      internal: true,
    });
  });

  it('decodes the integration status handshake', async () => {
    const { transport } = transportWith(
      jsonResponse(fixture('integration_status_response.json'))
    );
    const status = await transport.getIntegrationStatus();
    // Against the generated constants rather than literals: the fixture and the
    // contract mirror are synced as one unit, so a fixture that drifts from the
    // contract it was copied beside is the failure worth catching here.
    expect(status.edge_api_version).toBe(EDGE_API_VERSION);
    expect(status.event_schema_version).toBe(EVENT_SCHEMA_VERSION);
    expect(status.minimum_desktop_version).toBe(MINIMUM_DESKTOP_VERSION);
    expect(status.harness_generation).toBe('aion-go/1');
    expect(status.execution_mode).toBe('remote');
    expect(status.inference_status).toBe('managed');
  });

  it('raises a typed problem for a denied model alias', async () => {
    const { transport } = transportWith(
      problemResponse('problem_model_alias_denied.json', 422)
    );
    const error = await transport
      .createProject({ title: 't', model_alias: 'forbidden' })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(error).toBeInstanceOf(EdgeProblemError);
    if (error instanceof EdgeProblemError) {
      expect(error.problem.code).toBe('model_alias_denied');
      expect(error.problem.status).toBe(422);
    }
  });

  it('raises a plain error for a non-problem failure body', async () => {
    const { transport } = transportWith(
      new Response('gateway exploded', { status: 502 })
    );
    await expect(transport.getIntegrationStatus()).rejects.toThrow(
      'edge returned 502 without a problem document'
    );
  });

  it('escapes path parameters', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse({ project: fixture('create_project_response.json'), last_sequence: '0' })
    );
    await transport.getProject('prj/../sneaky');
    const { url } = requestOf(fetchImpl);
    expect(url).toBe(
      'https://edge.local/eigent/v1/projects/prj%2F..%2Fsneaky'
    );
  });

  it('lists projects without a query string when unpaged', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('project_list_response.json'))
    );
    const page = await transport.listProjects();
    expect(page.projects).toHaveLength(2);
    expect(page.projects[0].project.project_id).toBe(
      'prj_01JY0000000000000000000001'
    );
    expect(page.next_page_token).toBeTruthy();

    const { url, init } = requestOf(fetchImpl);
    // A bare '?' would still be a valid URL, but the edge's cursor decoder
    // treats an empty page_token as a malformed cursor rather than "start".
    expect(url).toBe('https://edge.local/eigent/v1/projects');
    expect(init.method).toBe('GET');
  });

  it('carries the page cursor and size as query parameters', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse({ projects: [] })
    );
    await transport.listProjects({ pageSize: 2, pageToken: 'page-2' });
    expect(requestOf(fetchImpl).url).toBe(
      'https://edge.local/eigent/v1/projects?page_size=2&page_token=page-2'
    );
  });

  it('uploads an attachment from the golden pair, with no idempotency key', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('upload_attachment_response.json'), 201)
    );
    const artifact = await transport.uploadAttachment(
      'prj_01JY0000000000000000000001',
      fixture('upload_attachment_request.json') as Parameters<
        typeof transport.uploadAttachment
      >[1]
    );
    expect(artifact.artifact_id).toBe('art_01JY0000000000000000000004');
    expect(artifact.media_type).toBe('image/png');

    const { url, init, headers } = requestOf(fetchImpl);
    expect(url).toBe(
      'https://edge.local/eigent/v1/projects/prj_01JY0000000000000000000001/attachments'
    );
    expect(init.method).toBe('POST');
    // No Idempotency-Key by contract: a retried upload mints the next version
    // and identical bytes dedupe, so the route defines its own replay story.
    expect(headers['Idempotency-Key']).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual(
      fixture('upload_attachment_request.json')
    );
  });

  it('raises the typed attachment problems', async () => {
    for (const { fixtureName, status, code } of [
      {
        fixtureName: 'problem_attachment_invalid.json',
        status: 422,
        code: 'attachment_invalid',
      },
      {
        fixtureName: 'problem_artifacts_not_configured.json',
        status: 501,
        code: 'artifacts_not_configured',
      },
    ]) {
      const { transport } = transportWith(problemResponse(fixtureName, status));
      const failure = await transport
        .uploadAttachment('prj_1', {
          name: 'shot.png',
          media_type: 'image/png',
          data_base64: 'aGVsbG8=',
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(failure).toBeInstanceOf(EdgeProblemError);
      expect((failure as EdgeProblemError).problem.code).toBe(code);
      expect((failure as EdgeProblemError).problem.status).toBe(status);
    }
  });
});

describe('EdgeTransport skills (golden fixtures)', () => {
  it('decodes the skill catalog', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('skill_catalog_response.json'))
    );
    const catalog = await transport.listSkills();
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.skills[0]).toMatchObject({
      name: 'release-notes',
      version: 3,
      status: 'active',
      activation: 'manual',
    });
    expect(catalog.skills[1]).toMatchObject({
      name: 'triage-report',
      status: 'disabled',
      activation: 'rules',
    });

    const { url, init, headers } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/skills');
    expect(init.method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer sk-test-key');
  });

  it('gets a skill at head and at a pinned version', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('skill_response.json'))
    );
    const head = await transport.getSkill('release-notes');
    // The wire version is a JSON number, not a string.
    expect(head.version).toBe(3);
    expect(head.document.Name).toBe('release-notes');
    await transport.getSkill('release-notes', { version: 2 });
    await transport.getSkill('release-notes', {
      version: 2,
      includeUsage: true,
    });

    expect(requestOf(fetchImpl, 0).url).toBe(
      'https://edge.local/eigent/v1/skills/release-notes'
    );
    expect(requestOf(fetchImpl, 1).url).toBe(
      'https://edge.local/eigent/v1/skills/release-notes?version=2'
    );
    expect(requestOf(fetchImpl, 2).url).toBe(
      'https://edge.local/eigent/v1/skills/release-notes?version=2&usage=true'
    );
  });

  it('opts into usage counters on the catalog route', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('skill_catalog_usage_response.json'))
    );
    await transport.listSkills();
    const catalog = await transport.listSkills({ includeUsage: true });

    // Absent by default: the counters cost the edge an extra read, so nothing
    // asks for them unless the caller renders them.
    expect(requestOf(fetchImpl, 0).url).toBe(
      'https://edge.local/eigent/v1/skills'
    );
    expect(requestOf(fetchImpl, 1).url).toBe(
      'https://edge.local/eigent/v1/skills?usage=true'
    );
    const [used, neverUsed] = catalog.skills;
    expect(used.usage).toMatchObject({ loads: 7, executions: 2 });
    // A never-used name carries no usage object — never a row of zeros.
    expect(neverUsed.usage).toBeUndefined();
  });

  it('puts a skill with If-Match and no Idempotency-Key', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('put_skill_response.json'))
    );
    const request = fixture('put_skill_request.json') as Parameters<
      typeof transport.putSkill
    >[1];
    const result = await transport.putSkill('release-notes', request, 2);
    expect(result.changed).toBe(true);
    expect(result.skill.version).toBe(3);
    expect(result.ignored_fields).toEqual(['model']);

    const { url, init, headers } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/skills/release-notes');
    expect(init.method).toBe('PUT');
    expect(headers['If-Match']).toBe('2');
    // PUT is naturally idempotent — the contract requires no Idempotency-Key.
    expect(headers['Idempotency-Key']).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual(
      fixture('put_skill_request.json')
    );
  });

  it('omits If-Match on an unconditional put (first write)', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('put_skill_response.json'), 201)
    );
    const request = fixture('put_skill_request.json') as Parameters<
      typeof transport.putSkill
    >[1];
    await transport.putSkill('release-notes', request);
    const { headers } = requestOf(fetchImpl);
    expect(headers['If-Match']).toBeUndefined();
  });

  it('treats the 204 from delete as void', async () => {
    const { transport, fetchImpl } = transportWith(
      new Response(null, { status: 204 })
    );
    await expect(transport.deleteSkill('release-notes')).resolves.toBeUndefined();
    const { url, init } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/skills/release-notes');
    expect(init.method).toBe('DELETE');
  });

  it('sets skill status from the golden request', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('skill_response.json'))
    );
    const request = fixture('set_skill_status_request.json') as Parameters<
      typeof transport.setSkillStatus
    >[1];
    const skill = await transport.setSkillStatus('release-notes', request);
    expect(skill.name).toBe('release-notes');

    const { url, init } = requestOf(fetchImpl);
    expect(url).toBe(
      'https://edge.local/eigent/v1/skills/release-notes/status'
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'disabled' });
  });

  it('raises the typed skill problems', async () => {
    const cases = [
      { fixtureName: 'problem_skill_stale.json', status: 409, code: 'skill_stale' },
      { fixtureName: 'problem_skill_invalid.json', status: 422, code: 'skill_invalid' },
      { fixtureName: 'problem_skill_quota_exceeded.json', status: 429, code: 'skill_quota_exceeded' },
    ];
    for (const { fixtureName, status, code } of cases) {
      const { transport } = transportWith(problemResponse(fixtureName, status));
      const request = fixture('put_skill_request.json') as Parameters<
        typeof transport.putSkill
      >[1];
      const error = await transport.putSkill('release-notes', request).then(
        () => null,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(EdgeProblemError);
      if (error instanceof EdgeProblemError) {
        expect(error.problem.code).toBe(code);
        expect(error.problem.status).toBe(status);
      }
    }
  });

  it('escapes the skill name in every skill path', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('skill_response.json'))
    );
    await transport.getSkill('a/../b');
    const { url } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/skills/a%2F..%2Fb');
  });
});

describe('EdgeTransport connectors (golden fixtures)', () => {
  it('decodes the catalog, keeping connected and connectable apart', async () => {
    const { transport, fetchImpl } = transportWith(
      jsonResponse(fixture('connector_catalog_response.json'))
    );
    const catalog = await transport.listConnectors();
    expect(catalog.connectors).toHaveLength(5);
    expect(catalog.connectors[1]).toMatchObject({
      connector_id: 'linear',
      connected: false,
      connectable: true,
    });
    // Same `connected: false`, opposite meaning for the user.
    expect(catalog.connectors[2]).toMatchObject({
      connector_id: 'notion',
      connected: false,
      connectable: false,
    });

    const { url, init } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/connectors');
    expect(init.method).toBe('GET');
  });

  it('starts a flow with a fresh idempotency key per attempt', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('connector_auth_response.json'))
    );
    const authorization = await transport.initiateConnectorAuth('linear');
    expect(authorization.authorization_url).toContain('state=');
    await transport.initiateConnectorAuth('linear');

    const first = requestOf(fetchImpl, 0);
    const second = requestOf(fetchImpl, 1);
    expect(first.url).toBe(
      'https://edge.local/eigent/v1/connectors/linear/auth'
    );
    expect(first.init.method).toBe('POST');
    // Each attempt mints its own single-use flow state, so replaying the first
    // receipt would hand back a URL that can no longer be redeemed.
    expect(first.headers['Idempotency-Key']).toBeTruthy();
    expect(second.headers['Idempotency-Key']).not.toBe(
      first.headers['Idempotency-Key']
    );
  });

  it('reads a 204 disconnect as success rather than a parse error', async () => {
    const { transport, fetchImpl } = transportWith(new Response(null, { status: 204 }));
    await expect(transport.disconnectConnector('github')).resolves.toBeUndefined();
    const { url, init } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/connectors/github/grant');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces the unconfigured-vault 501 as a typed problem', async () => {
    const { transport } = transportWith(
      problemResponse('problem_connectors_not_configured.json', 501)
    );
    const error = await transport
      .initiateConnectorAuth('linear')
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(EdgeProblemError);
    expect((error as EdgeProblemError).problem.code).toBe(
      'connectors_not_configured'
    );
  });

  it('percent-encodes a connector id rather than splicing it into the path', async () => {
    const { transport, fetchImpl } = transportWith(new Response(null, { status: 204 }));
    await transport.disconnectConnector('acme/tickets');
    expect(requestOf(fetchImpl).url).toBe(
      'https://edge.local/eigent/v1/connectors/acme%2Ftickets/grant'
    );
  });
});

describe('EdgeTransport schedules (golden fixtures)', () => {
  it('lists the tenant, and narrows to one project only when asked', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('schedule_list_response.json'))
    );
    const list = await transport.listSchedules();
    expect(list.schedules).toHaveLength(4);
    // The paused row carries no next firing at all — the field is omitted, not
    // zeroed, which is what lets the desktop say "no next firing".
    expect(list.schedules?.[1].next_fire_at).toBeUndefined();

    await transport.listSchedules({ projectId: 'prj/one' });
    expect(requestOf(fetchImpl, 0).url).toBe(
      'https://edge.local/eigent/v1/schedules'
    );
    expect(requestOf(fetchImpl, 1).url).toBe(
      'https://edge.local/eigent/v1/schedules?project_id=prj%2Fone'
    );
  });

  it('creates with a fresh idempotency key per attempt', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('schedule_response.json'), 201)
    );
    const request = fixture('create_schedule_request.json') as any;
    await transport.createSchedule(request);
    await transport.createSchedule(request);

    const first = requestOf(fetchImpl, 0);
    expect(first.url).toBe('https://edge.local/eigent/v1/schedules');
    expect(first.init.method).toBe('POST');
    expect(JSON.parse(String(first.init.body))).toEqual(request);
    // A retried create would otherwise register a second trigger firing the
    // same task on the same cadence — a duplicate no later read can undo.
    expect(first.headers['Idempotency-Key']).toBeTruthy();
    expect(requestOf(fetchImpl, 1).headers['Idempotency-Key']).not.toBe(
      first.headers['Idempotency-Key']
    );
  });

  it('sends the lifecycle transitions without an idempotency key', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('schedule_response.json'))
    );
    await transport.pauseSchedule('sch_1');
    await transport.resumeSchedule('sch_1');
    await transport.requeueSchedule('sch_1');
    await transport.updateSchedule(
      'sch_1',
      fixture('update_schedule_request.json') as any
    );

    const paths = ['pause', 'resume', 'requeue'];
    paths.forEach((leg, index) => {
      const { url, init, headers } = requestOf(fetchImpl, index);
      expect(url).toBe(`https://edge.local/eigent/v1/schedules/sch_1/${leg}`);
      expect(init.method).toBe('POST');
      // The edge requires a key only on create; these are all naturally
      // idempotent or refused as a typed conflict.
      expect(headers['Idempotency-Key']).toBeUndefined();
    });
    const update = requestOf(fetchImpl, 3);
    expect(update.url).toBe('https://edge.local/eigent/v1/schedules/sch_1');
    expect(update.init.method).toBe('PUT');
    expect(update.headers['Idempotency-Key']).toBeUndefined();
  });

  it('reads a 204 delete as success and percent-encodes the id', async () => {
    const { transport, fetchImpl } = transportWith(
      new Response(null, { status: 204 })
    );
    await expect(transport.deleteSchedule('sch/one')).resolves.toBeUndefined();
    const { url, init } = requestOf(fetchImpl);
    expect(url).toBe('https://edge.local/eigent/v1/schedules/sch%2Fone');
    expect(init.method).toBe('DELETE');
  });

  it('requests a bounded ledger window and decodes it oldest-first', async () => {
    const { transport, fetchImpl } = transportWith(() =>
      jsonResponse(fixture('schedule_event_list_response.json'))
    );
    const ledger = await transport.listScheduleEvents('sch_1', { limit: 25 });
    expect(ledger.events?.map((event) => event.action)).toEqual([
      'created',
      'fired',
      'skipped_busy',
      'fire_failed',
      'dead_lettered',
    ]);
    expect(requestOf(fetchImpl, 0).url).toBe(
      'https://edge.local/eigent/v1/schedules/sch_1/events?limit=25'
    );

    await transport.listScheduleEvents('sch_1');
    expect(requestOf(fetchImpl, 1).url).toBe(
      'https://edge.local/eigent/v1/schedules/sch_1/events'
    );
  });

  it('surfaces the refused seconds cadence as a typed problem', async () => {
    const { transport } = transportWith(
      problemResponse('problem_schedule_cron_denied.json', 422)
    );
    const error = await transport
      .createSchedule({ project_id: 'prj_1', cron: '*/5 * * * * *', task: 'x' } as any)
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(EdgeProblemError);
    expect((error as EdgeProblemError).problem.code).toBe(
      'schedule_cron_denied'
    );
    expect((error as EdgeProblemError).problem.retryable).toBe(false);
  });
});

describe('EdgeTransport SSE subscription', () => {
  const frame = (id: number, body: unknown): string =>
    `id: ${id}\nevent: project_event\ndata: ${JSON.stringify(body)}\n\n`;

  it('yields decoded frames in order, ignoring the retry preamble', async () => {
    const events = ['event_run_accepted.json', 'event_text_delta.json'].map(
      (name, index) => ({
        ...(fixture(name) as Record<string, unknown>),
        sequence: String(index + 1),
      })
    );
    const stream =
      'retry: 3000\n\n' + events.map((event, i) => frame(i + 1, event)).join('');
    const { transport, fetchImpl } = transportWith(sseResponse(stream));

    const seen: ProjectEventFrame[] = [];
    for await (const item of transport.subscribeProjectEvents('prj_1', {
      after: '0',
    })) {
      seen.push(item);
    }
    expect(seen.map((s) => s.id)).toEqual(['1', '2']);
    expect(seen[0].event.kind).toBe('run_accepted');
    expect(seen[1].event.kind).toBe('text_delta');

    const { url, headers } = requestOf(fetchImpl);
    expect(url).toBe(
      'https://edge.local/eigent/v1/projects/prj_1/events?after=0'
    );
    expect(headers.Accept).toBe('text/event-stream');
    expect(headers['Last-Event-ID']).toBe('0');
  });

  it('surfaces a pre-flight cursor_expired as a typed problem before any frame', async () => {
    const { transport } = transportWith(
      problemResponse('problem_cursor_expired.json', 410)
    );
    const error = await (async () => {
      try {
        for await (const _ of transport.subscribeProjectEvents('prj_1', {
          after: '3',
        })) {
          void _;
          return null;
        }
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(EdgeProblemError);
    if (error instanceof EdgeProblemError) {
      expect(isCursorExpiredProblem(error.problem)).toBe(true);
      if (isCursorExpiredProblem(error.problem)) {
        expect(error.problem.minimum_sequence).toBe('1042');
        expect(error.problem.high_water_sequence).toBe('1730');
      }
    }
  });

  it('parses frames split across arbitrary chunk boundaries', async () => {
    const event = {
      ...(fixture('event_text_delta.json') as Record<string, unknown>),
      sequence: '1',
    };
    const wire = frame(1, event);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < wire.length; i += 7) {
      chunks.push(new TextEncoder().encode(wire.slice(i, i + 7)));
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const seen: ProjectEventFrame[] = [];
    for await (const item of parseEventStream(body)) {
      seen.push(item);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe('1');
    expect(seen[0].event.kind).toBe('text_delta');
  });
});
