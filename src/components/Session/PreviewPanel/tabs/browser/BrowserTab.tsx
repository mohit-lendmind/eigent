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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { normalizeBrowserUrl } from '@/lib/browserUrl';
import { cn } from '@/lib/utils';
import { type SessionBrowserTab, usePageTabStore } from '@/store/pageTabStore';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getPreviewWebview } from './webviewRegistry';

// The edge refuses attachments over 3 MiB decoded; page text is truncated
// well under that so a capture never dies at upload time.
const MAX_TEXT_CHARS = 700_000;

export interface BrowserTabProps {
  tab: SessionBrowserTab;
  /** Desktop host embeds a real <webview>; web falls back to opening tabs. */
  isDesktop: boolean;
  /**
   * False while the display panel is still animating open. The viewport is
   * only published once settled so the fixed-position guest (which the panel's
   * clip-path can't clip) doesn't appear over the chat mid-animation.
   */
  viewportSettled?: boolean;
}

/**
 * Browser chrome (toolbar + address bar) for one browser tab. The page itself
 * is a `<webview>` guest owned by PreviewBrowserLayer; this component publishes
 * the rect the guest should fill via `previewBrowserViewport` and drives
 * navigation through the webview registry. Keyed by tab id upstream so each
 * browser tab keeps its own address state.
 */
