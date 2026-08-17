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

// The thinking strip is the only surface for a model's reasoning trace, and
// its expanded preference doubles as the "always show thinking" setting — so
// the persistence round-trip is behavior, not an implementation detail.
import { ThinkingStrip } from '@/components/ChatBox/MessageItem/ThinkingStrip';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

const STORAGE_KEY = 'eigent.thinking-strip-expanded';

const TRACE = 'First I list the files.\n\nThen I check the failing target.';

describe('ThinkingStrip', () => {
  it('renders nothing when the trace is empty', () => {
    render(<ThinkingStrip reasoning="" />);
    expect(screen.queryByTestId('thinking-strip')).toBeNull();
  });

  it('starts collapsed with the last non-empty line as preview', () => {
    render(<ThinkingStrip reasoning={TRACE} />);
    expect(
      screen.getByTestId('thinking-strip-toggle').getAttribute('aria-expanded')
    ).toBe('false');
    expect(screen.getByTestId('thinking-strip-preview').textContent).toBe(
      'Then I check the failing target.'
    );
    expect(screen.queryByTestId('thinking-strip-trace')).toBeNull();
  });

  it('preview follows the stream as reasoning grows', () => {
    const { rerender } = render(
      <ThinkingStrip reasoning="Considering the options." />
    );
    expect(screen.getByTestId('thinking-strip-preview').textContent).toBe(
      'Considering the options.'
    );
    rerender(
      <ThinkingStrip reasoning={'Considering the options.\nPicking one.'} />
    );
    expect(screen.getByTestId('thinking-strip-preview').textContent).toBe(
      'Picking one.'
    );
  });

  it('expands to the full trace and persists the preference', async () => {
    const user = userEvent.setup();
    render(<ThinkingStrip reasoning={TRACE} />);

    await user.click(screen.getByTestId('thinking-strip-toggle'));

    expect(
      screen.getByTestId('thinking-strip-toggle').getAttribute('aria-expanded')
    ).toBe('true');
    expect(screen.getByTestId('thinking-strip-trace').textContent).toBe(TRACE);
    expect(screen.queryByTestId('thinking-strip-preview')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('mounts pre-expanded when the stored preference says so', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    render(<ThinkingStrip reasoning={TRACE} />);
    expect(
      screen.getByTestId('thinking-strip-toggle').getAttribute('aria-expanded')
    ).toBe('true');
    expect(screen.getByTestId('thinking-strip-trace').textContent).toBe(TRACE);
  });

  it('collapsing again persists the collapsed preference', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const user = userEvent.setup();
    render(<ThinkingStrip reasoning={TRACE} />);

    await user.click(screen.getByTestId('thinking-strip-toggle'));

    expect(
      screen.getByTestId('thinking-strip-toggle').getAttribute('aria-expanded')
    ).toBe('false');
    expect(screen.queryByTestId('thinking-strip-trace')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });
});
