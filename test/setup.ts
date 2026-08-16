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

// Global test setup file
import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// Web Storage, owned by this file rather than by whichever implementation wins.
//
// jsdom provides `window.localStorage`, and Node has provided a global
// `localStorage` of its own since v22 — which needs a backing file to work and
// throws without one. A bare `localStorage` reference inside a module resolves
// to the global, so on a newer Node every store built on zustand's `persist`
// fails with `storage.setItem is not a function` no matter what jsdom set up.
// Installing one implementation under both names removes the ambiguity, and
// keeps a laptop's Node version from deciding whether the suite passes.
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = new MemoryStorage();
  for (const host of [globalThis, window]) {
    Object.defineProperty(host, name, {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}

// Persisted state is global, so one test's writes are the next test's starting
// conditions unless they are cleared — which is how a suite ends up passing in
// file order and failing alone.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Map translation keys to English text
      const translations: Record<string, string> = {
        'chat.welcome-to-eigent': 'Welcome to Eigent',
        'chat.how-can-i-help-you': 'How can I help you today?',
        'chat.it-ticket-creation': 'IT Ticket Creation',
        'chat.bank-transfer-csv-analysis-and-visualization':
          'Bank Transfer CSV Analysis and Visualization',
        'chat.help-organize-my-desktop': 'Please Help Organize My Desktop',
        'setting.search-mcp': 'Search MCPs',
        'chat.by-messaging-eigent': 'By messaging Eigent, you agree to our',
        'chat.terms-of-use': 'Terms of Use',
        'chat.and': 'and',
        'chat.privacy-policy': 'Privacy Policy',
        'chat.it-ticket-creation-message': 'Plan a tennis trip to Palm Springs',
        'chat.bank-transfer-csv-analysis-and-visualization-message':
          'Analyze and visualize bank transfer CSV',
        'chat.help-organize-my-desktop-message':
          'Please Help Organize My Desktop',
        'chat.no-reply-received-task-continue':
          'No reply received, task will continue',
      };
      return translations[key] || key;
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
}));

// Mock Electron APIs if needed
global.electronAPI = {
  // Add mock implementations for electron preload APIs
};

// Mock ipcRenderer
global.ipcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

// Mock environment variables
process.env.NODE_ENV = 'test';

// Global test utilities
global.waitFor = async (callback: () => boolean, timeout = 5000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await callback()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
};

// Add type declarations for globals
declare global {
  var electronAPI: any;
  var ipcRenderer: any;
  var waitFor: (callback: () => boolean, timeout?: number) => Promise<void>;
}

// Setup DOM environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
