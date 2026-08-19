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

import axios from 'axios';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell,
  webContents,
} from 'electron';
import log from 'electron-log';
import FormData from 'form-data';
import fsp from 'fs/promises';
import mime from 'mime';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs, { existsSync } from 'node:fs';
import http from 'node:http';
import os, { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyBrowserData } from './copy';
import { FileReader } from './fileReader';
import { findAvailablePort } from './utils/port';
import { setRoundedCorners } from './native/macos-window';
import {
  normalizeApiKey,
  rendererTransportConfig,
  resolveRemoteBackend,
  type RemoteBackendResolution,
} from './remoteBackend';
import {
  completeCodexOAuthCallback,
  registerCodexSubscriptionAuthIpcHandlers,
} from './subscriptionAuth';
import { disposeAllTerminals, registerTerminalIpcHandlers } from './terminal';
import { agentBrowser, type AgentBrowserRequest } from './agentBrowser';
import { registerUpdateIpcHandlers, update } from './update';
import {
  getEmailFolderPath,
  getEnvPath,
  maskProxyUrl,
  readGlobalEnvKey,
  removeEnvKey,
  updateEnvBlock,
} from './utils/envUtil';
import { createDiagnosticsZip, zipFolder } from './utils/log';
import { WebViewManager } from './webview';

// ==================== constants ====================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_DIST = path.join(__dirname, '../..');
const RENDERER_DIST = path.join(MAIN_DIST, 'dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(MAIN_DIST, 'public')
  : RENDERER_DIST;

// ==================== global variables ====================
let win: BrowserWindow | null = null;
let createWindowPromise: Promise<void> | null = null;
let webViewManager: WebViewManager | null = null;
let fileReader: FileReader | null = null;
let proxyUrl: string | null = null;

// The aion edge is the only backend. A set-but-invalid configuration stays
// remote and fails visibly — there is no other backend to fall back to.
//
// Resolution is deferred rather than computed at module load, for two reasons
// that are both about the key file: the stored-key path hangs off `userData`,
// which the E2E hook below overrides after this module is evaluated, and
// onboarding re-resolves once it has written a key.
let remoteBackendCache: RemoteBackendResolution | null = null;

/** Where onboarding writes a pasted key when no operator env names a file. */
const storedApiKeyPath = (): string =>
  path.join(app.getPath('userData'), 'aion-edge-api-key');

const resolveBackend = (): RemoteBackendResolution => {
  remoteBackendCache ??= resolveRemoteBackend(
    process.env,
    (file) => fs.readFileSync(file, 'utf-8'),
    storedApiKeyPath()
  );
  return remoteBackendCache;
};

const reresolveBackend = (): RemoteBackendResolution => {
  remoteBackendCache = null;
  return resolveBackend();
};

const PREVIEW_WEBVIEW_PARTITION = 'persist:session-preview';

const isHttpOrHttpsUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

type BackendStartResult =
  | { success: true; remote: true; port: null }
  | { success: false; error: string };

function isBrokenConsolePipeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'EPIPE' ||
      (error as NodeJS.ErrnoException).code === 'ERR_STREAM_DESTROYED')
  );
}

function disableConsoleLogTransport(): void {
  if (log.transports.console.level !== false) {
    log.transports.console.level = false;
  }
}

function handleProcessPipeError(error: Error): void {
  if (isBrokenConsolePipeError(error)) {
    disableConsoleLogTransport();
    return;
  }

  setImmediate(() => {
    throw error;
  });
}

process.stdout.on('error', handleProcessPipeError);
process.stderr.on('error', handleProcessPipeError);

function notifyBackendReady(result: BackendStartResult): void {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send(
    'backend-ready',
    result.success
      ? {
          success: true,
          port: result.port,
          ...('remote' in result && { remote: true }),
        }
      : {
          success: false,
          error: result.error,
        }
  );
}

// Protocol URL queue for handling URLs before window is ready
let protocolUrlQueue: string[] = [];
let isWindowReady = false;

// ==================== path config ====================
// CJS on purpose: an ESM preload loads asynchronously and its contextBridge
// exposures race the renderer's boot-time desktop detection (see vite.config.ts).
const preload = path.join(__dirname, '../preload/index.cjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');
const logPath = log.transports.file.getFile().path;

// Storage strategy:
// 1. Main window: partition 'persist:main_window' in app userData → Eternyl account (persistent)
// 2. WebView: partition 'persist:user_login' in app userData → will import cookies from tool_controller via session API
// 3. tool_controller: ~/.eigent/browser_profiles/profile_user_login → source of truth for login cookies
//
// The browser runs headless inside the aion sandbox pod (browser_* tools
// over the exec seam), so the app must not open a local CDP debugging port —
// an unauthenticated localhost control surface with no consumer.

// Memory optimization settings
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '512');
app.commandLine.appendSwitch('max_old_space_size', '4096');
app.commandLine.appendSwitch('enable-features', 'MemoryPressureReduction');
app.commandLine.appendSwitch('renderer-process-limit', '8');

// Disable Fontations (Rust-based font engine) to prevent crashes on macOS
app.commandLine.appendSwitch('disable-features', 'Fontations');

// ==================== Proxy configuration ====================
// Read proxy from global .env file on startup
proxyUrl = readGlobalEnvKey('HTTP_PROXY');
if (proxyUrl) {
  log.info(`[PROXY] Applying proxy configuration: ${maskProxyUrl(proxyUrl)}`);
  app.commandLine.appendSwitch('proxy-server', proxyUrl);
} else {
  log.info('[PROXY] No proxy configured');
}

// ==================== Anti-fingerprint settings ====================
// Disable automation controlled indicator to avoid detection
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Override User Agent to remove Electron/eigent identifiers
// Dynamically generate User Agent based on actual platform and Chrome version
const getPlatformUA = () => {
  // Use actual Chrome version from Electron instead of hardcoded value
  const chromeVersion = process.versions.chrome || '131.0.0.0';
  switch (process.platform) {
    case 'darwin':
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    case 'win32':
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    case 'linux':
      return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    default:
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
};
const normalUserAgent = getPlatformUA();
app.userAgentFallback = normalUserAgent;

// ==================== protocol privileges ====================
// Register custom protocol privileges before app ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      bypassCSP: false,
    },
  },
]);

// ==================== app config ====================
process.env.APP_ROOT = MAIN_DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// Always follow OS appearance so renderer `prefers-color-scheme` stays accurate.
nativeTheme.themeSource = 'system';

// Set log level
log.transports.console.level = 'info';
log.transports.file.level = 'info';
log.transports.console.format = '[{level}]{text}';
log.transports.file.format = '[{level}]{text}';

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName());

