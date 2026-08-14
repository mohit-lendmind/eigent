# Desktop client (Electron)

Desktop-only components and logic. Uses `useHost()` from `@/host`; when `host.electronAPI` is present.

- WindowControls, HardwareBridge-related UI
- IPC handlers for window, file, terminal, etc.

Browser automation is not one of them: agent browsing runs in the aion session
pod, and the local CDP paths in `electron/main/index.ts` are gated off behind
`CDP_BROWSERS_ENABLED`.
