import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { WelcomePage } from './pages/WelcomePage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute, RequireAuth } from './components/ProtectedRoute';
import { RequireMember } from './components/RequireMember';
import { AuthProvider } from './lib/AuthContext';
import { MemberAuthProvider } from './lib/MemberAuthContext';

// The public referral funnel above (Home -> Join -> Register, the latter a
// 3-screen wizard that signs the visitor straight into the member app) is
// what the vast majority of visitors — people tapping a leader's referral
// link — actually use, so it stays in the main bundle for zero extra
// round trips. Everything below is lazy-loaded: Leader and Admin accounts
// are a small fraction of visitors, and the Admin dashboard alone is the
// single largest page in the app. Splitting these out means a referral
// visitor on a slow connection never downloads code for pages they'll
// never see.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SharePage = lazy(() => import('./pages/SharePage').then((m) => ({ default: m.SharePage })));
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
const ContentPageView = lazy(() =>
  import('./pages/ContentPageView').then((m) => ({ default: m.ContentPageView })),
);
const TeachingsPage = lazy(() =>
  import('./pages/ContentListPage').then((m) => ({ default: () => <m.ContentListPage type="TEACHING" /> })),
);
const AnnouncementsPage = lazy(() =>
  import('./pages/ContentListPage').then((m) => ({ default: () => <m.ContentListPage type="ANNOUNCEMENT" /> })),
);
const ContactPage = lazy(() => import('./pages/ContactPage').then((m) => ({ default: m.ContactPage })));
const MemberLoginPage = lazy(() => import('./pages/MemberLoginPage').then((m) => ({ default: m.MemberLoginPage })));
const MemberLoginConfirmPage = lazy(() =>
  import('./pages/MemberLoginConfirmPage').then((m) => ({ default: m.MemberLoginConfirmPage })),
);
const MemberSignupPage = lazy(() => import('./pages/MemberSignupPage').then((m) => ({ default: m.MemberSignupPage })));
const MemberCompleteProfilePage = lazy(() =>
  import('./pages/MemberCompleteProfilePage').then((m) => ({ default: m.MemberCompleteProfilePage })),
);
const MemberPeoplePage = lazy(() => import('./pages/MemberPeoplePage').then((m) => ({ default: m.MemberPeoplePage })));
const MemberPersonPage = lazy(() => import('./pages/MemberPersonPage').then((m) => ({ default: m.MemberPersonPage })));
const MemberLeadershipPage = lazy(() => import('./pages/MemberLeadershipPage').then((m) => ({ default: m.MemberLeadershipPage })));
const MyLeadershipDashboardPage = lazy(() => import('./pages/MyLeadershipDashboardPage').then((m) => ({ default: m.MyLeadershipDashboardPage })));
const MemberReferralsPage = lazy(() => import('./pages/MemberReferralsPage').then((m) => ({ default: m.MemberReferralsPage })));
const MemberPrayerPage = lazy(() => import('./pages/MemberPrayerPage').then((m) => ({ default: m.MemberPrayerPage })));
const MemberChatsPage = lazy(() => import('./pages/MemberChatsPage').then((m) => ({ default: m.MemberChatsPage })));
const MemberPrivateChatPage = lazy(() => import('./pages/MemberPrivateChatPage').then((m) => ({ default: m.MemberPrivateChatPage })));
const MemberGroupInfoPage = lazy(() => import('./pages/MemberGroupInfoPage').then((m) => ({ default: m.MemberGroupInfoPage })));
const MemberGroupChatPage = lazy(() => import('./pages/MemberGroupChatPage').then((m) => ({ default: m.MemberGroupChatPage })));
const MemberLearnPage = lazy(() => import('./pages/MemberLearnPage').then((m) => ({ default: m.MemberLearnPage })));
const MemberReaderPage = lazy(() => import('./pages/MemberReaderPage').then((m) => ({ default: m.MemberReaderPage })));
const MemberTeachingPage = lazy(() => import('./pages/MemberTeachingPage').then((m) => ({ default: m.MemberTeachingPage })));
const MemberTeachingComposePage = lazy(() => import('./pages/MemberTeachingComposePage').then((m) => ({ default: m.MemberTeachingComposePage })));
const MemberPasswordHelpPage = lazy(() => import('./pages/MemberPasswordHelpPage').then((m) => ({ default: m.MemberPasswordHelpPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const DeleteAccountPage = lazy(() => import('./pages/DeleteAccountPage').then((m) => ({ default: m.DeleteAccountPage })));
const MemberDeleteAccountPage = lazy(() => import('./pages/MemberDeleteAccountPage').then((m) => ({ default: m.MemberDeleteAccountPage })));
const MemberDownloadsPage = lazy(() => import('./pages/MemberDownloadsPage').then((m) => ({ default: m.MemberDownloadsPage })));
const MemberSchoolPage = lazy(() => import('./pages/MemberSchoolPage').then((m) => ({ default: m.MemberSchoolPage })));
const MemberSchoolBookPage = lazy(() => import('./pages/MemberSchoolBookPage').then((m) => ({ default: m.MemberSchoolBookPage })));
const MemberPaymentOrderPage = lazy(() => import('./pages/MemberPaymentOrderPage').then((m) => ({ default: m.MemberPaymentOrderPage })));
const MemberPaymentDeskPage = lazy(() => import('./pages/MemberPaymentDeskPage').then((m) => ({ default: m.MemberPaymentDeskPage })));
const MemberEarningsPage = lazy(() => import('./pages/MemberEarningsPage').then((m) => ({ default: m.MemberEarningsPage })));
const MemberEventsPage = lazy(() => import('./pages/MemberEventsPage').then((m) => ({ default: m.MemberEventsPage })));
const MemberEventPage = lazy(() => import('./pages/MemberEventPage').then((m) => ({ default: m.MemberEventPage })));
const MemberAboutPage = lazy(() => import('./pages/MemberAboutPage').then((m) => ({ default: m.MemberAboutPage })));
const MemberUpdatesPage = lazy(() => import('./pages/MemberUpdatesPage').then((m) => ({ default: m.MemberUpdatesPage })));
const MemberMePage = lazy(() => import('./pages/MemberMePage').then((m) => ({ default: m.MemberMePage })));
const MemberEditProfilePage = lazy(() => import('./pages/MemberEditProfilePage').then((m) => ({ default: m.MemberEditProfilePage })));
const MemberAssessmentPage = lazy(() =>
  import('./pages/MemberAssessmentPage').then((m) => ({ default: m.MemberAssessmentPage })),
);

function RouteFallback() {
  const { t } = useTranslation();
  return <div className="px-4 py-24 text-center text-slate-400">{t('common.loading')}</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <MemberAuthProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/join" element={<JoinPage />} />
            {/* Share-into-app: opened from the phone's Share menu (see public/sw.js). */}
            <Route path="/share" element={<SharePage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/leader/setup" element={<LeaderSetupPage />} />
            <Route path="/leader-signup" element={<LeaderSignupPage />} />
            <Route path="/page/:slug" element={<ContentPageView />} />
            <Route path="/teachings" element={<TeachingsPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/delete-account" element={<DeleteAccountPage />} />
            <Route path="/member/login" element={<MemberLoginPage />} />
            <Route path="/member/login/confirm" element={<MemberLoginConfirmPage />} />
            <Route path="/member/password-help" element={<MemberPasswordHelpPage />} />
            <Route path="/member/join" element={<MemberSignupPage />} />
            <Route
              path="/member/complete-profile"
              element={
                <RequireMember>
                  <MemberCompleteProfilePage />
                </RequireMember>
              }
            />
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
            {/* Member app tabs: Chats · Updates · Learn · People · Me. The old
                dashboard address now opens Chats. */}
            <Route path="/member/dashboard" element={<Navigate to="/member/chats" replace />} />
            <Route
              path="/member/chats"
              element={
                <RequireMember>
                  <MemberChatsPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/chats/private/:conversationId"
              element={
                <RequireMember>
                  <MemberPrivateChatPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/chats/group/:communityId/info"
              element={
                <RequireMember>
                  <MemberGroupInfoPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/chats/group/:communityId/teaching/new"
              element={
                <RequireMember>
                  <MemberTeachingComposePage />
                </RequireMember>
              }
            />
            <Route
              path="/member/teachings/:id"
              element={
                <RequireMember>
                  <MemberTeachingPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/chats/group/:communityId"
              element={
                <RequireMember>
                  <MemberGroupChatPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/me"
              element={
                <RequireMember>
                  <MemberMePage />
                </RequireMember>
              }
            />
            <Route
              path="/member/me/edit"
              element={
                <RequireMember>
                  <MemberEditProfilePage />
                </RequireMember>
              }
            />
            <Route
              path="/member/people"
              element={
                <RequireMember>
                  <MemberPeoplePage />
                </RequireMember>
              }
            />
            <Route
              path="/member/people/:personId"
              element={
                <RequireMember>
                  <MemberPersonPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/leadership"
              element={
                <RequireMember>
                  <MemberLeadershipPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/leadership-dashboard"
              element={
                <RequireMember>
                  <MyLeadershipDashboardPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/referrals"
              element={
                <RequireMember>
                  <MemberReferralsPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/prayer"
              element={
                <RequireMember>
                  <MemberPrayerPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/learn"
              element={
                <RequireMember>
                  <MemberLearnPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/school"
              element={
                <RequireMember>
                  <MemberSchoolPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/school/:bookId"
              element={
                <RequireMember>
                  <MemberSchoolBookPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/delete-account"
              element={
                <RequireMember>
                  <MemberDeleteAccountPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/downloads"
              element={
                <RequireMember>
                  <MemberDownloadsPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/read/:bookId"
              element={
                <RequireMember>
                  <MemberReaderPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/payment-orders/:id"
              element={
                <RequireMember>
                  <MemberPaymentOrderPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/payment-desk"
              element={
                <RequireMember>
                  <MemberPaymentDeskPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/earnings"
              element={
                <RequireMember>
                  <MemberEarningsPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/events"
              element={
                <RequireMember>
                  <MemberEventsPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/events/:id"
              element={
                <RequireMember>
                  <MemberEventPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/about"
              element={
                <RequireMember>
                  <MemberAboutPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/updates"
              element={
                <RequireMember>
                  <MemberUpdatesPage />
                </RequireMember>
              }
            />
            <Route
              path="/member/assessments/:id"
              element={
                <RequireMember>
                  <MemberAssessmentPage />
                </RequireMember>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </MemberAuthProvider>
    </AuthProvider>
  );
}
