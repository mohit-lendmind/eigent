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

// Both markdown surfaces must show the full content as soon as it arrives.
// Fake timers make the removed per-character typewriter impossible to pass
// off as "eventually renders": no interval can fire here, so whatever is
// visible got there synchronously or on microtasks alone.
import { MarkDown as ChatMarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { MarkDown as WorkLogMarkDown } from '@/components/WorkFlow/MarkDown';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LONG_BODY = `Opening line. ${'Full sentence that keeps flowing. '.repeat(120)}tail-sentinel`;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ChatBox MarkDown', () => {
  it('renders the whole content without advancing any timer', async () => {
    const onComplete = vi.fn();
    render(
      <ChatMarkDown content={LONG_BODY} onMarkdownRenderComplete={onComplete} />
    );
    // Flush only the async parse pipeline (microtasks) — never timers.
    await act(async () => {});
    expect(document.body.textContent).toContain('tail-sentinel');
    expect(onComplete).toHaveBeenCalled();
  });

  it('keeps up with streaming appends', async () => {
    const { rerender } = render(<ChatMarkDown content="First chunk." />);
    await act(async () => {});
    expect(document.body.textContent).toContain('First chunk.');
    rerender(<ChatMarkDown content="First chunk. Second chunk-sentinel." />);
    await act(async () => {});
    expect(document.body.textContent).toContain('Second chunk-sentinel');
  });
});

describe('WorkFlow MarkDown', () => {
  it('renders the whole content synchronously', () => {
    render(<WorkLogMarkDown content={LONG_BODY} />);
    expect(screen.getByText(/tail-sentinel/)).toBeInTheDocument();
  });

  it('shows appended content on rerender without restarting', () => {
    const { rerender } = render(<WorkLogMarkDown content="progress line" />);
    expect(screen.getByText(/progress line/)).toBeInTheDocument();
    rerender(<WorkLogMarkDown content="progress line grew-sentinel" />);
    expect(screen.getByText(/grew-sentinel/)).toBeInTheDocument();
  });
});
