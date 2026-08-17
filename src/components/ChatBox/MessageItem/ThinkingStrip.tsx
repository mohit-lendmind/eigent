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

import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const EXPANDED_STORAGE_KEY = 'eigent.thinking-strip-expanded';

function storedExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

interface ThinkingStripProps {
  /** The accumulated thinking trace; the strip renders nothing when empty. */
  reasoning: string;
}

/**
 * The thinking trace above an answer bubble. Collapsed it shows a one-line
 * live preview (the trace's last non-empty line, updating as reasoning
 * streams); expanded it shows the whole trace. The expanded preference is
 * persisted, so a user who wants thinking always visible gets every strip
 * pre-expanded.
 */
export function ThinkingStrip({ reasoning }: ThinkingStripProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(storedExpanded);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
      } catch {
        // Preference-only — the toggle still works for this session.
      }
      return next;
    });
  }, []);

  if (!reasoning) return null;

  const lines = reasoning
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? '';

  return (
    <div data-testid="thinking-strip" className="mb-2 w-full min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggle}
        data-testid="thinking-strip-toggle"
        className="group inline-flex min-w-0 max-w-full items-center gap-1 self-start px-0 py-0.5 text-left transition-opacity hover:opacity-80"
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={cn(
            'shrink-0 text-ds-icon-neutral-subtle-default transition-transform duration-200',
            expanded ? 'rotate-90' : 'rotate-0'
          )}
        />
        <span className="shrink-0 !text-label-sm font-medium text-ds-text-neutral-subtle-default">
          {t('chat.thinking-strip-label', { defaultValue: 'Thinking' })}
        </span>
        {!expanded && lastLine && (
          <span
            data-testid="thinking-strip-preview"
            className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap !text-label-sm font-normal text-ds-text-neutral-muted-default"
          >
            {lastLine}
          </span>
        )}
      </button>
      {expanded && (
        <div
          data-testid="thinking-strip-trace"
          className="mt-1 max-h-64 w-full overflow-y-auto whitespace-pre-wrap rounded-lg bg-ds-bg-neutral-default-default px-3 py-2 !text-label-sm font-normal text-ds-text-neutral-muted-default"
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}
