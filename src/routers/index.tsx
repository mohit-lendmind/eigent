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

import { proxyFetchPost } from '@/api/http';
import { isDesktop } from '@/client/platform';
import { getAionBackendState } from '@/store/aionChatBridge';
import { useAuthStore } from '@/store/authStore';
import { lazy, useEffect, useReducer } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import Layout from '@/components/Layout';
// Lazy load page components
const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/SignUp'));
const Workspace = lazy(() => import('@/pages/Workspace'));
const History = lazy(() => import('@/pages/History'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const RemoteControl = lazy(() => import('@/pages/RemoteControl'));
const IntegrationLab = lazy(() => import('@/pages/IntegrationLab'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));

const IS_LOCAL_MODE = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
const ENABLE_DESKTOP_REMOTE_CONTROL_FALLBACK = isDesktop();

interface AuthState {
  loading: boolean;
  isAuthenticated: boolean;
  initialized: boolean;
  /** Aion mode with a configured endpoint and no credential stored yet. */
  needsOnboarding: boolean;
}

type AuthAction =
  | {
      type: 'INITIALIZE';
      payload: { isAuthenticated: boolean; needsOnboarding?: boolean };
    }
  | { type: 'LOGOUT' };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        loading: false,
        isAuthenticated: action.payload.isAuthenticated,
        initialized: true,
        needsOnboarding: action.payload.needsOnboarding === true,
      };
    case 'LOGOUT':
      return {
        loading: false,
        isAuthenticated: false,
        initialized: true,
        needsOnboarding: false,
      };
    default:
      return state;
  }
};

// Route guard: Check if user is logged in
const ProtectedRoute = () => {
  const location = useLocation();
  const [state, dispatch] = useReducer(authReducer, {
    loading: false,
    isAuthenticated: false,
    initialized: false,
    needsOnboarding: false,
  });

  const {
    token,
    localProxyValue,
    logout,
    setAuth,
    setLocalProxyValue,
    setInitState,
    setIsFirstLaunch,
    setModelType,
  } = useAuthStore();
  useEffect(() => {
    // Check VITE_USE_LOCAL_PROXY value on app startup
    if (token) {
      const currentProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
      const storedProxyValue = localProxyValue;

      // If stored value exists and differs from current, logout
      if (storedProxyValue !== null && storedProxyValue !== currentProxyValue) {
        console.warn('VITE_USE_LOCAL_PROXY value changed, logging out user');
        logout();
        dispatch({ type: 'LOGOUT' });
        return;
      }
    }

    let cancelled = false;

    const legacyInitialize = () => {
      if (cancelled) return;
      // Local mode: auto-login when no token
      if (IS_LOCAL_MODE && !token) {
        proxyFetchPost('/api/v1/user/auto-login', {})
          .then((data) => {
            if (cancelled) return;
            if (data && data.token) {
              setAuth({ email: data.email, ...data });
              setLocalProxyValue(import.meta.env.VITE_USE_LOCAL_PROXY || null);
              setModelType('custom');
              setInitState('done');
              setIsFirstLaunch(false);
              dispatch({
                type: 'INITIALIZE',
                payload: { isAuthenticated: true },
              });
            } else {
              dispatch({
                type: 'INITIALIZE',
                payload: { isAuthenticated: false },
              });
            }
          })
          .catch(() => {
            if (cancelled) return;
            dispatch({
              type: 'INITIALIZE',
              payload: { isAuthenticated: false },
            });
          });
        return;
      }

      dispatch({ type: 'INITIALIZE', payload: { isAuthenticated: !!token } });
    };

    if (!token) {
      // Remote-backend mode: the desktop's credential is the edge API key
      // the main process resolved; there is no local brain to auto-login
      // against and no cloud session to require. A configured endpoint that
      // holds no key yet routes to onboarding instead — that is the one aion
      // state a user can resolve, and the legacy login wall cannot resolve it.
      // Anything else still falls through to that wall, which makes a genuine
      // misconfiguration visible.
      getAionBackendState()
        .then((backend) => {
          if (cancelled) return;
          if (backend.kind === 'ready') {
            setInitState('done');
            setIsFirstLaunch(false);
            dispatch({
              type: 'INITIALIZE',
              payload: { isAuthenticated: true },
            });
          } else if (backend.kind === 'needs-key') {
            dispatch({
              type: 'INITIALIZE',
              payload: { isAuthenticated: false, needsOnboarding: true },
            });
          } else {
            legacyInitialize();
          }
        })
        .catch(legacyInitialize);
    } else {
      legacyInitialize();
    }

    return () => {
      cancelled = true;
    };
  }, [
    token,
    localProxyValue,
    logout,
    setAuth,
    setLocalProxyValue,
    setInitState,
    setIsFirstLaunch,
    setModelType,
  ]);

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
  if (state.needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  const redirect = `${location.pathname}${location.search}`;
  return (
    <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  );
};

// Main route configuration
const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    {ENABLE_DESKTOP_REMOTE_CONTROL_FALLBACK ? (
      <Route path="/remote-control/:sessionId" element={<RemoteControl />} />
    ) : null}
    {/* Outside ProtectedRoute: the guard's auto-login talks to the legacy
        local brain, absent in remote-backend mode. The page gates itself on
        the resolved aion transport mode. */}
    <Route path="/integration-lab" element={<IntegrationLab />} />
    {/* Also outside the guard, and for the same reason from the other side:
        this is the screen that produces the credential the guard checks. */}
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