// E2E harness hook (doc 10 §10 M4-I): an isolated userData keeps the test
// instance's single-instance lock and storage away from a developer's real
// app. Set only by the Playwright launcher.
if (process.env.EIGENT_E2E_USER_DATA) {
  app.setPath('userData', process.env.EIGENT_E2E_USER_DATA);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ==================== protocol config ====================
const setupProtocolHandlers = () => {
  if (process.env.NODE_ENV === 'development') {
    const isDefault = app.isDefaultProtocolClient('eternyl', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    if (!isDefault) {
      app.setAsDefaultProtocolClient('eternyl', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('eternyl');
  }
};

// ==================== protocol url handle ====================
function handleProtocolUrl(url: string) {
  log.info('enter handleProtocolUrl');

  // If window is not ready, queue the URL
  if (!isWindowReady || !win || win.isDestroyed()) {
    log.info('Window not ready, queuing protocol URL');
    protocolUrlQueue.push(url);
    return;
  }

  void processProtocolUrl(url);
}

// Process a single protocol URL
async function processProtocolUrl(url: string) {
  const urlObj = new URL(url);
  const code = urlObj.searchParams.get('code');
  const token = urlObj.searchParams.get('token');
  const share_token = urlObj.searchParams.get('share_token');

  log.info('urlObj', {
    protocol: urlObj.protocol,
    host: urlObj.host,
    pathname: urlObj.pathname,
  });
  log.info('code present', Boolean(code));
  log.info('token present', Boolean(token));
  log.info('share_token present', Boolean(share_token));

  if (win && !win.isDestroyed()) {
    log.info('urlObj.pathname', urlObj.pathname);

    if (urlObj.pathname === '/oauth') {
      log.info('oauth');
      const provider = urlObj.searchParams.get('provider');
      const code = urlObj.searchParams.get('code');
      const codexResult = await completeCodexOAuthCallback(urlObj);
      if (codexResult.handled) {
        win.webContents.send(
          'subscription-auth:codex-status-changed',
          codexResult.error_code
            ? { error_code: codexResult.error_code }
            : undefined
        );
        return;
      }
      log.info('protocol oauth', provider, Boolean(code));
      win.webContents.send('oauth-authorized', { provider, code });
      return;
    }

    if (token) {
      log.info('protocol token received');
      win.webContents.send('auth-token-received', token);
      return;
    }

    if (code) {
      log.info('protocol code received');
      win.webContents.send('auth-code-received', code);
    }

    if (share_token) {
      win.webContents.send('auth-share-token-received', share_token);
    }
  } else {
    log.error('window not available');
  }
}

// Process all queued protocol URLs
function processQueuedProtocolUrls() {
  if (protocolUrlQueue.length > 0) {
    log.info('Processing queued protocol URLs:', protocolUrlQueue.length);

    // Verify window is ready before processing
    if (!win || win.isDestroyed() || !isWindowReady) {
      log.warn(
        'Window not ready for processing queued URLs, keeping URLs in queue'
      );
      return;
    }

    const urls = [...protocolUrlQueue];
    protocolUrlQueue = [];

    urls.forEach((url) => {
      void processProtocolUrl(url);
    });
  }
}

// ==================== auth callback server ====================
// Local HTTP server for receiving auth callbacks from external login (eigent.ai)
// Works in both dev and production mode, avoids eternyl:// protocol issues in dev
let authCallbackServer: http.Server | null = null;
let authCallbackPort: number | null = null;

async function startAuthCallbackServer() {
  if (authCallbackServer) return authCallbackPort;

  const port = await findAvailablePort(19836, 19900);

  authCallbackServer = http.createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${port}`);

    if (url.pathname === '/auth/callback') {
      const token = url.searchParams.get('token');
      log.info('Auth callback URL:', req.url);
      log.info('Auth callback token present:', !!token);
      log.info('Auth callback win available:', !!win && !win.isDestroyed());

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html><head><title>Login Successful</title>
        <style>
          body { font-family: -apple-system, system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f4f4f9; color: #333; }
          .container { padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
        </style></head>
        <body><div class="container">
          <h1>Login Successful</h1>
          <p>You can close this tab and return to Eternyl.</p>
        </div></body></html>
      `);

      if (token && win && !win.isDestroyed()) {
        log.info('Auth callback received token');
        win.webContents.send('auth-token-received', token);
        win.show();
        win.focus();
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  authCallbackServer.listen(port);
  authCallbackPort = port;
  log.info(`Auth callback server started on port ${port}`);
  return port;
}

// ==================== single instance lock ====================
const setupSingleInstanceLock = () => {
  // The lock is already acquired at module level (requestSingleInstanceLock
  // above). Calling it again here would release and re-acquire the lock,
  // creating a window where a second instance could start. We only need
  // to register the event handlers.
  app.on('second-instance', (event, argv) => {
    log.info('second-instance', argv);
    const url = argv.find((arg) => arg.startsWith('eternyl://'));
    if (url) handleProtocolUrl(url);
    if (win) win.show();
  });

  app.on('open-url', (event, url) => {
    log.info('open-url');
    event.preventDefault();
    handleProtocolUrl(url);
  });
};

// ==================== initialize config ====================
const initializeApp = () => {
  setupProtocolHandlers();
  setupSingleInstanceLock();
};

/**
 * Registers all IPC handlers once when the app starts
 * This prevents "Attempted to register a second handler" errors
 * when windows are reopened
 */
// Get backup log path
const getBackupLogPath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'logs', 'main.log');
};
// Constants define
const BROWSER_PATHS = {
  win32: {
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    qq: 'C:\\Program Files\\Tencent\\QQBrowser\\QQBrowser.exe',
    '360': path.join(
      homedir(),
      'AppData\\Local\\360Chrome\\Chrome\\Application\\360chrome.exe'
    ),
    arc: path.join(homedir(), 'AppData\\Local\\Arc\\User Data\\Arc.exe'),
    dia: path.join(homedir(), 'AppData\\Local\\Dia\\Application\\dia.exe'),
    fellou: path.join(
      homedir(),
      'AppData\\Local\\Fellou\\Application\\fellou.exe'
    ),
  },
  darwin: {
    chrome: '/Applications/Google Chrome.app',
    edge: '/Applications/Microsoft Edge.app',
    firefox: '/Applications/Firefox.app',
    safari: '/Applications/Safari.app',
    arc: '/Applications/Arc.app',
    dia: '/Applications/Dia.app',
    fellou: '/Applications/Fellou.app',
  },
} as const;

// Tool function
const getSystemLanguage = async () => {
  const locale = app.getLocale();
  return locale === 'zh-CN' ? 'zh-cn' : 'en';
};

const checkManagerInstance = (manager: any, name: string) => {
  if (!manager) {
    throw new Error(`${name} not initialized`);
  }
  return manager;
};

function registerIpcHandlers() {
  registerCodexSubscriptionAuthIpcHandlers(ipcMain);
  registerTerminalIpcHandlers();

  // ==================== auth callback ====================
  ipcMain.handle('get-auth-callback-url', async () => {
    const port = await startAuthCallbackServer();
    return `http://localhost:${port}/auth/callback`;
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
  // The minimum authenticated transport configuration for the renderer's
  // aion boundary (src/api/aion/v1).
  ipcMain.handle('get-aion-transport-config', () =>
    rendererTransportConfig(resolveBackend())
  );

  // Onboarding's only write path. The key never lands in renderer storage: it
  // is written 0600 under the resolution's own key-file path — the same
  // mechanism EIGENT_REMOTE_BACKEND_API_KEY_FILE names — and reaches the
  // renderer again only inside the transport config it already receives.
  //
  // An empty `keyFilePath` is the refusal, and it is mechanical rather than a
  // policy guess: it means the key in force came from the environment, so a
  // file written here would change nothing and the panel would be reporting a
  // key the next restart silently replaces.
  const writeStoredApiKey = (
    contents: string
  ): { ok: true } | { ok: false; error: string } => {
    const backend = resolveBackend();
    if (backend.mode === 'remote-invalid') {
      return { ok: false, error: backend.error };
    }
    if (backend.keyFilePath === '') {
      return {
        ok: false,
        error:
          'This backend’s API key is set in the environment, so it cannot be changed from the app.',
      };
    }
    try {
      fs.mkdirSync(path.dirname(backend.keyFilePath), { recursive: true });
      fs.writeFileSync(backend.keyFilePath, contents, { mode: 0o600 });
      // An existing file keeps its old mode through writeFileSync, so a key
      // file created before this path existed is tightened here too.
      fs.chmodSync(backend.keyFilePath, 0o600);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    reresolveBackend();
    return { ok: true };
  };

  ipcMain.handle('set-aion-api-key', (_event, rawKey: unknown) => {
    let key: string;
    try {
      key = normalizeApiKey(typeof rawKey === 'string' ? rawKey : '');
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return writeStoredApiKey(`${key}\n`);
  });

  // Signing out truncates rather than unlinks: an empty key file and an absent
  // one resolve the same way, and truncation leaves the operator's path in
  // place for the next key.
  ipcMain.handle('clear-aion-api-key', () => writeStoredApiKey(''));

  // ==================== restart app handler ====================
  ipcMain.handle('restart-app', () => {
    log.info('[RESTART] Restarting app to apply user profile changes');

    // Schedule relaunch after a short delay
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 100);
  });

  ipcMain.handle('get-system-language', getSystemLanguage);
  ipcMain.handle('is-fullscreen', () => win?.isFullScreen() || false);
  ipcMain.handle('get-home-dir', () => {
    const platform = process.platform;
    return platform === 'win32' ? process.env.USERPROFILE : process.env.HOME;
  });

  // ==================== command execution handler ====================
  ipcMain.handle('get-email-folder-path', async (event, email: string) => {
    return getEmailFolderPath(email);
  });
  ipcMain.handle(
    'execute-command',
    async (event, command: string, email: string) => {
      log.info('execute-command', command);
      const { MCP_REMOTE_CONFIG_DIR } = getEmailFolderPath(email);

      try {
        const { spawn } = await import('child_process');

        const commandWithHost = command;

        log.info(' start execute command:', commandWithHost);

        // Parse command and arguments
        const [cmd, ...args] = commandWithHost.split(' ');
        log.info('start execute command:', commandWithHost.split(' '));
        console.log(cmd, args);
        return new Promise((resolve) => {
          const child = spawn(cmd, args, {
            cwd: process.cwd(),
            env: { ...process.env, MCP_REMOTE_CONFIG_DIR },
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let stdout = '';
          let stderr = '';

          // Realtime listen standard output
          child.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            log.info('Real-time output:', output.trim());
          });

          // Realtime listen error output
          child.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            if (output.includes('OAuth callback server running at')) {
              const url = output
                .split('OAuth callback server running at')[1]
                .trim();
              log.info('detect OAuth callback URL:', url);

              // Notify frontend to callback URL
              if (win && !win.isDestroyed()) {
                const match = url.match(/^https?:\/\/[^:\n]+:\d+/);
                const cleanedUrl = match ? match[0] : null;
                log.info('cleanedUrl', cleanedUrl);
                win.webContents.send('oauth-callback-url', {
                  url: cleanedUrl,
                  provider: 'notion', // TODO: can be set dynamically according to actual situation
                });
              }
            }
            if (output.includes('Press Ctrl+C to exit')) {
              child.kill();
            }
            log.info(' real-time error output:', output.trim());
          });

          // Listen process exit
          child.on('close', (code) => {
            log.info(` command execute complete, exit code: ${code}`);
            resolve({ success: code === null, stdout, stderr });
          });

          // Listen process error
          child.on('error', (error) => {
            log.error(' command execute error:', error);
            resolve({ success: false, error: error.message });
          });
        });
      } catch (error: any) {
        log.error(' command execute failed:', error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle('read-file-dataurl', async (event, filePath) => {
    try {
      const file = fs.readFileSync(filePath);
      const mimeType =
        mime.getType(path.extname(filePath)) || 'application/octet-stream';
      return `data:${mimeType};base64,${file.toString('base64')}`;
    } catch (error: any) {
      log.error('Failed to read file as data URL:', filePath, error);
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });

  // ==================== log export handler ====================
  ipcMain.handle('export-log', async () => {
    try {
      let targetLogPath = logPath;
      if (!fs.existsSync(targetLogPath)) {
        const backupPath = getBackupLogPath();
        if (fs.existsSync(backupPath)) {
          targetLogPath = backupPath;
        } else {
          return { success: false, error: 'no log file' };
        }
      }

      await fsp.access(targetLogPath, fs.constants.R_OK);
      const stats = await fsp.stat(targetLogPath);
      if (stats.size === 0) {
        return { success: true, data: 'log file is empty' };
      }

      const logContent = await fsp.readFile(targetLogPath, 'utf-8');

      // Get app version and system version
      const appVersion = app.getVersion();
      const platform = process.platform;
      const arch = process.arch;
      const systemVersion = `${platform}-${arch}`;
      const defaultFileName = `eigent-${appVersion}-${systemVersion}-${Date.now()}.log`;

      // Show save dialog
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'save log file',
        defaultPath: defaultFileName,
        filters: [{ name: 'log file', extensions: ['log', 'txt'] }],
      });

      if (canceled || !filePath) {
        return { success: false, error: '' };
      }

      await fsp.writeFile(filePath, logContent, 'utf-8');
      return { success: true, savedPath: filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-diagnostics-info', async () => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    };
  });

  ipcMain.handle(
    'export-diagnostics-zip',
    async (
      _event,
      payload: { description: string; steps?: string } | undefined
    ) => {
      try {
        const description =
          typeof payload?.description === 'string'
            ? payload.description.trim()
            : '';
        if (!description) {
          return { success: false, error: 'Description is required' };
        }
        const steps =
          typeof payload?.steps === 'string' ? payload.steps.trim() : '';

        const logFiles: { src: string; destName: string }[] = [];
        if (fs.existsSync(logPath)) {
          logFiles.push({ src: logPath, destName: 'electron-main.log' });
        }
        const backupResolved = getBackupLogPath();
        if (
          fs.existsSync(backupResolved) &&
          path.resolve(backupResolved) !== path.resolve(logPath)
        ) {
          logFiles.push({
            src: backupResolved,
            destName: 'electron-userdata-logs.log',
          });
        }
        if (logFiles.length === 0) {
          return { success: false, error: 'no log file' };
        }

        const appVersion = app.getVersion();
        const platform = process.platform;
        const arch = process.arch;
        const bugReportText = [
          'Eternyl bug report',
          '=================',
          '',
          `App version: ${appVersion}`,
          `OS: ${platform} (${arch})`,
          '',
          'Description',
          '-----------',
          description,
          '',
          ...(steps
            ? ['Steps to reproduce', '-------------------', steps, '']
            : []),
        ].join('\n');

        const defaultFileName = `eigent-diagnostics-${appVersion}-${Date.now()}.zip`;
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Save diagnostics',
          defaultPath: defaultFileName,
          filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
        });

        if (canceled || !filePath) {
          return { success: false, error: '' };
        }

        await createDiagnosticsZip(filePath, bugReportText, logFiles);
        return { success: true, savedPath: filePath };
      } catch (error: any) {
        log.error('export-diagnostics-zip failed:', error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle('open-mailto', async (_event, url: string) => {
    try {
      if (typeof url !== 'string' || !url.startsWith('mailto:')) {
        return { success: false, error: 'Invalid mailto URL' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      if (!isHttpOrHttpsUrl(url)) {
        return { success: false, error: 'Invalid external URL' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'upload-log',
    async (
      event,
      email: string,
      taskId: string,
      baseUrl: string,
      token: string
    ) => {
      let zipPath: string | null = null;

      try {
        // Validate required parameters
        if (!email || !taskId || !baseUrl || !token) {
          return { success: false, error: 'Missing required parameters' };
        }

        // Sanitize taskId to prevent path traversal attacks
        const sanitizedTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!sanitizedTaskId) {
          return { success: false, error: 'Invalid task ID' };
        }

        const { MCP_REMOTE_CONFIG_DIR } = getEmailFolderPath(email);
        const logFolderName = `task_${sanitizedTaskId}`;
        const logFolderPath = path.join(MCP_REMOTE_CONFIG_DIR, logFolderName);

        // Check if log folder exists
        if (!fs.existsSync(logFolderPath)) {
          return { success: false, error: 'Log folder not found' };
        }

        zipPath = path.join(MCP_REMOTE_CONFIG_DIR, `${logFolderName}.zip`);
        await zipFolder(logFolderPath, zipPath);

        // Create form data with file stream
        const formData = new FormData();
        const fileStream = fs.createReadStream(zipPath);
        formData.append('file', fileStream);
        formData.append('task_id', sanitizedTaskId);

        // Upload with timeout
        const response = await axios.post(
          baseUrl + '/api/chat/logs',
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
              Authorization: `Bearer ${token}`,
            },
            timeout: 60000, // 60 second timeout
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }
        );

        fileStream.destroy();

        if (response.status === 200) {
          return { success: true, data: response.data };
        } else {
          return { success: false, error: response.data };
        }
      } catch (error: any) {
        log.error('Failed to upload log:', error);
        return { success: false, error: error.message || 'Upload failed' };
      } finally {
        // Clean up zip file
        if (zipPath && fs.existsSync(zipPath)) {
          try {
            fs.unlinkSync(zipPath);
          } catch (cleanupError) {
            log.error('Failed to clean up zip file:', cleanupError);
          }
        }
      }
    }
  );

  // ==================== browser related handler ====================
  // TODO: next version implement
  ipcMain.handle('check-install-browser', async () => {
    try {
      const platform = process.platform;
      const results: Record<string, boolean> = {};
      const paths = BROWSER_PATHS[platform as keyof typeof BROWSER_PATHS];

      if (!paths) {
        log.warn(`not support current platform: ${platform}`);
        return {};
      }

      for (const [browser, execPath] of Object.entries(paths)) {
        results[browser] = existsSync(execPath);
      }

      return results;
    } catch (error: any) {
      log.error('Failed to check browser installation:', error);
      return {};
    }
  });

  ipcMain.handle('start-browser-import', async (event, args) => {
    const isWin = process.platform === 'win32';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const home = os.homedir();

    const candidates: Record<string, string> = {
      chrome: isWin
        ? `${localAppData}\\Google\\Chrome\\User Data\\Default`
        : `${home}/Library/Application Support/Google/Chrome/Default`,
      edge: isWin
        ? `${localAppData}\\Microsoft\\Edge\\User Data\\Default`
        : `${home}/Library/Application Support/Microsoft Edge/Default`,
      firefox: isWin
        ? `${appData}\\Mozilla\\Firefox\\Profiles`
        : `${home}/Library/Application Support/Firefox/Profiles`,
      qq: `${localAppData}\\Tencent\\QQBrowser\\User Data\\Default`,
      '360': `${localAppData}\\360Chrome\\Chrome\\User Data\\Default`,
      arc: isWin
        ? `${localAppData}\\Arc\\User Data\\Default`
        : `${home}/Library/Application Support/Arc/Default`,
      dia: `${localAppData}\\Dia\\User Data\\Default`,
      fellou: `${localAppData}\\Fellou\\User Data\\Default`,
      safari: `${home}/Library/Safari`,
    };

    // Filter unchecked browser
    Object.keys(candidates).forEach((key) => {
      const browser = args.find((item: any) => item.browserId === key);
      if (!browser || !browser.checked) {
        delete candidates[key];
      }
    });

    const result: Record<string, string | null> = {};
    for (const [name, p] of Object.entries(candidates)) {
      result[name] = fs.existsSync(p) ? p : null;
    }

    const electronUserDataPath = app.getPath('userData');

    for (const [browserName, browserPath] of Object.entries(result)) {
      if (!browserPath) continue;
      await copyBrowserData(browserName, browserPath, electronUserDataPath);
    }

    return { success: true };
  });

  // ==================== window control handler ====================
  ipcMain.on('window-close', (_, data) => {
    if (data.isForceQuit) {
      return app?.quit();
    }
    return win?.close();
  });
  ipcMain.on('window-minimize', () => win?.minimize());
  ipcMain.on('window-toggle-maximize', () => {
    if (win?.isMaximized()) {
      win?.unmaximize();
    } else {
      win?.maximize();
    }
  });

  // ==================== file operation handler ====================
  ipcMain.handle('select-file', async (event, options = {}) => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      ...options,
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const files = result.filePaths.map((filePath) => ({
        filePath,
        fileName: filePath.split(/[/\\]/).pop() || '',
      }));

      return {
        success: true,
        files,
        fileCount: files.length,
      };
    }

    return {
      success: false,
      canceled: result.canceled,
    };
  });

  // Handle drag-and-drop files - convert File objects to file paths
  ipcMain.handle(
    'process-dropped-files',
    async (event, fileData: Array<{ name: string; path?: string }>) => {
      try {
        // In Electron with contextIsolation, we need to get file paths differently
        // The renderer will send us file metadata, and we'll use webUtils if needed
        const files = fileData
          .filter((f) => f.path) // Only process files with valid paths
          .map((f) => ({
            filePath: fs.realpathSync(f.path!),
            fileName: f.name,
          }));

        if (files.length === 0) {
          return {
            success: false,
            error: 'No valid file paths found',
          };
        }

        return {
          success: true,
          files,
        };
      } catch (error: any) {
        log.error('Failed to process dropped files:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }
  );

  // Persist a pasted file (e.g. a clipboard image) so it can join the
  // path-based attachment flow; pasted File objects carry no filesystem path.
  ipcMain.handle(
    'save-pasted-file',
    async (_event, fileName: string, data: ArrayBuffer) => {
      try {
        const pastedDir = path.join(app.getPath('temp'), 'eigent-pasted');
        await fsp.mkdir(pastedDir, { recursive: true });
        const stamp = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\..+/, '')
          .replace('T', '-');
        const safeName = (fileName || 'pasted-file').replace(/[^\w.-]+/g, '_');
        const unique = crypto.randomUUID();
        const filePath = path.join(pastedDir, `${stamp}-${unique}-${safeName}`);
        await fsp.writeFile(filePath, Buffer.from(new Uint8Array(data)));
        return { success: true, filePath, fileName: safeName };
      } catch (error: any) {
        log.error('Failed to save pasted file:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // Capture the visible page of a preview-browser guest as a JPEG on disk so
  // it can join the path-based attachment flow. Scoped hard: the id must
  // resolve to a live <webview> guest in the preview partition — this handler
  // must not become a capture-any-webContents primitive.
  ipcMain.handle(
    'capture-preview-guest',
    async (_event, webContentsId: number) => {
      try {
        const contents = webContents.fromId(webContentsId);
        if (
          !contents ||
          contents.isDestroyed() ||
          contents.getType() !== 'webview' ||
          contents.session !== session.fromPartition(PREVIEW_WEBVIEW_PARTITION)
        ) {
          return { success: false, error: 'Not a preview browser page' };
        }

        let jpeg: Buffer | null = null;
        const debuggerApi = contents.debugger;
        let attachedHere = false;
        let cdpTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (!debuggerApi.isAttached()) {
            debuggerApi.attach('1.3');
            attachedHere = true;
          }
          // A wedged renderer can hold the CDP reply forever; time-box it so
          // the click still gets an answer via capturePage.
          const result = (await Promise.race([
            debuggerApi.sendCommand('Page.captureScreenshot', {
              format: 'jpeg',
              quality: 60,
              fromSurface: true,
            }),
            new Promise((_, reject) => {
              cdpTimer = setTimeout(
                () => reject(new Error('CDP screenshot timed out')),
                5000
              );
            }),
          ])) as { data?: string };
          if (result?.data) {
            jpeg = Buffer.from(result.data, 'base64');
          }
        } catch (error) {
          log.warn(
            'CDP screenshot failed for preview guest, falling back to capturePage:',
            error
          );
        } finally {
          clearTimeout(cdpTimer);
          if (attachedHere && debuggerApi.isAttached()) {
            try {
              debuggerApi.detach();
            } catch (detachError) {
              log.warn('Failed to detach preview guest debugger:', detachError);
            }
          }
        }
        if (!jpeg) {
          const image = await contents.capturePage();
          jpeg = image.toJPEG(60);
        }
        // The edge refuses attachments over 3 MiB decoded; a viewport JPEG
        // only gets there on pathological pages, where a coarser encode of the
        // same frame must do — recapturing could show a different page.
        const maxAttachBytes = 3 << 20;
        if (jpeg.length > maxAttachBytes) {
          jpeg = nativeImage.createFromBuffer(jpeg).toJPEG(30);
          if (jpeg.length > maxAttachBytes) {
            return {
              success: false,
              error: 'The page renders too large to attach',
            };
          }
        }

        const captureDir = path.join(app.getPath('temp'), 'eigent-captures');
        await fsp.mkdir(captureDir, { recursive: true });
        const stamp = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\..+/, '')
          .replace('T', '-');
        const fileName = `page-${stamp}-${crypto.randomUUID().slice(0, 8)}.jpg`;
        const filePath = path.join(captureDir, fileName);
        await fsp.writeFile(filePath, jpeg);
        return { success: true, filePath, fileName };
      } catch (error: any) {
        log.error('Failed to capture preview guest:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // Delegated browser execution: the renderer's delegation executor hands
  // each parked browser_* call to the visible agent window. Scoped hard, the
  // capture-preview-guest way: only a top-level app renderer may call it (a
  // <webview> guest showing arbitrary web content must never reach a surface
  // that drives an input stream on the user's machine), and the request shape
  // is validated here before anything touches the window.
  const fromAppRenderer = (event: Electron.IpcMainInvokeEvent) =>
    !event.sender.isDestroyed() && event.sender.getType() === 'window';

  const asDelegationRequest = (raw: unknown): AgentBrowserRequest | null => {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.delegationId !== 'string' ||
      r.delegationId === '' ||
      typeof r.runId !== 'string' ||
      r.runId === '' ||
      typeof r.toolName !== 'string' ||
      r.toolName === '' ||
      typeof r.argumentsJson !== 'string' ||
      r.argumentsJson.length > 10_000
    ) {
      return null;
    }
    const sessionMode = r.sessionMode ?? '';
    if (
      sessionMode !== '' &&
      sessionMode !== 'isolated' &&
      sessionMode !== 'logged_in'
    ) {
      return null;
    }
    return {
      delegationId: r.delegationId,
      runId: r.runId,
      toolName: r.toolName,
      argumentsJson: r.argumentsJson,
      sessionMode,
    };
  };

  ipcMain.handle('agent-browser:execute', async (event, raw: unknown) => {
    if (!fromAppRenderer(event)) {
      return { success: false, error: 'Not an app window' };
    }
    const request = asDelegationRequest(raw);
    if (!request) {
      return { success: false, error: 'Malformed delegation request' };
    }
    try {
      const result = await agentBrowser.execute(request);
      return { success: true, result };
    } catch (error: any) {
      log.error('Agent browser delegation failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent-browser:status', async (event) => {
    if (!fromAppRenderer(event)) {
      return { success: false, error: 'Not an app window' };
    }
    return { success: true, status: agentBrowser.status() };
  });

  ipcMain.handle('agent-browser:take-control', async (event, taken: unknown) => {
    if (!fromAppRenderer(event)) {
      return { success: false, error: 'Not an app window' };
    }
    if (typeof taken !== 'boolean') {
      return { success: false, error: 'Malformed take-control request' };
    }
    agentBrowser.takeControl(taken);
    return { success: true, status: agentBrowser.status() };
  });

  ipcMain.handle('reveal-in-folder', async (event, filePath: string) => {
    try {
      const stats = await fs.promises
        .stat(filePath.replace(/\/$/, ''))
        .catch(() => null);
      if (stats && stats.isDirectory()) {
        shell.openPath(filePath);
      } else {
        shell.showItemInFolder(filePath);
      }
    } catch (e) {
      log.error('reveal in folder failed', e);
    }
  });

  // Skills: all operations via Brain REST API (backend). No IPC.

  // ==================== read file handler ====================
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      log.info('Reading file:', filePath);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        log.error('File does not exist:', filePath);
        return { success: false, error: 'File does not exist' };
      }
      const stats = await fsp.stat(filePath);
      if (stats.isDirectory()) {
        log.error('Path is a directory, not a file:', filePath);
        return { success: false, error: 'Path is a directory, not a file' };
      }

      const fileContent = await fsp.readFile(filePath);

      return {
        success: true,
        data: fileContent,
        size: fileContent.length,
      };
    } catch (error: any) {
      log.error('Failed to read file:', filePath, error);
      return {
        success: false,
        error: error.message || 'Failed to read file',
      };
    }
  });

  // ==================== delete folder handler ====================
  ipcMain.handle('delete-folder', async (event, email: string) => {
    const { MCP_REMOTE_CONFIG_DIR } = getEmailFolderPath(email);
    try {
      log.info('Deleting folder:', MCP_REMOTE_CONFIG_DIR);

      // Check if folder exists
      if (!fs.existsSync(MCP_REMOTE_CONFIG_DIR)) {
        log.error('Folder does not exist:', MCP_REMOTE_CONFIG_DIR);
        return { success: false, error: 'Folder does not exist' };
      }

      // Check if it's actually a directory
      const stats = await fsp.stat(MCP_REMOTE_CONFIG_DIR);
      if (!stats.isDirectory()) {
        log.error('Path is not a directory:', MCP_REMOTE_CONFIG_DIR);
        return { success: false, error: 'Path is not a directory' };
      }

      // Delete folder recursively
      await fsp.rm(MCP_REMOTE_CONFIG_DIR, { recursive: true, force: true });
      log.info('Folder deleted successfully:', MCP_REMOTE_CONFIG_DIR);

      return {
        success: true,
        message: 'Folder deleted successfully',
      };
    } catch (error: any) {
      log.error('Failed to delete folder:', MCP_REMOTE_CONFIG_DIR, error);
      return {
        success: false,
        error: error.message || 'Failed to delete folder',
      };
    }
  });

  // ==================== get MCP config path handler ====================
  ipcMain.handle('get-mcp-config-path', async (event, email: string) => {
    try {
      const { MCP_REMOTE_CONFIG_DIR, tempEmail } = getEmailFolderPath(email);
      log.info('Getting MCP config path for email:', email);
      log.info('MCP config path:', MCP_REMOTE_CONFIG_DIR);
      return {
        success: MCP_REMOTE_CONFIG_DIR,
        path: MCP_REMOTE_CONFIG_DIR,
        tempEmail: tempEmail,
      };
    } catch (error: any) {
      log.error('Failed to get MCP config path:', error);
      return {
        success: false,
        error: error.message || 'Failed to get MCP config path',
      };
    }
  });

  // ==================== IDE integration handler ====================
  ipcMain.handle(
    'get-project-folder-path',
    async (
      _event,
      email: string,
      projectId: string,
      userId?: string | number | null
    ) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      const result = manager.createProjectStructure(email, projectId, userId);
      return result.path;
    }
  );

  ipcMain.handle(
    'open-in-ide',
    async (_event, folderPath: string, ide: string) => {
      const getIDECommand = (): string => {
        const platform = process.platform;
        const homeDir = homedir();

        if (ide === 'vscode') {
          if (platform === 'darwin') {
            // macOS: Check common VS Code CLI paths
            const vscodePaths = [
              '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
              '/usr/local/bin/code',
            ];
            for (const p of vscodePaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] VS Code not found on macOS, using system file manager'
            );
            return '';
          } else if (platform === 'win32') {
            // Windows: Check common VS Code paths
            const vscodePaths = [
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Microsoft VS Code',
                'bin',
                'code.cmd'
              ),
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Microsoft VS Code',
                'Code.exe'
              ),
              'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
              'C:\\Program Files\\Microsoft VS Code\\Code.exe',
            ];
            for (const p of vscodePaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] VS Code not found on Windows, using system file manager'
            );
            return '';
          }
          return 'code'; // Linux
        } else if (ide === 'cursor') {
          if (platform === 'darwin') {
            // macOS: Check common Cursor CLI paths
            const cursorPaths = [
              '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
              '/usr/local/bin/cursor',
            ];
            for (const p of cursorPaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] Cursor not found on macOS, using system file manager'
            );
            return '';
          } else if (platform === 'win32') {
            // Windows: Check common Cursor paths
            const cursorPaths = [
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Cursor',
                'resources',
                'app',
                'bin',
                'cursor.cmd'
              ),
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Cursor',
                'Cursor.exe'
              ),
              path.join(homeDir, 'AppData', 'Local', 'Cursor', 'Cursor.exe'),
            ];
            for (const p of cursorPaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] Cursor not found on Windows, using system file manager'
            );
            return '';
          }
          return 'cursor'; // Linux
        }
        return '';
      };

      const cmd = getIDECommand();
      if (!cmd) {
        // IDE not found or 'system' selected - open with system file manager
        const errorMsg = await shell.openPath(folderPath);
        if (errorMsg) {
          log.error('[IDE] shell.openPath error:', errorMsg);
          return { success: false, error: errorMsg };
        }
        return { success: true };
      }

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        // Use shell: true so .cmd/.bat wrappers work on Windows
        const child = spawn(cmd, [folderPath], {
          shell: true,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();

        child.on('error', (error) => {
          log.warn(
            `[IDE] ${cmd} not found, falling back to system file manager:`,
            error.message
          );
          shell.openPath(folderPath).then((errorMsg) => {
            resolve(
              errorMsg ? { success: false, error: errorMsg } : { success: true }
            );
          });
        });

        child.on('spawn', () => {
          resolve({ success: true });
        });
      });
    }
  );

  // ==================== env handler ====================

  ipcMain.handle('get-env-path', async (_event, email) => {
    return getEnvPath(email);
  });

  ipcMain.handle('get-env-has-key', async (_event, email, key) => {
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('env-remove error:', error);
    }
    let lines = content.split(/\r?\n/);
    return { success: lines.some((line) => line.startsWith(key + '=')) };
  });

  ipcMain.handle('env-write', async (_event, email, { key, value }) => {
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('env-write error:', error);
    }
    let lines = content.split(/\r?\n/);
    lines = updateEnvBlock(lines, { [key]: value });
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');

    // Also write to global .env file for backend process to read
    const GLOBAL_ENV_PATH = path.join(os.homedir(), '.eigent', '.env');
    let globalContent = '';
    try {
      globalContent = fs.existsSync(GLOBAL_ENV_PATH)
        ? fs.readFileSync(GLOBAL_ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('global env-write read error:', error);
    }
    let globalLines = globalContent.split(/\r?\n/);
    globalLines = updateEnvBlock(globalLines, { [key]: value });
    try {
      fs.writeFileSync(GLOBAL_ENV_PATH, globalLines.join('\n'), 'utf-8');
      log.info(`env-write: wrote ${key} to both user and global .env files`);
    } catch (error) {
      log.error('global env-write error:', error);
    }

    return { success: true };
  });

  ipcMain.handle('env-remove', async (_event, email, key) => {
    log.info('env-remove', key);
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('env-remove error:', error);
    }
    let lines = content.split(/\r?\n/);
    lines = removeEnvKey(lines, key);
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
    log.info('env-remove success', ENV_PATH);

    // Also remove from global .env file
    const GLOBAL_ENV_PATH = path.join(os.homedir(), '.eigent', '.env');
    try {
      let globalContent = fs.existsSync(GLOBAL_ENV_PATH)
        ? fs.readFileSync(GLOBAL_ENV_PATH, 'utf-8')
        : '';
      let globalLines = globalContent.split(/\r?\n/);
      globalLines = removeEnvKey(globalLines, key);
      fs.writeFileSync(GLOBAL_ENV_PATH, globalLines.join('\n'), 'utf-8');
      log.info(
        `env-remove: removed ${key} from both user and global .env files`
      );
    } catch (error) {
      log.error('global env-remove error:', error);
    }

    return { success: true };
  });

  // ==================== read global env handler ====================
  const ALLOWED_GLOBAL_ENV_KEYS = new Set(['HTTP_PROXY', 'HTTPS_PROXY']);
  ipcMain.handle('read-global-env', async (_event, key: string) => {
    if (!ALLOWED_GLOBAL_ENV_KEYS.has(key)) {
      log.warn(`[ENV] Blocked read of disallowed global env key: ${key}`);
      return { value: null };
    }
    return { value: readGlobalEnvKey(key) };
  });

  // ==================== new window handler ====================
  ipcMain.handle('open-win', (_, arg) => {
    const childWindow = new BrowserWindow({
      webPreferences: {
        preload,
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    if (VITE_DEV_SERVER_URL) {
      childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
    } else {
      childWindow.loadFile(indexHtml, { hash: arg });
    }
  });

  // ==================== FileReader handler ====================
  ipcMain.handle(
    'open-file',
    async (_, type: string, filePath: string, isShowSourceCode: boolean) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.openFile(type, filePath, isShowSourceCode);
    }
  );

  ipcMain.handle('download-file', async (_, url: string) => {
    try {
      const https = await import('https');
      const http = await import('http');

      // extract file name from URL
      const urlObj = new URL(url);
      const fileName = urlObj.pathname.split('/').pop() || 'download';

      // get download directory
      const downloadPath = path.join(app.getPath('downloads'), fileName);

      // create write stream
      const fileStream = fs.createWriteStream(downloadPath);

      // choose module according to protocol
      const client = url.startsWith('https:') ? https : http;

      return new Promise((resolve, reject) => {
        const request = client.get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            shell.showItemInFolder(downloadPath);
            resolve({ success: true, path: downloadPath });
          });

          fileStream.on('error', (err) => {
            reject(err);
          });
        });

        request.on('error', (err) => {
          reject(err);
        });
      });
    } catch (error: any) {
      log.error('Download file error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'get-file-list',
    async (
      _,
      email: string,
      taskId: string,
      projectId?: string,
      userId?: string | number | null
    ) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.getFileList(email, taskId, projectId, userId);
    }
  );

  ipcMain.handle(
    'delete-task-files',
    async (_, email: string, taskId: string, projectId?: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.deleteTaskFiles(email, taskId, projectId);
    }
  );

  // New project management handlers
  ipcMain.handle(
    'create-project-structure',
    async (
      _,
      email: string,
      projectId: string,
      userId?: string | number | null
    ) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.createProjectStructure(email, projectId, userId);
    }
  );

  ipcMain.handle('get-project-list', async (_, email: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getProjectList(email);
  });

  ipcMain.handle(
    'get-tasks-in-project',
    async (_, email: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.getTasksInProject(email, projectId);
    }
  );

  ipcMain.handle(
    'move-task-to-project',
    async (_, email: string, taskId: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.moveTaskToProject(email, taskId, projectId);
    }
  );

  ipcMain.handle(
    'get-project-file-list',
    async (
      _,
      email: string,
      projectId: string,
      userId?: string | number | null
    ) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.getProjectFileList(email, projectId, userId);
    }
  );

  ipcMain.handle('get-log-folder', async (_, email: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getLogFolder(email);
  });

  // ==================== WebView handler ====================
  const webviewHandlers = [
    { name: 'capture-webview', method: 'captureWebview' },
    { name: 'create-webview', method: 'createWebview' },
    { name: 'hide-webview', method: 'hideWebview' },
    { name: 'show-webview', method: 'showWebview' },
    { name: 'change-view-size', method: 'changeViewSize' },
    { name: 'hide-all-webview', method: 'hideAllWebview' },
    { name: 'get-active-webview', method: 'getActiveWebview' },
    { name: 'set-size', method: 'setSize' },
    { name: 'get-show-webview', method: 'getShowWebview' },
    { name: 'webview-destroy', method: 'destroyWebview' },
  ];

  webviewHandlers.forEach(({ name, method }) => {
    ipcMain.handle(name, async (_, ...args) => {
      const manager = checkManagerInstance(webViewManager, 'WebViewManager');
      return manager[method as keyof typeof manager](...args);
    });
  });

  // ==================== register update related handler ====================
  registerUpdateIpcHandlers();
}

// ==================== ensure eigent directories ====================
const ensureEigentDirectories = () => {
  const eigentBase = path.join(os.homedir(), '.eigent');
  const requiredDirs = [
    eigentBase,
    path.join(eigentBase, 'bin'),
    path.join(eigentBase, 'cache'),
    path.join(eigentBase, 'venvs'),
    path.join(eigentBase, 'runtime'),
    path.join(eigentBase, 'skills'),
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      log.info(`Creating directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log.info('.eigent directory structure ensured');
};

// ==================== skills (used at startup and by IPC) ====================
const SKILLS_ROOT = path.join(os.homedir(), '.eigent', 'skills');
const SKILL_FILE = 'SKILL.md';
const EXAMPLE_SKILL_MARKER = '.eigent-example-skill';

const getExampleSkillsSourceDir = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'example-skills');
  }
  const devPath = path.join(MAIN_DIST, 'resources', 'example-skills');
  if (existsSync(devPath)) return devPath;
  return path.join(app.getAppPath(), 'resources', 'example-skills');
};

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    // Skip symlinks to prevent copying files from outside the source tree
    if (entry.isSymbolicLink()) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else {
      await fsp.copyFile(srcPath, dstPath);
    }
  }
}

function parseSkillName(content: string): string | null {
  const match = content.match(/^\s*name\s*:\s*(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
}

async function readSkillName(skillDir: string): Promise<string | null> {
  try {
    const content = await fsp.readFile(
      path.join(skillDir, SKILL_FILE),
      'utf-8'
    );
    return parseSkillName(content);
  } catch {
    return null;
  }
}

async function isManagedExampleSkill(
  dstDir: string,
  srcDir: string
): Promise<boolean> {
  if (existsSync(path.join(dstDir, EXAMPLE_SKILL_MARKER))) return true;
  const [dstName, srcName] = await Promise.all([
    readSkillName(dstDir),
    readSkillName(srcDir),
  ]);
  return !!dstName && dstName === srcName;
}

async function writeExampleSkillMarker(
  dstDir: string,
  sourceDirName: string
): Promise<void> {
  await fsp.writeFile(
    path.join(dstDir, EXAMPLE_SKILL_MARKER),
    `source=${sourceDirName}\n`,
    'utf-8'
  );
}

async function listRegularFiles(
  root: string,
  ignoredNames = new Set<string>()
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || ignoredNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.set(path.relative(root, fullPath), fullPath);
      }
    }
  };
  await walk(root);
  return files;
}

async function dirContentsMatch(src: string, dst: string): Promise<boolean> {
  const [srcFiles, dstFiles] = await Promise.all([
    listRegularFiles(src),
    listRegularFiles(dst, new Set([EXAMPLE_SKILL_MARKER])),
  ]);
  if (srcFiles.size !== dstFiles.size) return false;
  for (const [relativePath, srcPath] of srcFiles) {
    const dstPath = dstFiles.get(relativePath);
    if (!dstPath) return false;
    const [srcContent, dstContent] = await Promise.all([
      fsp.readFile(srcPath),
      fsp.readFile(dstPath),
    ]);
    if (!srcContent.equals(dstContent)) return false;
  }
  return true;
}

async function syncDefaultSkillsFromBundle(): Promise<void> {
  if (!existsSync(SKILLS_ROOT)) {
    await fsp.mkdir(SKILLS_ROOT, { recursive: true });
  }
  const exampleDir = getExampleSkillsSourceDir();
  if (!existsSync(exampleDir)) {
    log.warn('Example skills source dir missing:', exampleDir);
    return;
  }
  const sourceEntries = await fsp.readdir(exampleDir, { withFileTypes: true });
  let copiedCount = 0;
  let updatedCount = 0;
  for (const e of sourceEntries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const skillMd = path.join(exampleDir, e.name, SKILL_FILE);
    if (!existsSync(skillMd)) continue;
    const destDir = path.join(SKILLS_ROOT, e.name);
    const srcDir = path.join(exampleDir, e.name);
    if (!existsSync(destDir)) {
      await copyDirRecursive(srcDir, destDir);
      await writeExampleSkillMarker(destDir, e.name);
      copiedCount++;
      continue;
    }

    const destStats = await fsp.stat(destDir).catch(() => null);
    if (!destStats?.isDirectory()) continue;

    if (!(await isManagedExampleSkill(destDir, srcDir))) {
      log.warn('Skipping default skill sync due to local conflict:', destDir);
      continue;
    }

    if (await dirContentsMatch(srcDir, destDir)) {
      await writeExampleSkillMarker(destDir, e.name);
      continue;
    }

    await fsp.rm(destDir, { recursive: true, force: true });
    await copyDirRecursive(srcDir, destDir);
    await writeExampleSkillMarker(destDir, e.name);
    updatedCount++;
  }
  if (copiedCount > 0 || updatedCount > 0) {
    log.info(
      `Synced default skill(s) to ~/.eigent/skills: copied=${copiedCount} updated=${updatedCount} from`,
      exampleDir
    );
  }
}

async function seedDefaultSkillsIfEmpty(): Promise<void> {
  await syncDefaultSkillsFromBundle();
}

// ==================== window create ====================
async function createWindow() {
  const existingWindow =
    win && !win.isDestroyed() ? win : BrowserWindow.getAllWindows()[0];
  if (existingWindow && !existingWindow.isDestroyed()) {
    win = existingWindow;
    win.focus();
    return;
  }

  if (createWindowPromise) {
    await createWindowPromise;
    if (win && !win.isDestroyed()) {
      win.focus();
    }
    return;
  }

  createWindowPromise = createWindowInternal().finally(() => {
    createWindowPromise = null;
  });

  return createWindowPromise;
}

async function createWindowInternal() {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  // Ensure .eigent directories exist before anything else
  ensureEigentDirectories();
  await seedDefaultSkillsIfEmpty();

  log.info('[PROJECT BROWSER WINDOW] Creating BrowserWindow (CDP disabled)');
  log.info(
    `[PROJECT BROWSER WINDOW] Current user data path: ${app.getPath(
      'userData'
    )}`
  );
  log.info(
    `[PROJECT BROWSER WINDOW] Command line switch user-data-dir: ${app.commandLine.getSwitchValue(
      'user-data-dir'
    )}`
  );

  // Platform-specific window configuration
  // Windows: native frame and solid background. macOS/Linux: frameless; macOS corner radius via native hook.
  win = new BrowserWindow({
    title: 'Eternyl',
    width: 1280,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    // Use native frame on Windows for better native integration
    frame: isWindows ? true : false,
    show: false, // Don't show until content is ready to avoid white screen
    // Only use transparency on macOS and Linux (not supported well on Windows)
    transparent: !isWindows,
    // Solid on Windows; macOS solid without vibrancy; Linux unchanged semi-transparent tint
    backgroundColor: isWindows
      ? nativeTheme.shouldUseDarkColors
        ? '#1e1e1e'
        : '#ffffff'
      : isMac
        ? nativeTheme.shouldUseDarkColors
          ? '#1e1e1e'
          : '#f5f5f5'
        : '#f5f5f580',
    // macOS-specific title bar styling
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 10, y: 12 } : undefined,
    icon: path.join(VITE_PUBLIC, 'favicon.ico'),
    // Rounded corners on macOS and Linux (as original)
    roundedCorners: !isWindows,
    // Windows-specific options
    ...(isWindows && {
      autoHideMenuBar: true, // Hide menu bar on Windows for cleaner look
    }),
    webPreferences: {
      // Use a dedicated partition for main window to isolate from webviews
      // This ensures main window's auth data (localStorage) is stored separately and persists across restarts
      partition: 'persist:main_window',
      webSecurity: false,
      preload,
      nodeIntegration: true,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  // Renderer <webview> guests (session preview browser) host arbitrary web
  // content, and the host window itself runs with elevated webPreferences.
  // Enforce safe guest settings at attach time so no tag attribute (even one
  // forged by a compromised renderer) can grant a guest host privileges.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.partition = PREVIEW_WEBVIEW_PARTITION;

    if (
      params.partition !== PREVIEW_WEBVIEW_PARTITION ||
      !isHttpOrHttpsUrl(params.src)
    ) {
      event.preventDefault();
    }
  });

  // Route window.open / target=_blank into the same guest instead of spawning
  // popup windows, and only allow web URLs. Together with the attach guard
  // above, this is the only main-process involvement the guests need.
  win.webContents.on('did-attach-webview', (_event, contents) => {
    const preventUnsafeNavigation = (
      event: Electron.Event,
      navigationUrl: string
    ) => {
      if (!isHttpOrHttpsUrl(navigationUrl)) {
        event.preventDefault();
      }
    };
    const guestNavigationEvents = contents as unknown as {
      on: (
        eventName: string,
        listener: (event: Electron.Event, navigationUrl: string) => void
      ) => void;
    };

    guestNavigationEvents.on('will-navigate', preventUnsafeNavigation);
    guestNavigationEvents.on('will-frame-navigate', preventUnsafeNavigation);
    guestNavigationEvents.on('will-redirect', preventUnsafeNavigation);
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpOrHttpsUrl(url)) {
        void contents.loadURL(url);
      }
      return { action: 'deny' };
    });
  });

  if (process.platform === 'darwin') {
    win.once('ready-to-show', () => {
      if (win && !win.isDestroyed()) {
        try {
          setRoundedCorners(win, 20);
        } catch (error) {
          log.error('[MacOS] Failed to apply rounded corners:', error);
        }
      }
    });
  }

  // ==================== Handle renderer crashes and failed loads ====================
  win.webContents.on('render-process-gone', (event, details) => {
    log.error('[RENDERER] Process gone:', details.reason, details.exitCode);
    if (win && !win.isDestroyed()) {
      // Reload the window after a brief delay
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          log.info('[RENDERER] Attempting to reload after crash...');
          if (VITE_DEV_SERVER_URL) {
            win.loadURL(VITE_DEV_SERVER_URL);
          } else {
            win.loadFile(indexHtml);
          }
        }
      }, 1000);
    }
  });

  win.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      log.error(
        `[RENDERER] Failed to load: ${errorCode} - ${errorDescription} - ${validatedURL}`
      );
      // Retry loading after a delay
      if (errorCode !== -3) {
        // -3 is USER_CANCELLED, don't retry
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            log.info('[RENDERER] Retrying load after failure...');
            if (VITE_DEV_SERVER_URL) {
              win.loadURL(VITE_DEV_SERVER_URL);
            } else {
              win.loadFile(indexHtml);
            }
          }
        }, 2000);
      }
    }
  );

  // Main window now uses default userData directly with partition 'persist:main_window'
  // No migration needed - data is already persistent

  // ==================== Import cookies from tool_controller to WebView BEFORE creating WebViews ====================
  // Copy partition data files before any session accesses them
  try {
    const browserProfilesBase = path.join(
      os.homedir(),
      '.eigent',
      'browser_profiles'
    );
    const toolControllerProfile = path.join(
      browserProfilesBase,
      'profile_user_login'
    );
    const toolControllerPartitionPath = path.join(
      toolControllerProfile,
      'Partitions',
      'user_login'
    );

    if (fs.existsSync(toolControllerPartitionPath)) {
      log.info(
        '[COOKIE SYNC] Found tool_controller partition, copying to WebView partition...'
      );

      const targetPartitionPath = path.join(
        app.getPath('userData'),
        'Partitions',
        'user_login'
      );
      log.info('[COOKIE SYNC] From:', toolControllerPartitionPath);
      log.info('[COOKIE SYNC] To:', targetPartitionPath);

      // Ensure target directory exists
      if (!fs.existsSync(path.dirname(targetPartitionPath))) {
        fs.mkdirSync(path.dirname(targetPartitionPath), { recursive: true });
      }

      // Copy the entire partition directory
      fs.cpSync(toolControllerPartitionPath, targetPartitionPath, {
        recursive: true,
        force: true,
      });
      log.info('[COOKIE SYNC] Successfully copied partition data to WebView');

      // Verify cookies were copied
      const targetCookies = path.join(targetPartitionPath, 'Cookies');
      if (fs.existsSync(targetCookies)) {
        const stats = fs.statSync(targetCookies);
        log.info(`[COOKIE SYNC] Cookies file size: ${stats.size} bytes`);
      }
    } else {
      log.info(
        '[COOKIE SYNC] No tool_controller partition found, WebView will start fresh'
      );
    }
  } catch (error) {
    log.error('[COOKIE SYNC] Failed to sync partition data:', error);
  }

  // ==================== initialize manager ====================
  fileReader = new FileReader(win);
  webViewManager = new WebViewManager(win);

  // create multiple webviews
  log.info(
    `[PROJECT BROWSER] Creating WebViews with partition: persist:user_login`
  );
  for (let i = 1; i <= 8; i++) {
    webViewManager.createWebview(i === 1 ? undefined : i.toString());
  }
  log.info('[PROJECT BROWSER] WebViewManager initialized with webviews');

  // ==================== set event listeners ====================
  setupWindowEventListeners();
  setupDevToolsShortcuts();
  setupExternalLinkHandling();
  handleBeforeClose();

  // ==================== auto update ====================
  update(win);

  // Load content
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Wait for window to be ready with timeout
  await new Promise<void>((resolve) => {
    const loadTimeout = setTimeout(() => {
      log.warn('Window content load timeout (10s), showing window anyway...');
      resolve();
    }, 10000);

    win!.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
      log.info(
        'Window content loaded, starting dependency check immediately...'
      );
      resolve();
    });
  });

  // Show window now that content is loaded (or timeout reached)
  if (win && !win.isDestroyed()) {
    win.show();
    log.info('Window shown after content loaded');
  }

  // Mark window as ready and process any queued protocol URLs
  isWindowReady = true;
  log.info('Window is ready, processing queued protocol URLs...');
  processQueuedProtocolUrls();

  // Wait for React components to mount and register event listeners
  await new Promise((resolve) => setTimeout(resolve, 500));

  await checkAndStartBackend();
}

// ==================== window event listeners ====================
const setupWindowEventListeners = () => {
  if (!win) return;

  // close default menu
  Menu.setApplicationMenu(null);
};

// ==================== devtools shortcuts ====================
const setupDevToolsShortcuts = () => {
  if (!win) return;
  if (app.isPackaged) return;

  const toggleDevTools = () => win?.webContents.toggleDevTools();

  win.webContents.on('before-input-event', (event, input) => {
    // F12 key
    if (input.key === 'F12' && input.type === 'keyDown') {
      toggleDevTools();
    }

    // Ctrl+Shift+I (Windows/Linux) or Cmd+Shift+I (Mac)
    if (
      input.control &&
      input.shift &&
      input.key.toLowerCase() === 'i' &&
      input.type === 'keyDown'
    ) {
      toggleDevTools();
    }

    // Mac Cmd+Shift+I
    if (
      input.meta &&
      input.shift &&
      input.key.toLowerCase() === 'i' &&
      input.type === 'keyDown'
    ) {
      toggleDevTools();
    }
  });
};

// ==================== external link handle ====================
const setupExternalLinkHandling = () => {
  if (!win) return;

  // Helper function to check if URL is external
  const isExternalUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      // Allow localhost and internal URLs
      if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
        return false;
      }
      // Allow hash navigation
      if (url.startsWith('#') || url.startsWith('/#')) {
        return false;
      }
      // External URLs start with http/https and are not localhost
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // handle new window open
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // handle navigation
  win.webContents.on('will-navigate', (event, url) => {
    // Only prevent navigation and open external URLs
    // Allow internal navigation like hash changes
    if (isExternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
    // For internal URLs (localhost, hash navigation), allow navigation to proceed
  });
};

// ==================== backend readiness ====================
// There is no local backend to install, spawn, health-poll, or restart:
// readiness is decided by edge-config validation at startup, and edge
// reachability is the renderer session layer's concern.
const checkAndStartBackend = async (): Promise<BackendStartResult> => {
  const backend = resolveBackend();
  // A missing key is readiness, not failure: the endpoint is known and
  // onboarding is what asks for the credential. Only an endpoint this build
  // cannot use at all fails here.
  if (backend.mode === 'remote' || backend.mode === 'remote-needs-key') {
    const result: BackendStartResult = {
      success: true,
      remote: true,
      port: null,
    };
    notifyBackendReady(result);
    return result;
  }

  log.error('Backend configuration is invalid:', backend.error);
  const result: BackendStartResult = {
    success: false,
    error: `Backend configuration is invalid: ${backend.error}`,
  };
  notifyBackendReady(result);
  return result;
};

// before close
const handleBeforeClose = () => {
  let isQuitting = false;

  app.on('before-quit', () => {
    isQuitting = true;
  });

  win?.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win?.webContents.send('before-close');
    }
  });
};

// ==================== app event handle ====================
app.whenReady().then(async () => {

  // ==================== install React DevTools ====================
  // Only install in development mode
  if (VITE_DEV_SERVER_URL) {
    try {
      log.info('[DEVTOOLS] Installing React DevTools extension...');
      // Dynamic import to avoid bundling in production
      const { default: installExtension, REACT_DEVELOPER_TOOLS } =
        await import('electron-devtools-installer');
      const name = await installExtension(REACT_DEVELOPER_TOOLS, {
        loadExtensionOptions: { allowFileAccess: true },
      });
      log.info(`[DEVTOOLS] Successfully installed extension: ${name}`);
    } catch (err) {
      log.error('[DEVTOOLS] Failed to install React DevTools:', err);
      // Don't throw - allow app to continue even if extension installation fails
    }
  }

  // ==================== Anti-fingerprint: Set User Agent for all sessions ====================
  // Use the same dynamic User Agent as app.userAgentFallback
  session.defaultSession.setUserAgent(normalUserAgent);
  // Also set for the user_login partition used by webviews
  session.fromPartition('persist:user_login').setUserAgent(normalUserAgent);
  // And for main_window partition
  session.fromPartition('persist:main_window').setUserAgent(normalUserAgent);
  log.info('[ANTI-FINGERPRINT] User Agent set for all sessions');

  // ==================== Apply proxy to Electron sessions ====================
  if (proxyUrl) {
    const proxyConfig = { proxyRules: proxyUrl };
    await session.defaultSession.setProxy(proxyConfig);
    await session.fromPartition('persist:user_login').setProxy(proxyConfig);
    await session.fromPartition('persist:main_window').setProxy(proxyConfig);
    log.info(
      `[PROXY] Applied proxy to all sessions: ${maskProxyUrl(proxyUrl)}`
    );
  }

  // ==================== download handle ====================
  session.defaultSession.on('will-download', (event, item, _webContents) => {
    item.once('done', (_event, _state) => {
      shell.showItemInFolder(item.getURL().replace('localfile://', ''));
    });
  });

  // ==================== protocol handle ====================
  // Register protocol handler for both default session and main window session
  const protocolHandler = async (request: Request) => {
    const url = decodeURIComponent(request.url.replace('localfile://', ''));
    const normalizedUrl = url.replace(/^\/([A-Za-z]:[\\/])/, '$1');
    const filePath = path.resolve(path.normalize(normalizedUrl));

    log.info(`[PROTOCOL] Handling localfile request: ${request.url}`);
    log.info(`[PROTOCOL] Resolved path: ${filePath}`);

    // Security: Restrict file access to allowed directories only.
    // Without this check, path traversal (e.g. /../../../etc/passwd)
    // would allow reading arbitrary files on the filesystem.
    const allowedBases = [
      os.homedir(),
      app.getPath('userData'),
      app.getPath('temp'),
    ];

    const isPathAllowed = allowedBases.some((base) => {
      const resolvedBase = path.resolve(base);
      return (
        filePath === resolvedBase ||
        filePath.startsWith(resolvedBase + path.sep)
      );
    });

    if (!isPathAllowed) {
      log.error(
        `[PROTOCOL] Security: Blocked access to path outside allowed directories: ${filePath}`
      );
      return new Response('Forbidden', { status: 403 });
    }

    try {
      // Check if file exists
      const fileExists = await fsp
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      if (!fileExists) {
        log.error(`[PROTOCOL] File not found: ${filePath}`);
        return new Response('File Not Found', { status: 404 });
      }

      const data = await fsp.readFile(filePath);
      log.info(`[PROTOCOL] Successfully read file, size: ${data.length} bytes`);

      // set correct Content-Type according to file extension
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'application/octet-stream';

      switch (ext) {
        case '.pdf':
          contentType = 'application/pdf';
          break;
        case '.html':
        case '.htm':
          contentType = 'text/html';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.svg':
          contentType = 'image/svg+xml';
          break;
        case '.webp':
          contentType = 'image/webp';
          break;
      }

      log.info(`[PROTOCOL] Returning file with Content-Type: ${contentType}`);

      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': data.length.toString(),
        },
      });
    } catch (err) {
      log.error(`[PROTOCOL] Error reading file: ${err}`);
      return new Response('Internal Server Error', { status: 500 });
    }
  };

  // Register on default session
  protocol.handle('localfile', protocolHandler);

  // Also register on main window session
  const mainSession = session.fromPartition('persist:main_window');
  mainSession.protocol.handle('localfile', protocolHandler);

  log.info(
    '[PROTOCOL] Registered localfile protocol on both default and main_window sessions'
  );

  // ==================== initialize app ====================
  initializeApp();
  registerIpcHandlers();
  createWindow();
});

// ==================== window close event ====================
app.on('window-all-closed', () => {
  log.info('window-all-closed');

  // Clean up WebView manager
  if (webViewManager) {
    webViewManager.destroy();
    webViewManager = null;
  }

  // Reset window state
  win = null;
  isWindowReady = false;
  protocolUrlQueue = [];

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== app activate event ====================
app.on('activate', async () => {
  const allWindows = BrowserWindow.getAllWindows();
  log.info('activate', allWindows.length);

  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    const backendStart = checkAndStartBackend();
    await createWindow();
    const result = await backendStart;
    if (!result.success) {
      log.warn('Backend start during app activation failed:', result.error);
    } else {
      notifyBackendReady(result);
    }
  }
});

// ==================== app exit event ====================
app.on('before-quit', async (event) => {
  log.info('before-quit');

  // Prevent default quit to ensure cleanup completes
  event.preventDefault();

  try {
    // NOTE: Profile sync removed - we now use app userData directly for all partitions
    // No need to sync between different profile directories

    // Clean up resources
    disposeAllTerminals();

    if (webViewManager) {
      webViewManager.destroy();
      webViewManager = null;
    }

    if (win && !win.isDestroyed()) {
      win.destroy();
      win = null;
    }

    // Clean up file reader if exists
    if (fileReader) {
      fileReader = null;
    }

    // Clear any remaining timeouts/intervals
    if (global.gc) {
      global.gc();
    }

    // Reset protocol handling state
    isWindowReady = false;
    protocolUrlQueue = [];

    log.info('All cleanup completed, exiting...');
  } catch (error) {
    log.error('Error during cleanup:', error);
  } finally {
    // Force quit after cleanup
    app.exit(0);
  }
});
