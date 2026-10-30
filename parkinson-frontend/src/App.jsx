import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./dashboard";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ECGBackground from "./components/ECGBackground";
import "./index.css";
import "./dashboard.css";

export default function App() {
  return (
    <>
      <ECGBackground />

      <div className="app-content">
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}
