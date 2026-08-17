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

import { FileCode2 } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import type { ToolCardModel } from './lanes';
import {
  CardShell,
  CopyButton,
  OutputBlock,
  ToolStatusIcon,
  useCardLabels,
  type ToolCardStatus,
} from './chrome';

// Monaco is heavy, so it loads through React.lazy into its own chunk the
// first time any code card renders; the Suspense fallback shows the raw text
// so the card is never blank (and non-DOM test environments stay light).
const MonacoEditor = lazy(() =>
  import('./monacoSetup').then((m) => ({ default: m.Editor }))
);
const MonacoDiffEditor = lazy(() =>
  import('./monacoSetup').then((m) => ({ default: m.DiffEditor }))
);

const EDITOR_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineNumbers: 'on',
  folding: false,
  contextmenu: false,
  renderLineHighlight: 'none',
  overviewRulerLanes: 0,
  automaticLayout: true,
  // The card lives inside the scrolling chat pane — monaco must not trap
  // wheel events once its own content is fully visible.
  scrollbar: { alwaysConsumeMouseWheel: false },
} as const;

const LINE_HEIGHT = 18;

function editorHeight(text: string): number {
  const lines = text.split('\n').length;
  return Math.min(320, Math.max(72, lines * LINE_HEIGHT + 24));
}

export function CodeCard({
  model,
  status,
  output,
}: {
  model: ToolCardModel;
  status: ToolCardStatus;
  output?: string;
}) {
  const labels = useCardLabels();
  const appearance = useAuthStore((s) => s.appearance);
  const [monacoReady, setMonacoReady] = useState(false);
  const monacoTheme = appearance === 'dark' ? 'vs-dark' : 'light';
  const isDiff = model.lane === 'code_diff';
  const body = isDiff ? (model.newString ?? '') : (model.content ?? '');
  const height = isDiff
    ? Math.max(editorHeight(model.oldString ?? ''), editorHeight(body))
    : editorHeight(body);

  return (
    <div data-monaco-ready={monacoReady ? '1' : '0'} className="w-full min-w-0">
      <CardShell
        header={
          <>
            <FileCode2
              size={14}
              aria-hidden
              className="shrink-0 text-ds-icon-neutral-default-default"
            />
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono !text-label-sm text-ds-text-neutral-default-default">
              {model.path || model.title}
            </span>
            {model.language && model.language !== 'plaintext' ? (
              <span className="shrink-0 rounded-md bg-ds-bg-neutral-muted-default px-1.5 py-0.5 !text-label-xs font-medium text-ds-text-neutral-muted-default">
                {model.language}
              </span>
            ) : null}
            <CopyButton value={body} label={labels.copy} />
            <ToolStatusIcon status={status} />
          </>
        }
      >
        <div
          style={{ height }}
          className="w-full min-w-0 border-t border-ds-border-neutral-default"
        >
          <Suspense
            fallback={
              <pre className="h-full w-full overflow-auto whitespace-pre bg-ds-bg-neutral-muted-default px-3 py-2 font-mono !text-label-xs text-ds-text-neutral-muted-default">
                {body}
              </pre>
            }
          >
            {isDiff ? (
              <MonacoDiffEditor
                original={model.oldString ?? ''}
                modified={model.newString ?? ''}
                language={model.language}
                theme={monacoTheme}
                options={{ ...EDITOR_OPTIONS, renderSideBySide: false }}
                onMount={() => setMonacoReady(true)}
              />
            ) : (
              <MonacoEditor
                value={body}
                language={model.language}
                theme={monacoTheme}
                options={EDITOR_OPTIONS}
                onMount={() => setMonacoReady(true)}
              />
            )}
          </Suspense>
        </div>
        {status === 'error' && output ? (
          <OutputBlock text={output} error />
        ) : null}
      </CardShell>
    </div>
  );
}
