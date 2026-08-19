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

// Page-world JavaScript for the local browser executor, copied VERBATIM from
// aion's cmd/aion-browserctl/js.go so a delegated action behaves exactly like
// its pod-mode twin: same ref minting, same labels, same literal error
// strings. The vendored copy at test/fixtures/aion/browserctl/js.go pins the
// templates byte-for-byte — a pod-side script change fails the parity test
// here instead of drifting silently.
//
// Go injects parameters with fmt's %q verb; the templates keep the %q markers
// (that is what the parity pin compares) and the builder functions substitute
// JSON.stringify(arg), which produces the same double-quoted string literal.
// String.raw everywhere: these bodies contain regex escapes like \s that an
// ordinary template literal would swallow.

export const consoleHookScript = String.raw`(function () {
  if (window.__aionConsoleHooked) return;
  window.__aionConsoleHooked = true;
  window.__aionConsole = [];
  var push = function (level, text) {
    try {
      window.__aionConsole.push({ level: level, text: String(text).slice(0, 2000), ts: Date.now() });
      if (window.__aionConsole.length > 500) window.__aionConsole.shift();
    } catch (e) {}
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lvl) {
    var orig = console[lvl];
    console[lvl] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); }
        catch (e) { parts.push(String(a)); }
      }
      push(lvl, parts.join(' '));
      return orig.apply(this, arguments);
    };
  });
  window.addEventListener('error', function (e) {
    push('error', e.message + ' @' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
})();`;

export const snapshotScript = String.raw`(function () {
  window.__aionRefs = {};
  var MAX = 150;
  var lines = [];
  var n = 0;
  var truncated = false;
  var sel = 'a[href], button, input, select, textarea, summary, ' +
    '[role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="combobox"], [role="textbox"], [role="tab"], [role="menuitem"], ' +
    '[role="option"], [role="switch"], [onclick], [contenteditable="true"]';
  var els = document.querySelectorAll(sel);
  var label = function (el) {
    var t = el.getAttribute('aria-label') ||
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        ? (el.placeholder || el.name || '')
        : (el.innerText || el.textContent || '')) ||
      el.getAttribute('title') || el.name || el.id || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (n >= MAX) { truncated = true; break; }
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    var st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    n++;
    var ref = 'e' + n;
    window.__aionRefs[ref] = el;
    var tag = el.tagName.toLowerCase();
    var desc = tag;
    if (tag === 'input') desc += ' type=' + (el.type || 'text');
    var role = el.getAttribute('role');
    if (role) desc += ' role=' + role;
    var state = [];
    if (el.disabled) state.push('disabled');
    if (el.checked) state.push('checked');
    if ((tag === 'input' || tag === 'textarea') && el.value) {
      state.push('value: ' + String(el.value).slice(0, 40));
    }
    if (tag === 'select' && el.selectedIndex >= 0 && el.options[el.selectedIndex]) {
      state.push('selected: ' + el.options[el.selectedIndex].text.slice(0, 40));
    }
    if (tag === 'a') {
      var href = el.getAttribute('href') || '';
      if (href && href.charAt(0) !== '#') state.push('href: ' + href.slice(0, 80));
    }
    var line = '- [' + ref + '] <' + desc + '> "' + label(el) + '"';
    if (state.length) line += ' (' + state.join(', ') + ')';
    lines.push(line);
  }
  return JSON.stringify({
    url: location.href,
    title: document.title,
    elements: lines,
    truncated: truncated
  });
})()`;

export const refRectTemplate = String.raw`(function (ref) {
  var el = (window.__aionRefs || {})[ref];
  if (!el || !el.getBoundingClientRect) return JSON.stringify({ error: 'unknown ref ' + ref + ' (take a new browser_get_page_snapshot; refs die on navigation)' });
  el.scrollIntoView({ block: 'center', inline: 'center' });
  var r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
})(%q)`;

export const focusAndClearTemplate = String.raw`(function (ref) {
  var el = (window.__aionRefs || {})[ref];
  if (!el) return JSON.stringify({ error: 'unknown ref ' + ref + ' (take a new browser_get_page_snapshot; refs die on navigation)' });
  el.focus();
  var tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    var proto = tag === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, ''); else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = '';
  }
  return JSON.stringify({ ok: true });
})(%q)`;

export const selectTemplate = String.raw`(function (ref, value) {
  var el = (window.__aionRefs || {})[ref];
  if (!el) return JSON.stringify({ error: 'unknown ref ' + ref + ' (take a new browser_get_page_snapshot; refs die on navigation)' });
  if (el.tagName !== 'SELECT') return JSON.stringify({ error: 'ref ' + ref + ' is not a <select>' });
  var matched = false;
  for (var i = 0; i < el.options.length; i++) {
    var o = el.options[i];
    if (o.value === value || o.text.trim() === value) {
      el.selectedIndex = i;
      matched = true;
      break;
    }
  }
  if (!matched) return JSON.stringify({ error: 'no option matches ' + JSON.stringify(value) });
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ ok: true, selected: el.options[el.selectedIndex].text.slice(0, 80) });
})(%q, %q)`;

export const consoleReadScript = String.raw`(function () {
  if (!window.__aionConsole) return JSON.stringify({ entries: [], note: 'no console history for this page' });
  return JSON.stringify({ entries: window.__aionConsole });
})()`;

/** Substitutes each %q marker, in order, with a JS string literal of the arg. */
function substitute(template: string, args: string[]): string {
  let out = template;
  for (const arg of args) {
    out = out.replace('%q', JSON.stringify(arg));
  }
  return out;
}

export function refRectScript(ref: string): string {
  return substitute(refRectTemplate, [ref]);
}

export function focusAndClearScript(ref: string): string {
  return substitute(focusAndClearTemplate, [ref]);
}

export function selectScript(ref: string, value: string): string {
  return substitute(selectTemplate, [ref, value]);
}
