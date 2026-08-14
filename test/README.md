# Tests

Vitest, jsdom environment, one config for everything: `vitest.config.ts`.
Playwright end-to-end suites live in `e2e/` and are documented in
[../README.md](../README.md#verifying-a-change) — they need a live aion edge and
are not part of this directory.

```bash
pnpm test              # whole suite
pnpm test:watch
pnpm test:coverage
pnpm test -- test/unit/store/installationStore.test.ts   # one file
```

`pnpm test` has a **known-failing baseline inherited from upstream**: 23 files /
108 tests fail on a clean checkout. Diff against that baseline rather than
expecting a green run — see
[Known-failing baselines](../README.md#verifying-a-change).

## Layout

```
test/setup.ts        global setup: jest-dom, a react-i18next stub that returns
                     English strings, and a bare global.electronAPI
test/mocks/          shared mocks (see below)
test/fixtures/       golden data, incl. the aion edge contract fixtures
test/unit/           per-module tests, mirroring src/ and electron/
test/integration/    multi-module tests (chat store flows, composed components)
test/screenshots/    Playwright-produced images; not read by vitest
```

Collection covers `test/**` and `src/**` for `*.test.ts(x)` / `*.spec.ts(x)`.

## Mocks

| Module               | Provides                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `electronMocks.ts`   | `setupElectronMocks()`, `createElectronAPIMock()`, `createIpcRendererMock()` |
| `authStore.mock.ts`  | a seeded auth store                                                      |
| `proxy.mock.ts`      | HTTP client stubs                                                        |
| `sse.mock.ts`        | a controllable SSE stream for transport and reducer tests                |

`setupElectronMocks()` installs `window.electronAPI` and `window.ipcRenderer`,
which is what `src/host/createHost.ts` reads. Any renderer test that exercises a
host call needs it in `beforeEach`, and `electronAPI.reset()` in `afterEach`.

The API mock is intentionally small — the surface a desktop test actually
touches: `exportLog`, `getDiagnosticsInfo`, `exportDiagnosticsZip`,
`openMailto`, `removeAllListeners`. `createIpcRendererMock().invoke` resolves
`{ success: false, error: 'Unknown channel' }`, so a test that depends on an IPC
channel has to say so explicitly instead of silently receiving `undefined`.

There are no mocks for a local backend, a dependency installer or a Python
process. This fork has none — the desktop talks to an aion edge, so the thing to
fake in a transport test is the edge (`sse.mock.ts`, `proxy.mock.ts`), not a
child process.

## Writing tests

- Assert on product behavior, not on the mock. A test whose expectations are all
  `expect(mockFn).toHaveBeenCalled()` for calls the test itself made proves
  nothing; import the real module and assert its observable state.
- Prefer the store's own API (`useSomeStore.getState()`, `subscribe`) over
  reaching into internals.
- For reducer and transport work, use the contract fixtures in
  `test/fixtures/aion/` — they are kept in step with the contract mirror, so a
  drift shows up as a test failure rather than a runtime surprise.
