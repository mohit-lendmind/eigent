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

import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import electron from 'vite-plugin-electron/simple';
import pkg from './package.json';

// Git hash of the last commit that touched server/ — used for stale-server detection.
// Set as VITE_ env var so Vite exposes it to import.meta.env automatically.
try {
  process.env.VITE_SERVER_CODE_HASH = execSync(
    'git log -1 --format=%H -- server/'
  )
    .toString()
    .trim();
} catch {
  // git not available (CI, packaged build, etc.)
}

// Node resolution anchored at the project root — used to pin packages that
// must appear exactly once in the renderer bundle (see resolve.alias).
// react-router is not a direct dependency (only react-router-dom is), so it
// has no top-level link under rules_js and must resolve through
// react-router-dom's own context.
// Canonical project root. Under Bazel the build runs behind sandbox/execroot
// symlinks; Vite realpaths module ids it resolves itself, so an alias base
// that keeps the symlinked path gives '@/x' a different id than the same
// file reached relatively — the renderer graph is then bundled twice and
// module-level state (React contexts, stores) splits between the copies.
const PROJECT_ROOT = realpathSync(__dirname);

// Under Bazel the same source file is reachable through two absolute paths:
// the sandbox scaffold (<obase>/sandbox/<strategy>/<n>/execroot/_main/...,
// hardlinked, so realpath cannot unify it) and the real execroot
// (<obase>/execroot/_main/...). Entry-relative imports resolve through the
// sandbox flavor while alias/require.resolve imports yield the execroot
// flavor. Rollup identifies modules by id string, so the graph forks and
// stateful modules (React contexts, zustand stores) are bundled twice — the
// packaged renderer then loses the HostProvider context and falls back to
// web mode. Canonicalize every resolved absolute id: realpath it, then
// strip the sandbox segment. Outside Bazel both are identity transforms.
const canonicalFsIds = {
  name: 'eigent:canonical-fs-ids',
  enforce: 'pre' as const,
  async resolveId(
    this: any,
    source: string,
    importer: string | undefined,
    options: any
  ) {
    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });
    if (!resolved || resolved.external) return resolved;
    const [file, query] = resolved.id.split('?', 2) as [string, string?];
    // The HTML entry's emitted filename is derived from its id relative to
    // the Vite root, so it must keep the root's own path flavor.
    if (!path.isAbsolute(file) || file.endsWith('.html')) return resolved;
    try {
      let canon = realpathSync(file);
      const desandboxed = canon.replace(
        /\/sandbox\/[^/]+\/\d+\/execroot\//,
        '/execroot/'
      );
      if (desandboxed !== canon && existsSync(desandboxed)) {
        canon = desandboxed;
      }
      if (canon !== file) {
        return { ...resolved, id: query ? `${canon}?${query}` : canon };
      }
    } catch {
      // id is virtual or the file vanished; keep the resolver's answer.
    }
    return resolved;
  },
};

const projectRequire = createRequire(path.join(PROJECT_ROOT, 'package.json'));
const routerDomRequire = createRequire(
  projectRequire.resolve('react-router-dom/package.json')
);

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  rmSync('dist-electron', { recursive: true, force: true });

  const isServe = command === 'serve';
  const isBuild = command === 'build';
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;
  const env = loadEnv(mode, process.cwd(), '');
  // Thin (release) desktop build: no local Brain payload, remote backend
  // required. Statically defined so the Brain lifecycle modules are
  // dead-code-eliminated from main and preload. See electron/main/brain.ts.
  const thinDefine = {
    __EIGENT_THIN__: JSON.stringify(process.env.EIGENT_THIN_BUILD === '1'),
  };
  return {
    resolve: {
      alias: [
        { find: '@', replacement: path.join(PROJECT_ROOT, 'src') },
        // Under the rules_js node_modules layout the same react-router
        // version resolves to two store realpaths (the top-level link and
        // the copy nested under react-router-dom), so Rollup bundles two
        // copies; a Router provider from one is invisible to hooks from
        // the other and the packaged renderer dies at boot with
        // "useRoutes() may be used only in the context of a <Router>".
        // Pin every router entry point to one resolved file.
        {
          find: /^react-router$/,
          replacement: routerDomRequire.resolve('react-router'),
        },
        {
          find: /^react-router\/dom$/,
          replacement: routerDomRequire.resolve('react-router/dom'),
        },
        {
          find: /^react-router-dom$/,
          replacement: projectRequire.resolve('react-router-dom'),
        },
      ],
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      exclude: ['@stackframe/react'],
      force: true,
    },
    plugins: [
      canonicalFsIds,
      react(),
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: 'electron/main/index.ts',
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log(
                /* For `.vscode/.debug.script.mjs` */ '[startup] Electron App'
              );
            } else {
              args.startup();
            }
          },
          vite: {
            define: thinDefine,
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: Object.keys(
                  'dependencies' in pkg ? pkg.dependencies : {}
                ),
              },
            },
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: 'electron/preload/index.ts',
          vite: {
            define: thinDefine,
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: Object.keys(
                  'dependencies' in pkg ? pkg.dependencies : {}
                ),
                // ESM preload scripts load through Node's async module
                // loader, so their contextBridge exposures race the page
                // scripts: on a fast load the renderer evaluates before
                // window.electronAPI/ipcRenderer exist and falls back to
                // web mode. A CJS preload blocks page load until it has
                // run, which the renderer's boot-time detection requires.
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                  inlineDynamicImports: true,
                },
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
    ],
    server: {
      open: false,
      ...(process.env.VSCODE_DEBUG &&
        (() => {
          const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL);
          return {
            host: url.hostname,
            port: +url.port,
          };
        })()),
      proxy: env.VITE_PROXY_URL
        ? {
            '/api': {
              target: env.VITE_PROXY_URL,
              changeOrigin: true,
              ws: true,
            },
          }
        : undefined,
      clearScreen: false,
    },
  };
});

process.on('SIGINT', () => {
  try {
    const backend = path.join(__dirname, 'backend');
    const pid = readFileSync(backend + '/runtime/run.pid', 'utf-8');
    process.kill(parseInt(pid), 'SIGINT');
  } catch (e) {
    console.log('no pid file');
    console.log(e);
  }
});
