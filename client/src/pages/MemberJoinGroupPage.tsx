import { PageShell } from '../components/PageShell';
import { OnboardingPage } from '../components/member/OnboardingChecklist';

// The step right after the details form: a short welcome checklist (notifications, install, the welcome community,
// the first teaching). It always appears, even when no community links are set up, and every step is optional.
export function MemberJoinGroupPage() {
  return (
    <PageShell minimal>
      <OnboardingPage />
    </PageShell>
  );
}
