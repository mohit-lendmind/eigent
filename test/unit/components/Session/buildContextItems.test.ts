// The side panel's "what this task used" list. Classification of a runtime
// toolkit is name-based first and hint-based second, and the hints are the
// part worth pinning: the retired worker tool picker used to supply them, so
// a connector whose tools are named after the connector — which no /mcp/i
// heuristic can guess — is only recognised because the granted catalog is
// read. A connector the caller has not granted must not lend its name.
import { describe, expect, it } from 'vitest';

import { buildContextItems } from '@/components/Session/SidePanelSections/buildContextItems';

function agentUsing(toolkitName: string, method = 'run'): Agent {
  return {
    agent_id: 'a1',
    name: 'a1',
    type: 'a1' as AgentNameType,
    log: [],
    tasks: [
      {
        id: 't1',
        content: 'work',
        status: 'done',
        toolkits: [{ toolkitName, toolkitMethods: method, message: '' }],
      } as unknown as TaskInfo,
    ],
  };
}

describe('buildContextItems', () => {
  it('recognises a granted connector by name when no heuristic would', () => {
    const items = buildContextItems(
      [agentUsing('Linear')],
      undefined,
      [],
      [],
      ['Linear']
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'Linear', category: 'connector' });
  });

  it('leaves an unrecognised toolkit out rather than guessing a category', () => {
    const items = buildContextItems(
      [agentUsing('Linear')],
      undefined,
      [],
      [],
      []
    );

    expect(items).toEqual([]);
  });

  it('still classifies by name shape with no catalog at all', () => {
    const items = buildContextItems(
      [agentUsing('NotionMCPToolkit')],
      undefined,
      [],
      [],
      []
    );

    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('connector');
  });

  it('surfaces a loaded skill by its argument, not the toolkit name', () => {
    const agent = agentUsing('SkillToolkit', 'load_skill');
    agent.tasks[0].toolkits![0].message = '{"name":"pdf-report"}';

    const items = buildContextItems([agent], undefined, [], [], []);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      label: 'pdf-report',
      category: 'skill',
    });
  });
});
