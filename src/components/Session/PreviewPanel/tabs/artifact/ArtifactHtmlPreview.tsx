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

import { Button } from '@/components/ui/button';
import { containsDangerousContent } from '@/lib/htmlSanitization';
import { cn } from '@/lib/utils';
import { Globe, GlobeLock, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withArtifactCsp } from './artifactCsp';

export interface ArtifactHtmlPreviewProps {
  html: string;
}

/**
 * Renders an agent-authored HTML page.
 *
 * The frame is sandboxed to scripts alone — no `allow-same-origin`, so it is
 * an opaque origin with no access to this app's storage or DOM, and no
 * `allow-forms` / `allow-downloads`, because a preview is not a form target.
 * What the sandbox does not take away is the network, so the page's reach is
 * set by the policy `withArtifactCsp` injects: nothing at all by default, and
 * subresources from the app's own CDN allowlist once the user opts in.
 * `connect-src 'none'` holds in both states, so opting in never buys the page
 * a way to send anything out.
 *
 * The toggle lives per preview and is never persisted: it is a decision about
 * one page the user is looking at, not a setting.
 */
export function ArtifactHtmlPreview({ html }: ArtifactHtmlPreviewProps) {
  const { t } = useTranslation();
  const [allowExternal, setAllowExternal] = useState(false);
  // A page reaching for Electron internals cannot succeed from an opaque
  // origin, but it is worth refusing rather than framing: it is the one signal
  // that the page was written to escape rather than to be read.
  const dangerous = useMemo(() => containsDangerousContent(html), [html]);
  const srcDoc = useMemo(
    () => withArtifactCsp(html, allowExternal),
    [allowExternal, html]
  );

  if (dangerous) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <ShieldAlert
          className="h-6 w-6 text-ds-icon-error-default-default"
          aria-hidden
        />
        <p className="text-sm font-medium text-ds-text-neutral-default-default">
          {t('artifact.html-blocked-title', {
            defaultValue: 'This page was not rendered',
          })}
        </p>
        <p className="max-w-[420px] text-xs text-ds-text-neutral-muted-default">
          {t('artifact.html-blocked-desc', {
            defaultValue:
              'It contains code that tries to reach the desktop app itself. Read the source or download the file instead.',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-subtle-default px-3 py-1.5">
        {allowExternal ? (
          <Globe
            className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default"
            aria-hidden
          />
        ) : (
          <GlobeLock
            className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-ds-text-neutral-muted-default">
          {allowExternal
            ? t('artifact.html-external-allowed', {
                defaultValue:
                  'Loading styles and scripts from known CDNs. The page still cannot send anything out.',
              })
            : t('artifact.html-external-blocked', {
                defaultValue:
                  'External resources blocked — a page built on a CDN library will look empty.',
              })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setAllowExternal((on) => !on)}
          className="shrink-0"
        >
          {allowExternal
            ? t('artifact.html-block-external', { defaultValue: 'Block' })
            : t('artifact.html-allow-external', { defaultValue: 'Allow' })}
        </Button>
      </div>
      <iframe
        // Remounting on the toggle is deliberate: a policy only applies to a
        // document as it parses, so relaxing it has to re-parse the page.
        key={allowExternal ? 'external' : 'isolated'}
        title={t('artifact.html-frame-title', {
          defaultValue: 'Artifact preview',
        })}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        data-artifact-html-frame="1"
        data-allow-external={allowExternal ? '1' : '0'}
        className={cn(
          'h-full min-h-0 w-full flex-1 border-0 bg-ds-bg-neutral-default-default'
        )}
      />
    </div>
  );
}

export default ArtifactHtmlPreview;