export function BrowserTab({
  tab,
  isDesktop,
  viewportSettled = true,
}: BrowserTabProps) {
  const { t } = useTranslation();
  const host = useHost();
  const updateBrowserPreviewTab = usePageTabStore(
    (state) => state.updateBrowserPreviewTab
  );
  const setPreviewBrowserViewport = usePageTabStore(
    (state) => state.setPreviewBrowserViewport
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [addressInput, setAddressInput] = useState(tab.url);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressFocused, setAddressFocused] = useState(false);
  const nav = tab.navigation;

  // Follow the page's URL in the address bar — but never while the user is in
  // the field, so redirects/SPA navigation events can't clobber their typing.
  // (Unsubmitted edits revert to the page URL on blur.)
  useEffect(() => {
    if (addressFocused) return;
    setAddressInput(tab.url);
    setAddressError(null);
  }, [tab.url, addressFocused]);

  const navigateTo = useCallback(
    async (rawUrl: string) => {
      const normalized = normalizeBrowserUrl(rawUrl);
      if (!normalized.ok) {
        setAddressError(normalized.error);
        return;
      }
      setAddressError(null);
      setAddressInput(normalized.url);

      if (!isDesktop) {
        // Web host: no embedded view — open in a regular browser tab instead.
        updateBrowserPreviewTab(tab.id, { url: normalized.url });
        window.open(normalized.url, '_blank', 'noopener,noreferrer');
        return;
      }

      const element = getPreviewWebview(tab.webviewId);
      if (element?.loadURL) {
        // Guest already mounted: navigate it in place (keeps history).
        try {
          await element.loadURL(normalized.url);
        } catch (error) {
          setAddressError(
            error instanceof Error ? error.message : 'Unable to open this URL'
          );
        }
        return;
      }
      // No guest yet (blank tab): setting the URL mounts one in the layer.
      updateBrowserPreviewTab(tab.id, { url: normalized.url });
    },
    [isDesktop, tab.id, tab.webviewId, updateBrowserPreviewTab]
  );

  const electronAPI = host?.electronAPI;
  const openExternal = useCallback(
    async (rawUrl: string) => {
      const normalized = normalizeBrowserUrl(rawUrl);
      if (!normalized.ok) {
        setAddressError(normalized.error);
        return;
      }
      setAddressError(null);

      if (isDesktop && electronAPI?.openExternal) {
        const result = await electronAPI.openExternal(normalized.url);
        if (result && result.success === false) {
          setAddressError(result.error || 'Unable to open this URL');
        }
        return;
      }

      window.open(normalized.url, '_blank', 'noopener,noreferrer');
    },
    [electronAPI, isDesktop]
  );

  // Capture-and-attach: the page the user is looking at crosses into the run
  // as an attachment on their next turn — the agent never drives this browser.
  const { chatStore } = useChatStoreAdapter();
  const [attaching, setAttaching] = useState(false);

  const attachFileToTask = useCallback(
    (taskId: string | undefined, file: { fileName: string; filePath: string }) => {
      if (!taskId || !chatStore?.tasks?.[taskId]) {
        toast.error(
          t('layout.browser-attach-no-task', {
            defaultValue: 'Open a task to attach the page to.',
          })
        );
        return false;
      }
      const existing = chatStore.tasks[taskId].attaches || [];
      if (existing.some((f: File) => f.filePath === file.filePath)) return true;
      // Attaches hold {fileName, filePath} at runtime; the global File type
      // they are declared with is wider than what any producer builds.
      chatStore.setAttaches(taskId, [...existing, file as unknown as File]);
      return true;
    },
    [chatStore, t]
  );

  const handleAttach = useCallback(
    async (mode: 'screenshot' | 'text') => {
      const element = getPreviewWebview(tab.webviewId);
      if (!element || attaching) return;
      // Snapshot the target now: the attachment belongs to the task the user
      // is looking at, not whichever becomes active while the capture runs.
      const taskId = chatStore?.activeTaskId as string | undefined;
      setAttaching(true);
      try {
        if (mode === 'screenshot') {
          const webContentsId = element.getWebContentsId?.();
          if (webContentsId === undefined) {
            throw new Error('The page is still loading');
          }
          const result = await electronAPI?.capturePreviewGuest?.(webContentsId);
          if (!result?.success || !result.filePath || !result.fileName) {
            throw new Error(result?.error || 'Capturing the page failed');
          }
          if (
            attachFileToTask(taskId, {
              fileName: result.fileName,
              filePath: result.filePath,
            })
          ) {
            toast.success(
              t('layout.browser-attached-screenshot', {
                defaultValue: 'Screenshot attached to the task.',
              })
            );
          }
        } else {
          // A wedged page can hold the script reply forever; time-box it so
          // the click still fails with something actionable.
          const raw = await Promise.race([
            element.executeJavaScript?.(
              'document.body ? document.body.innerText : ""'
            ),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Reading the page timed out')),
                5000
              )
            ),
          ]);
          if (typeof raw !== 'string' || !raw.trim()) {
            throw new Error('The page has no readable text');
          }
          const text =
            raw.length > MAX_TEXT_CHARS
              ? `${raw.slice(0, MAX_TEXT_CHARS)}\n…[truncated]`
              : raw;
          let hostLabel = 'page';
          try {
            hostLabel = new URL(tab.url).hostname || 'page';
          } catch {
            // keep the generic label for odd URLs
          }
          const encoded = new TextEncoder().encode(text);
          const result = await electronAPI?.savePastedFile?.(
            `${hostLabel}.txt`,
            encoded.buffer as ArrayBuffer
          );
          if (!result?.success || !result.filePath || !result.fileName) {
            throw new Error(result?.error || 'Saving the page text failed');
          }
          if (
            attachFileToTask(taskId, {
              fileName: result.fileName,
              filePath: result.filePath,
            })
          ) {
            toast.success(
              t('layout.browser-attached-text', {
                defaultValue: 'Page text attached to the task.',
              })
            );
          }
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Unable to attach the page'
        );
      } finally {
        setAttaching(false);
      }
    },
    [
      tab.webviewId,
      tab.url,
      attaching,
      electronAPI,
      chatStore,
      attachFileToTask,
      t,
    ]
  );

  // Publish this container's rect so the layer can position the guest over it.
  // Held back until the panel animation settles; cleared on unmount (switching
  // tabs / closing) so guests park, not float.
  useEffect(() => {
    if (!isDesktop || !viewportSettled) return;
    const container = containerRef.current;
    if (!container) {
      setPreviewBrowserViewport(null);
      return;
    }
    const publish = () => {
      const rect = container.getBoundingClientRect();
      setPreviewBrowserViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(container);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      setPreviewBrowserViewport(null);
    };
  }, [isDesktop, viewportSettled, tab.id, setPreviewBrowserViewport]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-[44px] shrink-0 items-center gap-1.5 px-2">
        <TooltipSimple
          content={t('layout.browser-back', { defaultValue: 'Back' })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            disabled={!isDesktop || !nav?.canGoBack}
            onClick={() => getPreviewWebview(tab.webviewId)?.goBack?.()}
            aria-label={t('layout.browser-back', { defaultValue: 'Back' })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
        <TooltipSimple
          content={t('layout.browser-forward', { defaultValue: 'Forward' })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            disabled={!isDesktop || !nav?.canGoForward}
            onClick={() => getPreviewWebview(tab.webviewId)?.goForward?.()}
            aria-label={t('layout.browser-forward', {
              defaultValue: 'Forward',
            })}
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
        <TooltipSimple
          content={t('layout.browser-reload', { defaultValue: 'Reload' })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            disabled={!isDesktop || !tab.url}
            onClick={() => getPreviewWebview(tab.webviewId)?.reload?.()}
            aria-label={t('layout.browser-reload', { defaultValue: 'Reload' })}
          >
            <RefreshCw
              className={cn('h-4 w-4', nav?.isLoading && 'animate-spin')}
              aria-hidden
            />
          </Button>
        </TooltipSimple>
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void navigateTo(addressInput);
          }}
        >
          <input
            type="text"
            value={addressInput}
            onChange={(event) => {
              setAddressInput(event.target.value);
              if (addressError) setAddressError(null);
            }}
            onFocus={() => setAddressFocused(true)}
            onBlur={() => setAddressFocused(false)}
            placeholder={t('layout.browser-url-placeholder', {
              defaultValue: 'Enter a URL',
            })}
            aria-label={t('layout.browser-url-placeholder', {
              defaultValue: 'Enter a URL',
            })}
            aria-invalid={Boolean(addressError)}
            className={cn(
              'placeholder:text-input-label-default/10 h-[28px] w-full min-w-0 rounded-xl border-none bg-ds-bg-neutral-subtle-default px-3 text-body-sm text-ds-text-neutral-default-default outline-none transition-colors',
              'hover:bg-ds-bg-neutral-subtle-default hover:ring-1 hover:ring-ds-ring-neutral-strong-default hover:ring-offset-0',
              'focus:bg-ds-bg-neutral-subtle-default focus:ring-1 focus:ring-ds-ring-brand-default-focus focus:ring-offset-0',
              addressError
                ? 'border-ds-border-status-error-default-default'
                : 'border-ds-border-neutral-default-default'
            )}
          />
        </form>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              disabled={!isDesktop || !tab.url || attaching}
              aria-label={t('layout.browser-attach', {
                defaultValue: 'Attach page to task',
              })}
              data-testid="browser-attach-page"
            >
              <Paperclip
                className={cn('h-4 w-4', attaching && 'animate-pulse')}
                aria-hidden
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => void handleAttach('screenshot')}
              data-testid="browser-attach-screenshot"
            >
              {t('layout.browser-attach-screenshot', {
                defaultValue: 'Attach screenshot',
              })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleAttach('text')}
              data-testid="browser-attach-text"
            >
              {t('layout.browser-attach-text', {
                defaultValue: 'Attach page text',
              })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipSimple
          content={t('layout.browser-open-external', {
            defaultValue: 'Open externally',
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            disabled={!addressInput}
            onClick={() => openExternal(addressInput)}
            aria-label={t('layout.browser-open-external', {
              defaultValue: 'Open externally',
            })}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>
      {addressError ? (
        <p className="text-ds-text-danger-default-default shrink-0 px-3 py-1 text-xs">
          {addressError}
        </p>
      ) : null}
      {/* The <webview> guest is positioned over this container by
          PreviewBrowserLayer via the published viewport rect. */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-ds-bg-neutral-strong-default"
      >
        {!tab.url ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ds-text-neutral-muted-default">
            {t('layout.browser-blank', {
              defaultValue: 'Enter a URL to start browsing.',
            })}
          </div>
        ) : !isDesktop ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ds-text-neutral-muted-default">
            {t('layout.browser-desktop-only', {
              defaultValue:
                'Embedded browsing is available in the desktop app. This URL opened in your system browser.',
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default BrowserTab;
