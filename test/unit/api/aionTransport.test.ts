import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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
    expect(status.edge_api_version).toBe('1.4.0');
    expect(status.event_schema_version).toBe('1.0');
    expect(status.minimum_desktop_version).toBe('1.0.2');
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
    await transport.getSkill('release-notes', 2);

    expect(requestOf(fetchImpl, 0).url).toBe(
      'https://edge.local/eigent/v1/skills/release-notes'
    );
    expect(requestOf(fetchImpl, 1).url).toBe(
      'https://edge.local/eigent/v1/skills/release-notes?version=2'
    );
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
