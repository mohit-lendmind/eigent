#!/usr/bin/env bash

set -euo pipefail

# Guardrail for web separation:
# only src/host/createHost.ts may read window.electronAPI/window.ipcRenderer.

# `|| true` swallows exit 1 for "no matches" — and would equally swallow the
# 127 of a missing tool, passing a check that never ran. So grep is a real
# fallback rather than an assumption that ripgrep is installed.
if command -v rg >/dev/null 2>&1; then
  violations="$(
    rg -n \
      -e 'window\s*(\?\.)?\s*\.\s*(electronAPI|ipcRenderer)' \
      -e '\(window\s+as\s+any\)\s*\.\s*(electronAPI|ipcRenderer)' \
      -e 'window\s*\[\s*["'\''](electronAPI|ipcRenderer)["'\'']\s*\]' \
      --glob '*.{ts,tsx,js,jsx}' \
      --glob '!src/host/createHost.ts' \
      src || true
  )"
else
  violations="$(
    grep -rEn \
      -e 'window[[:space:]]*(\?\.)?[[:space:]]*\.[[:space:]]*(electronAPI|ipcRenderer)' \
      -e '\(window[[:space:]]+as[[:space:]]+any\)[[:space:]]*\.[[:space:]]*(electronAPI|ipcRenderer)' \
      -e 'window[[:space:]]*\[[[:space:]]*["'\''](electronAPI|ipcRenderer)["'\''][[:space:]]*\]' \
      --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
      --exclude-dir=node_modules \
      src | grep -v '^src/host/createHost\.ts:' || true
  )"
fi

if [[ -n "${violations}" ]]; then
  echo "Found forbidden direct Electron window access outside Host bridge:"
  echo "${violations}"
  exit 1
fi

echo "Electron window access guard passed."
