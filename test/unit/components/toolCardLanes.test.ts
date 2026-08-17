// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// The lane classifier is the single mapping both surfaces (chat timeline and
// work-log fold) render tool activity through — the table below is the whole
// tool inventory, so a tool falling into the wrong lane is a rendering bug on
// two surfaces at once.
import {
  classifyToolCall,
  languageForPath,
  prettyArgs,
} from '@/components/ChatBox/ToolCards/lanes';
import { describe, expect, it } from 'vitest';

describe('classifyToolCall', () => {
  it('routes bash to the bash lane with the command', () => {
    const model = classifyToolCall('bash', '{"command":"ls -la /tmp"}');
    expect(model.lane).toBe('bash');
    expect(model.command).toBe('ls -la /tmp');
  });

  it('routes write_file to the code lane with path/content/language', () => {
    const model = classifyToolCall(
      'write_file',
      JSON.stringify({ path: 'src/app.py', content: 'print("hi")\n' })
    );
    expect(model.lane).toBe('code');
    expect(model.path).toBe('src/app.py');
    expect(model.content).toBe('print("hi")\n');
    expect(model.language).toBe('python');
  });

  it('routes edit_file to the diff lane with both sides', () => {
    const model = classifyToolCall(
      'edit_file',
      JSON.stringify({
        path: 'main.go',
        old_string: 'a := 1',
        new_string: 'a := 2',
      })
    );
    expect(model.lane).toBe('code_diff');
    expect(model.oldString).toBe('a := 1');
    expect(model.newString).toBe('a := 2');
    expect(model.language).toBe('go');
  });

  it('routes every browser_* tool to the browser lane with the verb', () => {
    const cases: Array<[string, string, string]> = [
      ['browser_visit_page', '{"url":"https://example.com"}', 'visit page'],
      ['browser_click', '{"ref":"e12"}', 'click'],
      ['browser_type', '{"ref":"e3","text":"hello"}', 'type'],
      ['browser_get_page_snapshot', '{}', 'get page snapshot'],
      ['browser_get_screenshot', '{}', 'get screenshot'],
      ['browser_back', '{}', 'back'],
    ];
    for (const [name, args, action] of cases) {
      const model = classifyToolCall(name, args);
      expect(model.lane).toBe('browser');
      expect(model.action).toBe(action);
    }
    expect(
      classifyToolCall('browser_visit_page', '{"url":"https://example.com"}')
        .url
    ).toBe('https://example.com');
    expect(classifyToolCall('browser_click', '{"ref":"e12"}').ref).toBe('e12');
    expect(
      classifyToolCall('browser_type', '{"ref":"e3","text":"hello"}').text
    ).toBe('hello');
  });

  it('routes read/list/web/memory/skill/subagent tools to generic with a detail line', () => {
    expect(classifyToolCall('read_file', '{"path":"/etc/hosts"}')).toMatchObject(
      { lane: 'generic', title: 'read_file', detail: '/etc/hosts' }
    );
    expect(classifyToolCall('list_dir', '{"path":"/tmp"}').lane).toBe('generic');
    expect(
      classifyToolCall('web_search', '{"query":"weather halifax"}')
    ).toMatchObject({ lane: 'generic', detail: 'weather halifax' });
    expect(
      classifyToolCall('web_fetch', '{"url":"https://example.com"}')
    ).toMatchObject({ lane: 'generic', detail: 'https://example.com' });
    expect(classifyToolCall('spawn_subagent', '{"prompt":"do x"}').lane).toBe(
      'generic'
    );
    expect(classifyToolCall('memory_write', '{"key":"k"}').lane).toBe('generic');
    expect(classifyToolCall('run_skill', '{"name":"deploy"}').lane).toBe(
      'generic'
    );
  });

  it('formats namespaced MCP tools as server · tool', () => {
    const model = classifyToolCall('tickets__create_ticket', '{"title":"x"}');
    expect(model.lane).toBe('generic');
    expect(model.title).toBe('tickets · create_ticket');
  });

  it('never throws on malformed arguments', () => {
    expect(classifyToolCall('bash', 'not json').command).toBe('');
    expect(classifyToolCall('write_file', '[1,2]').path).toBe('');
    expect(classifyToolCall('mystery_tool', '').lane).toBe('generic');
  });
});

describe('languageForPath', () => {
  it('maps common extensions and falls back to plaintext', () => {
    expect(languageForPath('a/b/app.tsx')).toBe('typescript');
    expect(languageForPath('x.rs')).toBe('rust');
    expect(languageForPath('Dockerfile')).toBe('dockerfile');
    expect(languageForPath('notes.weird')).toBe('plaintext');
    expect(languageForPath('no_extension')).toBe('plaintext');
  });
});

describe('prettyArgs', () => {
  it('pretty-prints valid JSON and passes malformed input through', () => {
    expect(prettyArgs('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyArgs('broken{')).toBe('broken{');
  });
});
