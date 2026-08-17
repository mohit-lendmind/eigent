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

// One render test per lane through the shared dispatcher, with monaco stubbed
// (the real editor loads lazily in its own chunk — the stub proves the card
// hands it the right value/language/diff sides and that the mount signal the
// e2e waits on actually fires).
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolCardView } from '@/components/ChatBox/ToolCards/ToolCardView';

vi.mock('@/components/ChatBox/ToolCards/monacoSetup', async () => {
  const React = await import('react');
  const Editor = ({
    value,
    language,
    onMount,
  }: {
    value?: string;
    language?: string;
    onMount?: () => void;
  }) => {
    React.useEffect(() => {
      onMount?.();
    }, [onMount]);
    return (
      <div data-testid="monaco-stub" data-language={language}>
        {value}
      </div>
    );
  };
  const DiffEditor = ({
    original,
    modified,
    onMount,
  }: {
    original?: string;
    modified?: string;
    onMount?: () => void;
  }) => {
    React.useEffect(() => {
      onMount?.();
    }, [onMount]);
    return (
      <div data-testid="monaco-diff-stub">
        <pre data-testid="diff-original">{original}</pre>
        <pre data-testid="diff-modified">{modified}</pre>
      </div>
    );
  };
  return { Editor, DiffEditor };
});

describe('ToolCardView', () => {
  it('renders a running bash card with the command and live tail', () => {
    render(
      <ToolCardView
        toolName="bash"
        argumentsJson='{"command":"make build"}'
        status="running"
        liveOutput="compiling core\nlinking"
      />
    );
    const card = screen.getByTestId('tool-card-bash');
    expect(card.getAttribute('data-tool-card-status')).toBe('running');
    expect(card.textContent).toContain('make build');
    // Same contract as the work-log row: present while running…
    expect(screen.getByTestId('tool-live-output').textContent).toContain(
      'linking'
    );
  });

  it('settles the bash card: final output shown, live testid gone', () => {
    render(
      <ToolCardView
        toolName="bash"
        argumentsJson='{"command":"make build"}'
        status="done"
        output="build ok"
      />
    );
    expect(screen.queryByTestId('tool-live-output')).toBeNull();
    expect(screen.getByTestId('tool-card-bash').textContent).toContain(
      'build ok'
    );
  });

  it('renders an error bash card carrying the failure output', () => {
    render(
      <ToolCardView
        toolName="bash"
        argumentsJson='{"command":"explode"}'
        status="error"
        output="command not found"
      />
    );
    const card = screen.getByTestId('tool-card-bash');
    expect(card.getAttribute('data-tool-card-status')).toBe('error');
    expect(card.textContent).toContain('command not found');
  });

  it('renders a code card that mounts monaco with the file body', async () => {
    render(
      <ToolCardView
        toolName="write_file"
        argumentsJson={JSON.stringify({
          path: 'src/app.py',
          content: 'print("hi")\n',
        })}
        status="done"
      />
    );
    const card = screen.getByTestId('tool-card-code');
    expect(card.textContent).toContain('src/app.py');
    const editor = await screen.findByTestId('monaco-stub');
    expect(editor.textContent).toContain('print("hi")');
    expect(editor.getAttribute('data-language')).toBe('python');
    // The mount signal the e2e waits on.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-monaco-ready="1"]')).not.toBeNull();
    });
  });

  it('renders edit_file as a diff card with both sides', async () => {
    render(
      <ToolCardView
        toolName="edit_file"
        argumentsJson={JSON.stringify({
          path: 'main.go',
          old_string: 'a := 1',
          new_string: 'a := 2',
        })}
        status="done"
      />
    );
    expect(screen.getByTestId('tool-card-code_diff')).toBeTruthy();
    expect((await screen.findByTestId('diff-original')).textContent).toBe(
      'a := 1'
    );
    expect(screen.getByTestId('diff-modified').textContent).toBe('a := 2');
  });

  it('renders a browser card preferring the landed url from the result', () => {
    render(
      <ToolCardView
        toolName="browser_visit_page"
        argumentsJson='{"url":"https://example.com"}'
        status="done"
        output={'url: https://example.com/landing\ntitle: Example'}
      />
    );
    const card = screen.getByTestId('tool-card-browser');
    expect(card.textContent).toContain('visit page');
    expect(card.textContent).toContain('https://example.com/landing');
  });

  it('renders the generic card compact in chat and verbose in the work log', () => {
    const { unmount } = render(
      <ToolCardView
        toolName="web_search"
        argumentsJson='{"query":"weather halifax"}'
        status="done"
        output="3 results"
      />
    );
    const compact = screen.getByTestId('tool-card-generic');
    expect(compact.textContent).toContain('weather halifax');
    // Compact keeps the result out of the timeline (it lives in the fold).
    expect(compact.textContent).not.toContain('3 results');
    unmount();

    render(
      <ToolCardView
        toolName="web_search"
        argumentsJson='{"query":"weather halifax"}'
        status="done"
        output="3 results"
        verbose
      />
    );
    expect(screen.getByTestId('tool-card-generic').textContent).toContain(
      '3 results'
    );
  });
});
