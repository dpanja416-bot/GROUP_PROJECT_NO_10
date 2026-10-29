import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getToken, clearToken } from "../services/api";
import { getMe, loginUser, logoutUser } from "../services/authService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  // Restore the session after a page refresh
  useEffect(() => {
    if (!getToken()) return;
    getMe()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  // api.js fires this when the server answers 401
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  const login = useCallback(async (credentials) => {
    await loginUser(credentials);
    const me = await getMe();
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    logoutUser();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, isAuthenticated: Boolean(user) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}