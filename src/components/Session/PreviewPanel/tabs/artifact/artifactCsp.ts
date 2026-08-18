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

// The security boundary for previewing an agent-authored HTML page.
//
// A `srcdoc` iframe INHERITS the embedding document's policy, and this app's
// policy (index.html) declares no `default-src` and no `connect-src` — so a
// page dropped into a srcdoc frame with no policy of its own can fetch
// anywhere the renderer can. The sandbox attribute does not close that: it
// takes away origin and forms, not the network. Policies compose
// most-restrictive-wins, so a `<meta http-equiv="Content-Security-Policy">`
// injected ahead of the page's own content is what actually constrains it.

/**
 * Subresource hosts a preview may load from once the user opts in. This is a
 * copy of the allowlist in index.html, and `artifactCsp.test.ts` reads that
 * file and fails if the two ever diverge — a host added there and missed here
 * would render as a dashboard that silently draws nothing.
 */
export const ARTIFACT_CDN_HOSTS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://ajax.googleapis.com',
  'https://code.jquery.com',
  'https://stackpath.bootstrapcdn.com',
  'https://cdn.tailwindcss.com',
  'https://cdn.plot.ly',
  'https://d3js.org',
  'https://cdn.datatables.net',
  'https://cdn.chart.js',
  'https://cdn.canvasjs.com',
  'https://cdn.amcharts.com',
  'https://threejs.org',
  'https://pixijs.download',
  'https://cdn.babylonjs.com',
  'https://aframe.io',
  'https://cesium.com',
  'https://cdn.lottiefiles.com',
  'https://cdn.socket.io',
  'https://cdn.firebase.com',
  'https://maps.googleapis.com',
  'https://api.mapbox.com',
  'https://cdn.tiny.cloud',
  'https://cdn.ckeditor.com',
  'https://cdn.quilljs.com',
  'https://cdn.mathjax.org',
  'https://cdn.ethers.io',
  'https://cdn.auth0.com',
  'https://cdn.plyr.io',
  'https://vjs.zencdn.net',
  'https://cdn.dashjs.org',
  'https://cdn.npmmirror.com',
  'https://registry.npmmirror.com',
] as const;

/**
 * The policy for one preview.
 *
 * Off (the default) is a page that runs but reaches nothing: its own inline
 * script and style work, images it inlined as data or built as blobs work,
 * and every load from anywhere else is refused.
 *
 * On relaxes exactly four directives to the known CDN hosts — enough for a
 * chart library or a stylesheet to load — and keeps `connect-src 'none'`,
 * which is the point of the toggle. "Allow external resources" means
 * subresources from a known list; it never means the page may talk to the
 * network. A page holding a run's findings must not be able to post them
 * somewhere, and the user opting into seeing it drawn is not opting into
 * that.
 */
export function artifactCsp(allowExternal: boolean): string {
  const cdn = ARTIFACT_CDN_HOSTS.join(' ');
  const script = allowExternal
    ? `'unsafe-inline' 'unsafe-eval' ${cdn}`
    : `'unsafe-inline' 'unsafe-eval'`;
  const style = allowExternal ? `'unsafe-inline' ${cdn}` : `'unsafe-inline'`;
  const img = allowExternal ? `data: blob: ${cdn}` : 'data: blob:';
  const font = allowExternal ? `data: ${cdn}` : 'data:';
  return [
    `default-src 'none'`,
    `script-src ${script}`,
    `style-src ${style}`,
    `img-src ${img}`,
    `font-src ${font}`,
    // Stated rather than left to default-src so the guarantee survives any
    // later loosening of the fallback: no fetch, no XHR, no WebSocket, no
    // beacon, ever, in either state of the toggle.
    `connect-src 'none'`,
    `form-action 'none'`,
    `base-uri 'none'`,
  ].join('; ');
}

const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * The document to hand a preview iframe: the page's own bytes with the policy
 * ahead of them.
 *
 * The meta goes immediately after the doctype rather than inside `<head>`,
 * because finding the real `<head>` means matching text that a script string
 * can also contain — and a policy injected into the wrong place is a policy
 * that does not apply, which is the one failure mode that must not be
 * possible here. A `<meta>` before `<html>` is parsed into the implicit head,
 * and the page's own `<html>` tag merges its attributes onto it. The doctype
 * is kept in front so the page still renders in standards mode.
 */
export function withArtifactCsp(html: string, allowExternal: boolean): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${artifactCsp(
    allowExternal
  )}">`;
  const doctype = DOCTYPE.exec(html);
  if (!doctype) return `${meta}${html}`;
  return `${doctype[0]}${meta}${html.slice(doctype[0].length)}`;
}
