import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EdgeProblemError,
  decodeProblem,
  isCursorExpiredProblem,
  parseProblemJSON,
} from '@/api/aion/v1/problems';

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('aion edge problem decoding (golden fixtures)', () => {
  it('decodes the cursor_expired problem with retention bounds', () => {
    const problem = decodeProblem(fixture('problem_cursor_expired.json'));
    expect(problem.status).toBe(410);
    expect(problem.code).toBe('cursor_expired');
    expect(problem.retryable).toBe(false);
    expect(isCursorExpiredProblem(problem)).toBe(true);
    if (isCursorExpiredProblem(problem)) {
      expect(problem.minimum_sequence).toBe('1042');
      expect(problem.high_water_sequence).toBe('1730');
    }
  });

  it('decodes the model_alias_denied problem', () => {
    const problem = decodeProblem(fixture('problem_model_alias_denied.json'));
    expect(problem.status).toBe(422);
    expect(problem.code).toBe('model_alias_denied');
    expect(problem.trace_id).toBe('trc_01JY0000000000000000000002');
    expect(isCursorExpiredProblem(problem)).toBe(false);
  });

  it('covers every problem fixture in the manifest', () => {
    const manifest = fixture('manifest.json') as { problems: string[] };
    expect(manifest.problems.length).toBeGreaterThan(0);
    for (const name of manifest.problems) {
      const problem = decodeProblem(fixture(name));
      expect(problem.code.length).toBeGreaterThan(0);
      expect(problem.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('retains additive fields through decode', () => {
    const problem = parseProblemJSON(
      JSON.stringify({
        ...(fixture('problem_model_alias_denied.json') as object),
        future_hint: 'must survive',
      })
    );
    expect((problem as Record<string, unknown>).future_hint).toBe(
      'must survive'
    );
  });

  it('rejects a document missing required fields', () => {
    expect(() => decodeProblem({ title: 'nope', status: 500 })).toThrow(
      TypeError
    );
    expect(() => decodeProblem('not an object')).toThrow(TypeError);
  });

  it('EdgeProblemError carries the decoded problem', () => {
    const problem = decodeProblem(fixture('problem_cursor_expired.json'));
    const error = new EdgeProblemError(problem);
    expect(error.problem).toBe(problem);
    expect(error.message).toContain('410');
    expect(error.message).toContain('cursor_expired');
  });
});
