import { prisma } from './prisma';
import { centralAdminPerson } from './trainingWelcome';
import { sendPrivateNotice, isFrench } from './privateNotice';
import { pendingAgreements } from './assemblyAgreement';

// A new member's first steps: the founder's welcome in their private chat (once), and the facts the "Get started"
// checklist shows. No prices, payment or website links here: the Google Play version of the app shows this chat too.

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** The sign-off: the founder's name with the title, in the member's language. */
function signOff(french: boolean, founderName: string): string[] {
  const clean = founderName.trim().replace(/^(evangelist|évangéliste|evangeliste)\s+/i, '');
  return french
    ? [`Évangéliste ${clean}`, 'Coordinateur national, The God Nation']
    : [`Evangelist ${clean}`, 'National Coordinator, The God Nation'];
}

export function founderWelcomeText(french: boolean, memberName: string, founderName: string): string {
  const name = firstName(memberName);
  if (french) {
    return [
      `Bonjour ${name}, bienvenue à The God Nation ! 🙏`,
      '',
      'Nous sommes si heureux que vous soyez là. C’est votre foyer spirituel en ligne : un lieu d’enseignement et de prière, où des frères et sœurs marchent avec vous et s’entraident, et où nous vous donnons les secrets pour dominer les circonstances de la vie.',
      '',
      'Par The God Nation Leadership Academy, vous êtes préparé(e) et formé(e), d’abord spirituellement puis techniquement, pour porter l’évangile du Royaume aux milliards de personnes en ligne à travers les médias modernes.',
      '',
      'Trois petites étapes vous aideront beaucoup :',
      '1. Ouvrez votre tableau de bord et faites-en le tour.',
      '2. Installez l’application sur votre téléphone, pour que nous soyons toujours à un clic.',
      '3. Activez les notifications, pour ne manquer aucun enseignement ni aucune annonce.',
      '',
      'Vous êtes aussi chaleureusement invité(e) à rejoindre notre communauté d’accueil, où vous pourrez rencontrer vos frères et sœurs. C’est votre choix, sans aucune pression.',
      '',
      'Vous pouvez m’écrire ici à tout moment. Que Dieu vous bénisse !',
      '',
      ...signOff(true, founderName),
    ].join('\n');
  }
  return [
    `Hello ${name}, welcome to The God Nation! 🙏`,
    '',
    'We are so glad you are here. This is your spiritual home online: a place for teaching and prayer, where brothers and sisters walk with you and help one another, and where we empower you with the secrets to dominate over the circumstances of life.',
    '',
    'Through The God Nation Leadership Academy, you are prepared and trained, first spiritually and then technically, to carry the gospel of the Kingdom to the billions of people online through modern media.',
    '',
    'Three small steps will help you the most:',
    '1. Open your dashboard and take a look around.',
    '2. Install the app on your phone, so we are always one tap away.',
    '3. Turn on notifications, so you never miss a teaching or an announcement.',
    '',
    'You are also warmly invited to join our welcome community, where you can meet your brothers and sisters. It is your choice, and there is no pressure.',
    '',
    'You can write to me here at any time. God bless you!',
    '',
    ...signOff(false, founderName),
  ].join('\n');
}

/**
 * The founder's welcome in the member's private chat, sent once per person (claimed in MemberOnboarding before it is
 * sent, so two requests at once cannot send two). Skipped for test data, erased or deleting people, the founder
 * themself, and anyone the founder has already written to (a trainee already got the training welcome).
 * Never throws. Returns whether it was sent.
 */
export async function sendFounderWelcome(personId: string): Promise<boolean> {
  try {
    const from = await centralAdminPerson();
    if (!from || from.id === personId) return false;
    const who = await prisma.person.findUnique({
      where: { id: personId },
      select: { name: true, preferredLanguage: true, erasedAt: true, deletionRequestedAt: true, isTestData: true },
    });
    if (!who || who.erasedAt || who.deletionRequestedAt || who.isTestData) return false;

    await prisma.memberOnboarding.upsert({ where: { personId }, create: { personId }, update: {} });
    const claim = await prisma.memberOnboarding.updateMany({
      where: { personId, welcomeMessageSentAt: null },
      data: { welcomeMessageSentAt: new Date() },
    });
    if (claim.count !== 1) return false;

    const alreadyWritten = await prisma.privateMessage.findFirst({
      where: { senderPersonId: from.id, conversation: { OR: [{ memberPersonId: personId }, { initiatorPersonId: personId }] } },
      select: { id: true },
    });
    if (alreadyWritten) return false;

    const sent = await sendPrivateNotice(from.id, personId, founderWelcomeText(isFrench(who.preferredLanguage), who.name, from.name));
    if (!sent) await prisma.memberOnboarding.updateMany({ where: { personId }, data: { welcomeMessageSentAt: null } });
    return sent;
  } catch (err) {
    console.error('[onboarding] welcome not sent', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Stamp the first-ever sign-in (later sign-ins leave it alone). */
export async function markFirstLogin(accountId: string): Promise<void> {
  await prisma.memberAccount.updateMany({ where: { id: accountId, firstLoginAt: null }, data: { firstLoginAt: new Date() } });
}

export interface OnboardingStatus {
  profileDone: boolean;
  notificationsOn: boolean;
  communityTapped: boolean;
  firstTeachingOpened: boolean;
  /** Signed up before the Assembly Agreement started: asked for nothing about community or rules. */
  existingMember: boolean;
  /** The assembly where this person still has to agree to the rules (null when nothing is waiting). */
  agreementCommunityId: string | null;
  dismissed: boolean;
  installed: boolean;
  firstSignInAt: string | null;
}

export async function onboardingStatus(personId: string): Promise<OnboardingStatus> {
  const [person, account, onboarding, push, teaching, registration, settings, pending] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { profileCompletedAt: true } }),
    prisma.memberAccount.findUnique({ where: { personId }, select: { firstLoginAt: true, createdAt: true } }),
    prisma.memberOnboarding.findUnique({ where: { personId }, select: { dismissedAt: true, installedAt: true } }),
    prisma.pushSubscription.count({ where: { personId } }),
    prisma.teachingProgress.count({ where: { personId } }),
    prisma.registration.findFirst({ where: { personId }, select: { id: true } }),
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { assemblyAgreementFrom: true } }),
    pendingAgreements(personId),
  ]);
  const taps = registration ? await prisma.event.count({ where: { type: 'GROUP_LINK_CLICKED', registrationId: registration.id } }) : 0;
  const existing = !!(settings?.assemblyAgreementFrom && account && account.createdAt < settings.assemblyAgreementFrom);
  return {
    profileDone: !!person?.profileCompletedAt,
    notificationsOn: push > 0,
    communityTapped: taps > 0,
    firstTeachingOpened: teaching > 0,
    existingMember: existing,
    agreementCommunityId: pending[0]?.communityId ?? null,
    dismissed: !!onboarding?.dismissedAt,
    installed: !!onboarding?.installedAt,
    firstSignInAt: account?.firstLoginAt ? account.firstLoginAt.toISOString() : null,
  };
}
