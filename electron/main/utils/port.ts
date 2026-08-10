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

// Generic local-port helpers. These predate the thin desktop build but must
// not live in init.ts: they are used for non-Brain ports (browser profile,
// webview devtools), and init.ts is compiled out of the thin build entirely.

import { exec } from 'child_process';
import log from 'electron-log';
import * as net from 'net';
import { promisify } from 'util';

const execAsync = promisify(exec);

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    // Set a timeout to prevent hanging
    const timeout = setTimeout(() => {
      server.close();
      resolve(false);
    }, 1000);

    server.once('error', (err: any) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        // Try to connect to the port to verify it's truly in use
        const client = new net.Socket();
        client.setTimeout(500);

        client.once('connect', () => {
          client.destroy();
          resolve(false); // Port is definitely in use
        });

        client.once('error', () => {
          client.destroy();
          // Port might be in a weird state, consider it unavailable
          resolve(false);
        });

        client.once('timeout', () => {
          client.destroy();
          resolve(false);
        });

        client.connect(port, '127.0.0.1');
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      clearTimeout(timeout);
      server.close(() => {
        console.log('try port', port);
        resolve(true);
      }); // port available, close then return
    });

    // force listen all addresses, prevent judgment
    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

export async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    const platform = process.platform;

    if (platform === 'win32') {
      // 1. get pid of process listen on port
      const { stdout: netstatOut } = await execAsync(
        `netstat -ano | findstr LISTENING | findstr :${port}`
      );
      const lines = netstatOut.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) {
        console.log(`no process listen on port ${port}`);
        return true;
      }

      // get pid from last field
      const pid = lines[0].trim().split(/\s+/).pop();
      if (!pid || isNaN(Number(pid))) {
        console.log(`Invalid PID extracted for port ${port}: ${pid}`);
        return false;
      }

      console.log(`Killing PID: ${pid}`);
      await execAsync(`taskkill /F /PID ${pid}`);
    } else if (platform === 'darwin') {
      await execAsync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
    } else {
      await execAsync(`fuser -k ${port}/tcp 2>/dev/null || true`);
    }

    // Wait a bit for the process to be killed
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check if port is now available
    return await checkPortAvailable(port);
  } catch (error) {
    log.error(`Failed to kill process on port ${port}:`, error);
    return false;
  }
}

export async function findAvailablePort(
  startPort: number,
  maxAttempts = 50
): Promise<number> {
  const triedPorts = new Set<number>();

  const tryPort = async (port: number): Promise<number | null> => {
    if (triedPorts.has(port)) return null;
    triedPorts.add(port);

    const available = await checkPortAvailable(port);
    if (available) {
      return port;
    }

    const killed = await killProcessOnPort(port);
    if (killed) {
      return port;
    }

    return null;
  };

  // return when found port
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = startPort + offset;
    const found = await tryPort(port);
    if (found) return found;
  }

  throw new Error(
    `No available port found in range ${startPort} ~ ${startPort + maxAttempts - 1}`
  );
}
