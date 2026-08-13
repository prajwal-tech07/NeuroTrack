import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setAccessToken, setUnauthorizedHandler } from '../api/client.js';
import { useTheme } from './ThemeContext.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const { setTheme } = useTheme();

  const applyUser = useCallback(
    (nextUser) => {
      setUser(nextUser);
      if (nextUser?.settings?.darkMode !== undefined) {
        setTheme(nextUser.settings.darkMode ? 'dark' : 'light');
      }
    },
    [setTheme]
  );

  // Restore the session on first load using the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.refreshSession();
        if (!cancelled) applyUser(data.user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const login = useCallback(
    async (credentials) => {
      const res = await api.post('/auth/login', credentials);
      setAccessToken(res.data.accessToken);
      applyUser(res.data.user);
      return res.data.user;
    },
    [applyUser]
  );

  const register = useCallback(
    async (payload) => {
      const res = await api.post('/auth/register', payload);
      setAccessToken(res.data.accessToken);
      applyUser(res.data.user);
      return res.data.user;
    },
    [applyUser]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* clearing local state is what matters */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  /** Merges a partial user update returned by the profile/settings endpoints. */
  const patchUser = useCallback((partial) => {
    setUser((u) => (u ? { ...u, ...partial } : u));
  }, []);

  const value = useMemo(
    () => ({ user, booting, isAuthenticated: !!user, login, register, logout, patchUser, setUser: applyUser }),
    [user, booting, login, register, logout, patchUser, applyUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
