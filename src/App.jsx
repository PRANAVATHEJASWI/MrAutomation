import { useEffect } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./components/navbar/Navbar";
import LandingPage from "./components/LandingPage";
import Sidebar from "./components/Sidebar";
import TestList from "./components/TestList";
import RequestEditor from "./components/RequestEditor";
import ResponseViewer from "./components/ResponseViewer";
import Report from "./components/Report";
import Toaster from "./components/ui/toast/Toaster";
import ConfirmHost from "./components/ui/confirm/ConfirmHost";
import ChatBot from "./components/ChatBot";
import FeedbackWidget from "./components/FeedbackWidget";
import AuthPage from "./components/AuthPage";
import ProfilePage from "./components/ProfilePage";
import PerformancePage from "./components/PerformancePage";
import MockServerPage from "./components/MockServerPage";
import { useModules } from "./context/CollectionContext";
import { useAuth } from "./context/AuthContext";
import styles from "./App.module.css";

function ModuleLayout() {
  return (
    <div className={styles.appGrid}>
      <Sidebar />
      <div className={styles.mainArea}>
        <div className={styles.leftPane}>
          <TestList />
        </div>
        <div className={styles.rightPane}>
          <RequestEditor />
          <ResponseViewer />
        </div>
      </div>
    </div>
  );
}

function AuthCallback() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/", { replace: true });
  }, [loading, isAuthenticated, navigate]);
  return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
      Signing you in…
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const { dispatch } = useModules();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    // Sync URL -> selected module
    const m = location.pathname.match(/^\/module\/[^\/]+\/(\d+)$/);
    if (m) {
      const id = m[1];
      dispatch({ type: "SELECT_MODULE", id });
    } else if (location.pathname === "/") {
      dispatch({ type: "SELECT_MODULE", id: null });
    }
  }, [location.pathname, isAuthenticated]);

  // While verifying an existing token, show a minimal placeholder.
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  // Allow the OAuth callback route to render even without a hydrated user yet.
  if (!isAuthenticated && location.pathname !== "/auth/callback") {
    return (
      <>
        <AuthPage />
        <Toaster />
      </>
    );
  }

  return (
    <div>
      <Navbar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/module/:slug/:id" element={<ModuleLayout />} />
        <Route path="/report" element={<Report />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/mocks" element={<MockServerPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
      <Toaster />
      <ConfirmHost />
      <ChatBot />
      <FeedbackWidget />
    </div>
  );
}
