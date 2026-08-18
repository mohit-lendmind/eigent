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

import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import type { AionArtifactContent } from '@/store/aionArtifactsStore';
import { Download } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArtifactHtmlPreview } from './ArtifactHtmlPreview';
import {
  formatArtifactSize,
  languageForArtifact,
  laneForArtifact,
} from './artifactLanes';

// Same lazy split the code cards use, so opening a markdown artifact never
// pays for the editor chunk.
const MonacoEditor = lazy(() =>
  import('@/components/ChatBox/ToolCards/monacoSetup').then((m) => ({
    default: m.Editor,
  }))
);
const MonacoDiffEditor = lazy(() =>
  import('@/components/ChatBox/ToolCards/monacoSetup').then((m) => ({
    default: m.DiffEditor,
  }))
);

/**
 * Panel-sized editor options. The code CARD tunes itself for a scrolling chat
 * pane — a computed pixel height and a scrollbar that hands the wheel back —
 * and neither is right here: this editor owns the pane, so it fills it and
 * keeps the wheel.
 */
const EDITOR_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineNumbers: 'on',
  folding: true,
  contextmenu: false,
  renderLineHighlight: 'none',
  automaticLayout: true,
  wordWrap: 'on',
} as const;

export interface ArtifactViewerProps {
  content: AionArtifactContent;
  /** Rendered markdown, or its source. Ignored outside the markdown lane. */
  showSource: boolean;
  /** When set, the version to diff the shown one against. */
  compareWith?: { label: string; text: string } | null;
  onDownload: () => void;
  downloading?: boolean;
}

/**
 * Renders one artifact, routed by media type. Every lane reads the bytes the
 * edge served inline; only images and PDFs use the presigned URL, and both do
 * it by handing the URL to the browser rather than fetching it, which is what
 * keeps the renderer's network audit clean.
 */
export function ArtifactViewer({
  content,
  showSource,
  compareWith,
  onDownload,
  downloading,
}: ArtifactViewerProps) {
  const { t } = useTranslation();
  const appearance = useAuthStore((s) => s.appearance);
  const [monacoReady, setMonacoReady] = useState(false);
  const monacoTheme = appearance === 'dark' ? 'vs-dark' : 'light';
  const { artifact, downloadUrl, truncated } = content;
  const lane = laneForArtifact(artifact.mediaType);
  const language = languageForArtifact(artifact.mediaType, artifact.name);
  const text = content.content;

  if (lane === 'image') {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center overflow-auto bg-ds-bg-neutral-subtle-default p-4">
        <img
          src={downloadUrl}
          alt={artifact.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (lane === 'pdf') {
    return (
      <iframe
        title={artifact.name}
        src={downloadUrl}
        className="h-full min-h-0 w-full border-0 bg-ds-bg-neutral-default-default"
      />
    );
  }

  // Truncated means the edge declined to inline the bytes — over the cap, or a
  // type it will not serve as text. There is nothing to render, and rendering
  // an empty pane would read as "the agent produced nothing".
  if (text === undefined || truncated) {
    return (
      <UndisplayableArtifact
        name={artifact.name}
        mediaType={artifact.mediaType}
        sizeBytes={artifact.sizeBytes}
        reason={
          truncated
            ? t('artifact.too-large', {
                defaultValue:
                  'This file is too large to preview here. Download it to read it.',
              })
            : t('artifact.not-viewable', {
                defaultValue:
                  'This file type cannot be previewed here. Download it to open it.',
              })
        }
        onDownload={onDownload}
        downloading={downloading}
      />
    );
  }

  if (compareWith) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col"
        data-monaco-ready={monacoReady ? '1' : '0'}
        data-artifact-compare={compareWith.label}
      >
        <Suspense fallback={<ViewerFallback text={text} />}>
          <MonacoDiffEditor
            original={compareWith.text}
            modified={text}
            language={language}
            theme={monacoTheme}
            options={{ ...EDITOR_OPTIONS, renderSideBySide: true }}
            onMount={() => setMonacoReady(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (lane === 'markdown' && !showSource) {
    return (
      <div
        data-artifact-markdown="1"
        className="h-full min-h-0 w-full overflow-auto px-6 py-4"
      >
        <MarkDown content={text} />
      </div>
    );
  }

  if (lane === 'html' && !showSource) {
    return <ArtifactHtmlPreview html={text} />;
  }

  return (
    <div
      className="h-full min-h-0 w-full"
      data-monaco-ready={monacoReady ? '1' : '0'}
    >
      <Suspense fallback={<ViewerFallback text={text} />}>
        <MonacoEditor
          value={text}
          language={language}
          theme={monacoTheme}
          options={EDITOR_OPTIONS}
          onMount={() => setMonacoReady(true)}
        />
      </Suspense>
    </div>
  );
}

/** Raw text while the editor chunk loads, so the pane is never blank. */
function ViewerFallback({ text }: { text: string }) {
  return (
    <pre className="h-full w-full overflow-auto whitespace-pre-wrap bg-ds-bg-neutral-default-default px-4 py-3 font-mono !text-label-xs text-ds-text-neutral-muted-default">
      {text}
    </pre>
  );
}

function UndisplayableArtifact({
  name,
  mediaType,
  sizeBytes,
  reason,
  onDownload,
  downloading,
}: {
  name: string;
  mediaType: string;
  sizeBytes: number;
  reason: string;
  onDownload: () => void;
  downloading?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
      <div className="flex w-full max-w-[380px] flex-col gap-3 rounded-xl border border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4">
        <p className="break-all text-sm font-medium text-ds-text-neutral-default-default">
          {name}
        </p>
        <p className="text-xs text-ds-text-neutral-muted-default">
          {mediaType} · {formatArtifactSize(sizeBytes)}
        </p>
        <p className="text-xs text-ds-text-neutral-muted-default">{reason}</p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onDownload}
          disabled={downloading}
          className="self-start"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t('artifact.download', { defaultValue: 'Download' })}
        </Button>
      </div>
    </div>
  );
}

export default ArtifactViewer;
