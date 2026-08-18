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

// How an artifact is rendered, decided from its media type. The type is the
// reliable signal — the publisher assigns it from the file it wrote — and the
// name is only the fallback for the deliberately conservative `text/plain`
// every unknown extension lands on.

import { BROWSER_FRAME_ARTIFACT_PREFIX } from '@/api/aion/v1/reducer';
import { languageForPath } from '@/components/ChatBox/ToolCards/lanes';
import type { AionArtifact } from '@/store/aionArtifactsStore';

export type ArtifactLane =
  | 'markdown'
  | 'html'
  | 'code'
  | 'image'
  | 'pdf'
  /** Neither renderable here nor readable inline — offer the download. */
  | 'download';

/** Media type without its parameters, lowercased. `text/x; charset=utf-8`. */
export function baseMediaType(mediaType: string): string {
  return (mediaType.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * The non-`text/` media types the edge will serve inline (mirrors
 * `internal/ops` inlineViewableMediaTypes). A type outside this set and
 * outside `text/` is a download here, because asking for it inline returns
 * `content_truncated` with no bytes.
 */
const INLINE_APPLICATION_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-ndjson',
  'application/x-sh',
  'application/xml',
  'application/yaml',
]);

export function laneForArtifact(mediaType: string): ArtifactLane {
  const type = baseMediaType(mediaType);
  if (type === 'text/markdown') return 'markdown';
  if (type === 'text/html') return 'html';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('text/') || INLINE_APPLICATION_TYPES.has(type)) {
    return 'code';
  }
  return 'download';
}

// Monaco language per media type. Only types that name a language are here;
// `text/plain` is deliberately absent so it falls through to the file name,
// which is the one signal left when the publisher could not identify the
// content (every unknown extension is published as text/plain).
const LANGUAGE_BY_MEDIA_TYPE: Record<string, string> = {
  'application/javascript': 'javascript',
  'application/json': 'json',
  'application/sql': 'sql',
  'application/toml': 'ini',
  'application/typescript': 'typescript',
  'application/x-ndjson': 'json',
  'application/x-sh': 'shell',
  'application/xml': 'xml',
  'application/yaml': 'yaml',
  'text/html': 'html',
  'text/markdown': 'markdown',
  'text/x-go': 'go',
  'text/x-python': 'python',
  'text/xml': 'xml',
};

export function languageForArtifact(mediaType: string, name: string): string {
  const known = LANGUAGE_BY_MEDIA_TYPE[baseMediaType(mediaType)];
  if (known) return known;
  return languageForPath(name);
}

/** A viewfinder frame the browser pane already owns, not a deliverable. */
export function isBrowserFrame(name: string): boolean {
  return name.startsWith(BROWSER_FRAME_ARTIFACT_PREFIX);
}

/** One name and every published version of it, newest first. */
export interface ArtifactNameGroup {
  name: string;
  mediaType: string;
  lane: ArtifactLane;
  versions: AionArtifact[];
  /** The newest version — what the list rail labels and the viewer opens. */
  latest: AionArtifact;
}

export interface GroupedArtifacts {
  /** Things the agent wrote: documents, pages, code, data. */
  documents: ArtifactNameGroup[];
  /** Pictures it took. Separated because a browsing run buries the rest. */
  captures: ArtifactNameGroup[];
}

/**
 * Groups a listing by name, newest name first, with each name's versions
 * ordered newest first. A name repeats within a Project by design — a run
 * that writes report.md twice publishes two artifacts — and nothing records
 * that v2 supersedes v1, so the shared name IS the history.
 *
 * Viewfinder frames are dropped: the browser pane renders those, and a
 * browsing run publishes one per action, which would bury the deliverables
 * this panel exists to show.
 */
export function groupArtifacts(artifacts: AionArtifact[]): GroupedArtifacts {
  const byName = new Map<string, AionArtifact[]>();
  for (const artifact of artifacts) {
    if (isBrowserFrame(artifact.name)) continue;
    const versions = byName.get(artifact.name);
    if (versions) versions.push(artifact);
    else byName.set(artifact.name, [artifact]);
  }

  const documents: ArtifactNameGroup[] = [];
  const captures: ArtifactNameGroup[] = [];
  // Insertion order is the listing's own order (published_at DESC), so the
  // most recently published name leads without a second sort.
  for (const [name, unsorted] of byName) {
    const versions = [...unsorted].sort((a, b) => b.version - a.version);
    const latest = versions[0];
    const group: ArtifactNameGroup = {
      name,
      mediaType: latest.mediaType,
      lane: laneForArtifact(latest.mediaType),
      versions,
      latest,
    };
    if (group.lane === 'image') captures.push(group);
    else documents.push(group);
  }
  return { documents, captures };
}

/** Human size for a row label. Bytes below 1 KiB stay exact. */
export function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
