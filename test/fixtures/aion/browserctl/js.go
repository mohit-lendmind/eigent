package main

// Page-world JavaScript. The ref/snapshot model mirrors the hybrid-browser
// toolkit semantics the desktop product already teaches its models: a
// snapshot lists interactive elements as "- [eN] <tag> label (state)"
// lines and mints window.__aionRefs[eN] handles that mutating actions
// (click/type/select) resolve. Refs are re-minted by every snapshot and
// die with navigation — exactly the lifetime the snapshot-driven prompt
// contract expects.

// consoleHookJS is installed once per tab via
// Page.addScriptToEvaluateOnNewDocument so console history survives
// between short-lived CLI invocations without any CDP event
// subscription. Bounded ring of 500 entries.
const consoleHookJS = `(function () {
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
})();`

// snapshotJS walks the DOM for visible interactive elements, mints refs,
// and returns a JSON string {url, title, elements: [...], truncated}.
const snapshotJS = `(function () {
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
})()`

// refRectJS(ref) scrolls the element into view and returns its viewport
// center as a JSON string, or an error marker when the ref is unknown
// (stale snapshot / navigated page).
const refRectJS = `(function (ref) {
  var el = (window.__aionRefs || {})[ref];
  if (!el || !el.getBoundingClientRect) return JSON.stringify({ error: 'unknown ref ' + ref + ' (take a new browser_get_page_snapshot; refs die on navigation)' });
  el.scrollIntoView({ block: 'center', inline: 'center' });
  var r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
})(%q)`

// focusAndClearJS(ref) focuses an input-like ref and clears its current
// value through the native setter so framework-controlled inputs (React
// et al.) observe the change before Input.insertText types the new text.
const focusAndClearJS = `(function (ref) {
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
})(%q)`

// selectJS(ref, value) sets a <select> by option value, falling back to
// visible option text, and fires the events frameworks listen for.
const selectJS = `(function (ref, value) {
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
})(%q, %q)`

// consoleReadJS returns the hooked console ring (or an empty list plus a
// note when the hook never ran on this document).
const consoleReadJS = `(function () {
  if (!window.__aionConsole) return JSON.stringify({ entries: [], note: 'no console history for this page' });
  return JSON.stringify({ entries: window.__aionConsole });
})()`
