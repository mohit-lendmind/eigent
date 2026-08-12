// The publish_skill approval card renders the PROPOSAL, not raw JSON: the
// reviewer is deciding whether this document enters the durable skill store,
// so the card shows exactly the fields the tool will persist. Anything else
// (unknown tool, malformed arguments) falls back to the generic card.

export interface SkillPublishProposal {
  name: string;
  description: string;
  promptText: string;
  scope?: string;
}

/** Tool name whose approvals render as a skill-publish proposal card. */
export const PUBLISH_SKILL_TOOL = 'publish_skill';

/**
 * Parses a publish_skill approval's arguments_json into the proposal the
 * card renders. Returns null when the payload is not a well-formed proposal
 * — the caller degrades to the generic arguments preview, never throws.
 */
export function parseSkillPublishProposal(
  argumentsJson: string | undefined
): SkillPublishProposal | null {
  if (!argumentsJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const name = record.name;
  const description = record.description;
  const promptText = record.prompt_text;
  if (
    typeof name !== 'string' ||
    name === '' ||
    typeof description !== 'string' ||
    typeof promptText !== 'string'
  ) {
    return null;
  }
  const scope = typeof record.scope === 'string' && record.scope !== '' ? record.scope : undefined;
  return { name, description, promptText, scope };
}
