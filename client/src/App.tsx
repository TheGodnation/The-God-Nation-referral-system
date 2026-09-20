import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { WelcomePage } from './pages/WelcomePage';
import { RegisterPage } from './pages/RegisterPage';
import { SuccessPage } from './pages/SuccessPage';
import { ProtectedRoute, RequireAuth } from './components/ProtectedRoute';
import { AuthProvider } from './lib/AuthContext';

// The public referral funnel above (Home -> Join -> Register -> Success) is
// what the vast majority of visitors — people tapping a leader's referral
// link — actually use, so it stays in the main bundle for zero extra
// round trips. Everything below is lazy-loaded: Leader and Admin accounts
// are a small fraction of visitors, and the Admin dashboard alone is the
// single largest page in the app. Splitting these out means a referral
// visitor on a slow connection never downloads code for pages they'll
// never see.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const LeaderDashboardPage = lazy(() =>
  import('./pages/LeaderDashboardPage').then((m) => ({ default: m.LeaderDashboardPage })),
);
const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
);
const ChangePasswordPage = lazy(() =>
  import('./pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })),
);
const LeaderSetupPage = lazy(() =>
  import('./pages/LeaderSetupPage').then((m) => ({ default: m.LeaderSetupPage })),
);
const LeaderSignupPage = lazy(() =>
  import('./pages/LeaderSignupPage').then((m) => ({ default: m.LeaderSignupPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);

function RouteFallback() {
  const { t } = useTranslation();
  return <div className="px-4 py-24 text-center text-slate-400">{t('common.loading')}</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/leader/setup" element={<LeaderSetupPage />} />
          <Route path="/leader-signup" element={<LeaderSignupPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/leader/dashboard"
            element={
              <ProtectedRoute role="LEADER">
                <LeaderDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute role="ADMIN">
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
