// The workforce scope tag (SK-D): the desktop's serializer/parser pair for
// the stored document's Metadata["scope"]. The cell's skillScopeSurfaces is
// the authority on these semantics — empty/"global"/names-nothing = every
// surface — and these tests mirror its table.
import { buildSkillScopeTag, parseSkillScopeTag } from '@/lib/skillToolkit';
import { describe, expect, it } from 'vitest';

describe('parseSkillScopeTag', () => {
  it('reads empty, absent, and global tags as every surface', () => {
    for (const raw of [undefined, '', '  ', 'global', 'GLOBAL']) {
      expect(parseSkillScopeTag(raw)).toEqual({
        isGlobal: true,
        selectedAgents: [],
      });
    }
  });

  it('reads a names-nothing tag (stray commas) as global, not hidden', () => {
    expect(parseSkillScopeTag(',')).toEqual({
      isGlobal: true,
      selectedAgents: [],
    });
  });

  it('splits, trims, dedupes, and canonicalizes agent ids', () => {
    expect(
      parseSkillScopeTag(' developer_agent , search_agent ,developer_agent')
    ).toEqual({
      isGlobal: false,
      selectedAgents: ['developer_agent', 'search_agent'],
    });
    // The legacy enum-stringified orchestrator alias canonicalizes.
    expect(parseSkillScopeTag('Agents.single_agent')).toEqual({
      isGlobal: false,
      selectedAgents: ['single_agent'],
    });
  });
});

describe('buildSkillScopeTag', () => {
  it('serializes global (and the unrepresentable no-agents state) to empty', () => {
    expect(buildSkillScopeTag({ isGlobal: true, selectedAgents: [] })).toBe('');
    expect(
      buildSkillScopeTag({ isGlobal: true, selectedAgents: ['ignored'] })
    ).toBe('');
    expect(buildSkillScopeTag({ isGlobal: false, selectedAgents: [] })).toBe(
      ''
    );
  });

  it('joins canonical ids and round-trips through the parser', () => {
    const scope = {
      isGlobal: false,
      selectedAgents: ['single_agent', 'developer_agent'],
    };
    const tag = buildSkillScopeTag(scope);
    expect(tag).toBe('single_agent,developer_agent');
    expect(parseSkillScopeTag(tag)).toEqual(scope);
  });
});
