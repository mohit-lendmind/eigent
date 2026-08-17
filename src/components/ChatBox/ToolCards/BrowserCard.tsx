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

import { Globe } from 'lucide-react';
import type { ToolCardModel } from './lanes';
import { CardShell, ToolStatusIcon, type ToolCardStatus } from './chrome';

/** The `url: …` line every aion browser tool result carries. */
function resultUrl(content: string | undefined): string | null {
  if (!content) return null;
  for (const line of content.split('\n')) {
    if (line.startsWith('url: ')) return line.slice(5).trim() || null;
  }
  return null;
}

// Live page state (screenshots) renders in the browser panel; the card is the
// timeline record of the action itself — verb plus target.
export function BrowserCard({
  model,
  status,
  output,
}: {
  model: ToolCardModel;
  status: ToolCardStatus;
  output?: string;
}) {
  const landedUrl = resultUrl(output);
  // The argument url is the intent; the result url is where the page actually
  // is — prefer the latter once the action settles.
  const url = landedUrl ?? model.url;

  return (
    <CardShell
      header={
        <>
          <Globe
            size={14}
            aria-hidden
            className="shrink-0 text-ds-icon-neutral-default-default"
          />
          <span className="shrink-0 !text-label-sm font-medium capitalize text-ds-text-neutral-default-default">
            {model.action}
          </span>
          {url ? (
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono !text-label-xs text-ds-text-neutral-muted-default">
              {url}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <ToolStatusIcon status={status} />
        </>
      }
    >
      {model.ref || model.text ? (
        <div className="flex min-w-0 flex-col gap-0.5 border-t border-ds-border-neutral-default px-3 py-1.5">
          {model.ref ? (
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono !text-label-xs text-ds-text-neutral-muted-default">
              ref: {model.ref}
            </div>
          ) : null}
          {model.text ? (
            <div className="overflow-hidden text-ellipsis whitespace-nowrap !text-label-xs text-ds-text-neutral-muted-default">
              “{model.text}”
            </div>
          ) : null}
        </div>
      ) : null}
      {status === 'error' && output ? (
        <div className="border-t border-ds-border-neutral-default px-3 py-1.5 !text-label-xs text-ds-text-status-error-default-default">
          {output.length > 300 ? `${output.slice(0, 300)}…` : output}
        </div>
      ) : null}
    </CardShell>
  );
}
