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

import { Wrench } from 'lucide-react';
import { prettyArgs, type ToolCardModel } from './lanes';
import {
  CardShell,
  OutputBlock,
  SectionLabel,
  ToolStatusIcon,
  useCardLabels,
  type ToolCardStatus,
} from './chrome';

// Fallback lane for web/search/memory/skill/MCP/unknown tools. The chat
// timeline gets the compact form (name + one-line detail); the work-log fold
// passes `verbose` and gets the full request/response the old MarkDown blocks
// used to show.
export function GenericCard({
  model,
  status,
  argumentsJson,
  output,
  verbose,
}: {
  model: ToolCardModel;
  status: ToolCardStatus;
  argumentsJson: string;
  output?: string;
  verbose?: boolean;
}) {
  const labels = useCardLabels();

  return (
    <CardShell
      header={
        <>
          <Wrench
            size={14}
            aria-hidden
            className="shrink-0 text-ds-icon-neutral-default-default"
          />
          <span className="shrink-0 font-mono !text-label-sm text-ds-text-neutral-default-default">
            {model.title}
          </span>
          {model.detail ? (
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap !text-label-xs text-ds-text-neutral-muted-default">
              {model.detail}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <ToolStatusIcon status={status} />
        </>
      }
    >
      {verbose ? (
        <div className="flex w-full flex-col gap-1.5 border-t border-ds-border-neutral-default p-2">
          <div className="w-full rounded-md bg-ds-bg-neutral-muted-default p-2">
            <SectionLabel>{labels.request}</SectionLabel>
            <pre className="max-h-40 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words font-mono !text-label-xs text-ds-text-neutral-muted-default">
              {prettyArgs(argumentsJson)}
            </pre>
          </div>
          {output ? (
            <div className="w-full rounded-md bg-ds-bg-neutral-muted-default p-2">
              <SectionLabel>{labels.response}</SectionLabel>
              <pre
                className={
                  status === 'error'
                    ? 'max-h-40 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words font-mono !text-label-xs text-ds-text-status-error-default-default'
                    : 'max-h-40 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words font-mono !text-label-xs text-ds-text-neutral-muted-default'
                }
              >
                {output}
              </pre>
            </div>
          ) : null}
        </div>
      ) : status === 'error' && output ? (
        <OutputBlock text={output.length > 300 ? `${output.slice(0, 300)}…` : output} error />
      ) : null}
    </CardShell>
  );
}
