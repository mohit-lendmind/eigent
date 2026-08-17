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

import { Terminal } from 'lucide-react';
import type { ToolCardModel } from './lanes';
import {
  CardShell,
  CopyButton,
  OutputBlock,
  ToolStatusIcon,
  useCardLabels,
  type ToolCardStatus,
} from './chrome';

// While the tool runs the body is the live tail (same `tool-live-output`
// contract as the work-log row: present with content while running, gone at
// settlement); once the result lands the settled output takes over.
export function BashCard({
  model,
  status,
  liveOutput,
  output,
}: {
  model: ToolCardModel;
  status: ToolCardStatus;
  liveOutput?: string;
  output?: string;
}) {
  const labels = useCardLabels();
  const command = model.command ?? '';

  return (
    <CardShell
      header={
        <>
          <Terminal
            size={14}
            aria-hidden
            className="shrink-0 text-ds-icon-neutral-default-default"
          />
          {/* index.css paints bare <code> near-black with no text color; the
              overrides keep the command on the card's own surface. */}
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre !bg-transparent !p-0 !m-0 font-mono !text-label-sm text-ds-text-neutral-default-default">
            <span aria-hidden className="select-none text-ds-text-neutral-subtle-default">
              ${' '}
            </span>
            {command}
          </code>
          <CopyButton value={command} label={labels.copy} />
          <ToolStatusIcon status={status} />
        </>
      }
    >
      {status === 'running' && liveOutput ? (
        <OutputBlock text={liveOutput} testId="tool-live-output" />
      ) : null}
      {status !== 'running' && output ? (
        <OutputBlock text={output} error={status === 'error'} />
      ) : null}
    </CardShell>
  );
}
