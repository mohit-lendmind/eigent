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

// Maps an aion tool call (name + raw arguments JSON) onto the typed card the
// UI renders for it. Pure data-in/data-out so both surfaces — the inline chat
// timeline and the work-log rows — classify identically, and so the mapping
// is unit-testable without the DOM.

export type ToolLane = 'bash' | 'code' | 'code_diff' | 'browser' | 'generic';

export interface ToolCardModel {
  lane: ToolLane;
  /** Human header: the tool name, or `server · tool` for MCP tools. */
  title: string;
  /** bash */
  command?: string;
  /** code / code_diff / file tools routed to generic */
  path?: string;
  /** code: the file body being written */
  content?: string;
  /** code_diff */
  oldString?: string;
  newString?: string;
  /** code / code_diff: monaco language id derived from the path extension */
  language?: string;
  /** browser: the action verb from the tool-name suffix (e.g. "visit page") */
  action?: string;
  /** browser / web_fetch */
  url?: string;
  /** browser: element ref being clicked/typed into */
  ref?: string;
  /** browser: text being typed */
  text?: string;
  /** generic: one-line argument summary (query, path, name, …) */
  detail?: string;
}

/** Extension → monaco language id. Unknown extensions fall to plaintext. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  proto: 'proto',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  vue: 'html',
  txt: 'plaintext',
};

export function languageForPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return LANGUAGE_BY_EXTENSION[ext] ?? 'plaintext';
}

function parseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Pretty-print raw arguments for the verbose (work-log fold) view. */
export function prettyArgs(argumentsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argumentsJson), null, 2);
  } catch {
    return argumentsJson;
  }
}

// Argument keys that make a one-line summary for tools without a richer lane,
// in the order a reader would want them.
const GENERIC_DETAIL_KEYS = [
  'query',
  'path',
  'url',
  'name',
  'skill',
  'prompt',
  'pattern',
  'key',
];

export function classifyToolCall(
  toolName: string,
  argumentsJson: string
): ToolCardModel {
  const args = parseArgs(argumentsJson);

  if (toolName === 'bash') {
    return {
      lane: 'bash',
      title: toolName,
      command: str(args, 'command') ?? '',
    };
  }

  if (toolName === 'write_file') {
    const path = str(args, 'path') ?? '';
    return {
      lane: 'code',
      title: toolName,
      path,
      content: typeof args.content === 'string' ? args.content : '',
      language: languageForPath(path),
    };
  }

  if (toolName === 'edit_file') {
    const path = str(args, 'path') ?? '';
    return {
      lane: 'code_diff',
      title: toolName,
      path,
      oldString: typeof args.old_string === 'string' ? args.old_string : '',
      newString: typeof args.new_string === 'string' ? args.new_string : '',
      language: languageForPath(path),
    };
  }

  if (toolName.startsWith('browser_')) {
    return {
      lane: 'browser',
      title: toolName,
      action: toolName.slice('browser_'.length).replace(/_/g, ' '),
      url: str(args, 'url'),
      ref: str(args, 'ref'),
      text: str(args, 'text'),
    };
  }

  // MCP tools arrive namespaced `<server>__<tool>`.
  const mcp = toolName.match(/^(.+?)__(.+)$/);
  const title = mcp ? `${mcp[1]} · ${mcp[2]}` : toolName;

  let detail: string | undefined;
  for (const key of GENERIC_DETAIL_KEYS) {
    detail = str(args, key);
    if (detail) break;
  }
  return { lane: 'generic', title, detail };
}
