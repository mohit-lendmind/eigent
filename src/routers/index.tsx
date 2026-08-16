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

import { getAionBackendState } from '@/store/aionChatBridge';
import { useAuthStore } from '@/store/authStore';
import { lazy, useEffect, useReducer } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import Layout from '@/components/Layout';
// Lazy load page components
const Workspace = lazy(() => import('@/pages/Workspace'));
const History = lazy(() => import('@/pages/History'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const IntegrationLab = lazy(() => import('@/pages/IntegrationLab'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));

interface AuthState {
  loading: boolean;
  isAuthenticated: boolean;
  initialized: boolean;
}

type AuthAction =
  | { type: 'INITIALIZE'; payload: { isAuthenticated: boolean } }
  | { type: 'LOGOUT' };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        loading: false,
        isAuthenticated: action.payload.isAuthenticated,
        initialized: true,
      };
    case 'LOGOUT':
      return { loading: false, isAuthenticated: false, initialized: true };
    default:
      return state;
  }
};

// Route guard: Check if user is logged in
// Route guard: the desktop's credential is the edge API key the main process
// resolved, so "signed in" means the key is present and usable. Every other
// backend state routes to onboarding, which is the screen that can name it.
const ProtectedRoute = () => {
  const [state, dispatch] = useReducer(authReducer, {
    loading: false,
    isAuthenticated: false,
    initialized: false,
  });

  const { setInitState, setIsFirstLaunch } = useAuthStore();
  useEffect(() => {
    let cancelled = false;
    getAionBackendState()
      .then((backend) => {
        if (cancelled) return;
        if (backend.kind === 'ready') {
          setInitState('done');
          setIsFirstLaunch(false);
        }
        dispatch({
          type: 'INITIALIZE',
          payload: { isAuthenticated: backend.kind === 'ready' },
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: 'INITIALIZE', payload: { isAuthenticated: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [setInitState, setIsFirstLaunch]);

  if (state.loading || !state.initialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }
  if (state.isAuthenticated) {
    return <Outlet />;
  }
  return <Navigate to="/onboarding" replace />;
};

// Main route configuration
const AppRoutes = () => (
  <Routes>
    {/* Outside ProtectedRoute: this is a diagnostics view, and the states it
        exists to show are the ones that fail the guard. */}
    <Route path="/integration-lab" element={<IntegrationLab />} />
    {/* Also outside the guard: this is the screen that produces the credential
        the guard checks. */}
    <Route path="/onboarding" element={<Onboarding />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        <Route path="/" element={<Workspace />} />
        <Route path="/history" element={<History />} />
        <Route
          path="/setting"
          element={<Navigate to="/history?tab=settings" replace />}
        />
        <Route
          path="/setting/*"
          element={<Navigate to="/history?tab=settings" replace />}
        />
      </Route>
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export default AppRoutes;
