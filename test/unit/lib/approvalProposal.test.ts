// The publish_skill approval card renders a parsed proposal; anything the
// parser rejects degrades to the generic arguments preview. These pin the
// accept/reject boundary so a malformed gate payload can never crash the
// card or render a half-empty proposal as if it were the real document.
import { describe, expect, it } from 'vitest';
import { parseSkillPublishProposal } from '@/lib/approvalProposal';

describe('parseSkillPublishProposal', () => {
  it('parses the full proposal including the optional scope', () => {
    expect(
      parseSkillPublishProposal(
        JSON.stringify({
          name: 'zz-chat-published',
          description: 'Publish fixture skill saved from the chat surface.',
          prompt_text: 'Skill: zz-chat-published.',
          scope: 'developer_agent',
        })
      )
    ).toEqual({
      name: 'zz-chat-published',
      description: 'Publish fixture skill saved from the chat surface.',
      promptText: 'Skill: zz-chat-published.',
      scope: 'developer_agent',
    });
  });

  it('omits scope when absent or empty', () => {
    const proposal = parseSkillPublishProposal(
      JSON.stringify({ name: 'a', description: 'b', prompt_text: 'c', scope: '' })
    );
    expect(proposal).not.toBeNull();
    expect(proposal?.scope).toBeUndefined();
  });

  it('rejects payloads missing a required field', () => {
    expect(
      parseSkillPublishProposal(JSON.stringify({ name: 'a', description: 'b' }))
    ).toBeNull();
    expect(
      parseSkillPublishProposal(JSON.stringify({ name: '', description: 'b', prompt_text: 'c' }))
    ).toBeNull();
  });

  it('rejects non-object and malformed JSON without throwing', () => {
    expect(parseSkillPublishProposal(undefined)).toBeNull();
    expect(parseSkillPublishProposal('')).toBeNull();
    expect(parseSkillPublishProposal('not json')).toBeNull();
    expect(parseSkillPublishProposal('[1,2]')).toBeNull();
    expect(parseSkillPublishProposal('"str"')).toBeNull();
  });
});
