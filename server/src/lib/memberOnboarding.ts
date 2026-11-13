import { prisma } from './prisma';
import { centralAdminPerson } from './trainingWelcome';
import { sendPrivateNotice, isFrench } from './privateNotice';
import { pendingAgreements } from './assemblyAgreement';
import { CLIENT_URL } from './env';

// A new member's first steps: the founder's welcome in their private chat (once), and the facts the "Get started"
// checklist shows. No prices or payment links here (the Google Play version of the app shows this chat too); the
// message does carry the ministry's own address and its community places, so a new member always has a way back.

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** The sign-off: the founder's name with the title, in the member's language. */
function signOff(french: boolean, founderName: string): string[] {
  const clean = founderName.trim().replace(/^(evangelist|évangéliste|evangeliste)\s+/i, '');
  return french
    ? [`Évangéliste ${clean}`, 'Coordinateur national, The God Nation']
    : [`Evangelist ${clean}`, 'National Coordinator, The God Nation'];
}

/** The ministry's own address, and the places people can join (any that are not set are left out). */
export interface WelcomeLinks {
  appUrl: string;
  whatsappEn?: string | null;
  whatsappFr?: string | null;
  messenger?: string | null;
  facebookGroup?: string | null;
  facebook?: string | null;
}

/** The "other places" lines, the member's own language first. */
function placeLines(french: boolean, links: WelcomeLinks): string[] {
  const wa = {
    en: links.whatsappEn ? `• ${french ? 'Groupe WhatsApp (anglais)' : 'WhatsApp group (English)'} : ${links.whatsappEn}` : null,
    fr: links.whatsappFr ? `• ${french ? 'Groupe WhatsApp (français)' : 'WhatsApp group (French)'} : ${links.whatsappFr}` : null,
  };
  return [
    ...(french ? [wa.fr, wa.en] : [wa.en, wa.fr]),
    links.messenger ? `• ${french ? 'Groupe Messenger' : 'Messenger group'} : ${links.messenger}` : null,
    links.facebookGroup ? `• ${french ? 'Groupe Facebook' : 'Facebook group'} : ${links.facebookGroup}` : null,
    links.facebook ? `• ${french ? 'Page Facebook' : 'Facebook page'} : ${links.facebook}` : null,
  ]
    .filter((l): l is string => !!l)
    .map((l) => l.replace(' : ', french ? ' : ' : ': '));
}

export function founderWelcomeText(french: boolean, memberName: string, founderName: string, links: WelcomeLinks = { appUrl: CLIENT_URL }): string {
  const name = firstName(memberName);
  const places = placeLines(french, links);
  const app = links.appUrl.replace(/\/+$/, '');
  if (french) {
    return [
      `Bonjour ${name}, bienvenue à The God Nation ! 🙏`,
      '',
      'Nous sommes si heureux que vous soyez là. C’est votre foyer spirituel en ligne : un lieu d’enseignement et de prière, où des frères et sœurs marchent avec vous et s’entraident, et où nous vous donnons les secrets pour dominer les circonstances de la vie.',
      '',
      'Par The God Nation Leadership Academy, vous êtes préparé(e) et formé(e), d’abord spirituellement puis techniquement, pour porter l’évangile du Royaume aux milliards de personnes en ligne à travers les médias modernes.',
      '',
      'Il y a deux façons de revenir à la communauté, à tout moment :',
      '',
      `1. L’adresse web. Ouvrez ${app} dans n’importe quel navigateur, sur votre téléphone ou votre ordinateur, et vous vous retrouvez dans la communauté. Si on vous demande de vous connecter, utilisez votre e-mail et votre mot de passe.`,
      '',
      '2. L’application sur votre téléphone. Installez-la pour que nous soyons toujours à un clic, et activez les notifications pour être prévenu(e) dès qu’il se passe quelque chose : enseignements, annonces et messages de vos frères et sœurs. Sans cela, vous ne voyez les messages que si vous pensez à ouvrir le site.',
      `Activez les notifications et installez l’application ici (un clic, avec les étapes) : ${app}/member/welcome`,
      '',
      'Votre assemblée : ouvrez « Discussions », puis votre assemblée, pour tout lire. Pour écrire et répondre, vous acceptez d’abord ses règles (un clic).',
      ...(places.length ? ['', 'Si vous le souhaitez, rejoignez-nous aussi ailleurs (c’est votre choix, sans aucune pression) :', ...places] : []),
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
    'There are two ways to come back to the community at any time:',
    '',
    `1. The web address. Open ${app} in any browser, on your phone or your computer, and you will find yourself inside the community. If it asks you to sign in, use your email and password.`,
    '',
    '2. The app on your phone. Install it so we are always one tap away, and turn on notifications so you are told as soon as something happens: teachings, announcements and messages from your brothers and sisters. Without them, you only see messages when you remember to open the website.',
    `Turn on notifications and install the app here (one tap, with the steps): ${app}/member/welcome`,
    '',
    'Your assembly: open “Chats”, then your assembly, to read everything. To write and reply, you first agree to its rules (one tap).',
    ...(places.length ? ['', 'If you wish, join us in other places too (your choice, no pressure):', ...places] : []),
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

    const settings = await prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { whatsappGroupEnUrl: true, whatsappGroupFrUrl: true, messengerUrl: true, facebookGroupUrl: true, facebookUrl: true },
    });
    const links: WelcomeLinks = {
      appUrl: CLIENT_URL,
      whatsappEn: settings?.whatsappGroupEnUrl,
      whatsappFr: settings?.whatsappGroupFrUrl,
      messenger: settings?.messengerUrl,
      facebookGroup: settings?.facebookGroupUrl,
      facebook: settings?.facebookUrl,
    };
    const sent = await sendPrivateNotice(from.id, personId, founderWelcomeText(isFrench(who.preferredLanguage), who.name, from.name, links));
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
  /** The member said, themselves, that they joined (a tap on a link alone is never counted as joining). */
  communityConfirmed: boolean;
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
    prisma.memberOnboarding.findUnique({ where: { personId }, select: { dismissedAt: true, installedAt: true, communityConfirmedAt: true } }),
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
    communityConfirmed: !!onboarding?.communityConfirmedAt,
    firstTeachingOpened: teaching > 0,
    existingMember: existing,
    agreementCommunityId: pending[0]?.communityId ?? null,
    dismissed: !!onboarding?.dismissedAt,
    installed: !!onboarding?.installedAt,
    firstSignInAt: account?.firstLoginAt ? account.firstLoginAt.toISOString() : null,
  };
}
