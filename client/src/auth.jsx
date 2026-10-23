import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, initCsrf, apiPost } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState({ configured: false, paymentMode: 'test' });

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await initCsrf();
      await refresh();
      try {
        const s = await api('/api/auth/status');
        setAuthStatus(s);
      } catch {
        /* เงียบไว้ */
      }
    })();
    const onAuth = (e) => setUser(e.detail?.user ?? null);
    window.addEventListener('auth:changed', onAuth);
    return () => window.removeEventListener('auth:changed', onAuth);
  }, [refresh]);

  const loginWithGoogle = useCallback(() => {
    window.location.href = '/api/auth/google';
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      setUser(null);
      await initCsrf();
      window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, refresh, logout, loginWithGoogle, authStatus }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ต้องอยู่ภายใน AuthProvider');
  return ctx;
}
