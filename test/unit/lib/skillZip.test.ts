// Client-side zip extraction for the remote skills import path: one PUT per
// contained skill, so the extractor must find SKILL.md at the root or one
// folder deep, decode frontmatter, and carry companion files as base64.
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { extractSkillsFromZip } from '@/lib/skillZip';

const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: "A ${name} skill."\n---\n\nDo the ${name} thing.\n`;

function zip(entries: Record<string, string | Uint8Array>): ArrayBuffer {
  const files: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(entries)) {
    files[path] = typeof content === 'string' ? strToU8(content) : content;
  }
  const bytes = zipSync(files);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

describe('extractSkillsFromZip', () => {
  it('extracts folder-per-skill archives with companion files', async () => {
    const skills = await extractSkillsFromZip(
      zip({
        'greet/SKILL.md': skillMd('greet'),
        'greet/template.md': '# Hello\n',
        'report/SKILL.md': skillMd('report'),
        '__MACOSX/greet/._SKILL.md': 'junk',
        '.hidden/SKILL.md': skillMd('hidden'),
      })
    );
    expect(skills.map((s) => s.meta.name)).toEqual(['greet', 'report']);
    const greet = skills[0];
    expect(greet.folderName).toBe('greet');
    expect(greet.meta.description).toBe('A greet skill.');
    expect(greet.files).toEqual([
      { path: 'template.md', contentBase64: btoa('# Hello\n') },
    ]);
    expect(skills[1].files).toEqual([]);
  });

  it('extracts a single root-level skill', async () => {
    const skills = await extractSkillsFromZip(
      zip({ 'SKILL.md': skillMd('solo') })
    );
    expect(skills).toHaveLength(1);
    expect(skills[0].folderName).toBe('');
    expect(skills[0].meta.name).toBe('solo');
  });

  it('skips folders without a parseable SKILL.md', async () => {
    const skills = await extractSkillsFromZip(
      zip({
        'docs/README.md': 'not a skill',
        'broken/SKILL.md': 'no frontmatter here',
      })
    );
    expect(skills).toEqual([]);
  });

  it('refuses an entry that inflates past the per-file cap', async () => {
    // 9 MiB of zeros compresses to a few KiB — the zip-bomb shape. The cap
    // check reads the central directory, so no inflation happens.
    const bomb = zip({
      'greet/SKILL.md': skillMd('greet'),
      'greet/bomb.bin': new Uint8Array(9 << 20),
    });
    await expect(extractSkillsFromZip(bomb)).rejects.toThrow(
      /skill import limits/
    );
  });

  it('refuses an archive with too many entries', async () => {
    const entries: Record<string, string> = { 'greet/SKILL.md': skillMd('greet') };
    for (let i = 0; i < 520; i++) {
      entries[`greet/f${i}.md`] = 'x';
    }
    await expect(extractSkillsFromZip(zip(entries))).rejects.toThrow(
      /skill import limits/
    );
  });
});
