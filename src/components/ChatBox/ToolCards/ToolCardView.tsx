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

// The single entry point both surfaces render tool activity through: the
// chat timeline (via Message.toolCard) and the work-log fold (via the row's
// raw arguments_json). Classification is shared so a bash call is a bash
// card everywhere.

import { memo, useMemo } from 'react';
import { classifyToolCall } from './lanes';
import { BashCard } from './BashCard';
import { BrowserCard } from './BrowserCard';
import { CodeCard } from './CodeCard';
import { GenericCard } from './GenericCard';
import type { ToolCardStatus } from './chrome';

export const ToolCardView = memo(function ToolCardView({
  toolName,
  argumentsJson,
  status,
  liveOutput,
  output,
  verbose,
}: {
  toolName: string;
  argumentsJson: string;
  status: ToolCardStatus;
  /** Streamed tail while the tool runs (absent once the result lands). */
  liveOutput?: string;
  /** Settled result content (preview-capped upstream). */
  output?: string;
  /** Work-log fold: show the full request/response on the generic lane. */
  verbose?: boolean;
}) {
  const model = useMemo(
    () => classifyToolCall(toolName, argumentsJson),
    [toolName, argumentsJson]
  );

  const card = (() => {
    switch (model.lane) {
      case 'bash':
        return (
          <BashCard
            model={model}
            status={status}
            liveOutput={liveOutput}
            output={output}
          />
        );
      case 'code':
      case 'code_diff':
        return <CodeCard model={model} status={status} output={output} />;
      case 'browser':
        return <BrowserCard model={model} status={status} output={output} />;
      default:
        return (
          <GenericCard
            model={model}
            status={status}
            argumentsJson={argumentsJson}
            output={output}
            verbose={verbose}
          />
        );
    }
  })();

  return (
    <div
      data-testid={`tool-card-${model.lane}`}
      data-tool-card-status={status}
      className="w-full min-w-0"
    >
      {card}
    </div>
  );
});
ToolCardView.displayName = 'ToolCardView';
