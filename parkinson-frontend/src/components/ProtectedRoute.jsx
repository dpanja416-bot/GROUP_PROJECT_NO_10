import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED !== "false";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (!AUTH_REQUIRED) return children;
  if (loading) return <div className="auth-loading">Loading...</div>;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}