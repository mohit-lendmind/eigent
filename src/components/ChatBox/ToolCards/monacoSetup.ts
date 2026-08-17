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

// Loaded only through React.lazy from CodeCard so monaco lands in its own
// split chunk and never weighs on app startup. The loader must be pointed at
// the bundled monaco: its default is a CDN fetch, which the packaged Electron
// renderer cannot reach.

import loader from '@monaco-editor/loader';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Read-only viewing needs only the base editor worker (tokenization runs
// in-process); without one monaco falls back to the UI thread and logs errors.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });

export { DiffEditor, default as Editor } from '@monaco-editor/react';
