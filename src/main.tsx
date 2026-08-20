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

import { isWeb } from '@/client/platform';
// House type: Inter for everything you read, JetBrains Mono for the things you
// scan (labels, ids, counts, elapsed time), Playfair for the few display
// moments. All three ship in the bundle — the packaged app never reaches a CDN.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/playfair-display/500-italic.css';
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600.css';
import { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './components/Layout/ThemeProvider';
import { TooltipProvider } from './components/ui/tooltip';
import { createHost, HostProvider } from './host';
import './i18n';
import { injectHost } from './store/chatStore';
import './style/index.css';

// If you want use Node.js, the`nodeIntegration` needs to be enabled in the Main process.
// import './demos/node'
const host = createHost();
injectHost(host);
const Router = isWeb() ? BrowserRouter : HashRouter;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <Suspense fallback={<div></div>}>
    <Router>
      <HostProvider host={host}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </HostProvider>
    </Router>
  </Suspense>
);

postMessage({ payload: 'removeLoading' }, '*');
