import { prisma } from './prisma';
import { CLIENT_URL } from './env';
import { EmailService } from './email';
import { sendPrivateNotice, isFrench } from './privateNotice';

// When someone starts the Leadership School:
//  - a welcome in their private chat from the central admin's own member profile (the founder, by name). It says
//    nothing about prices, payment or the website, because the Google Play version of the app shows this chat too and
//    must not steer anyone to a payment outside Google Play;
//  - for someone the central admin approved (the Play Store app asks, the admin approves), an EMAIL that says to
//    continue on the website, signed in with the same email. Email and WhatsApp are outside the app.

/** The central admin's own member profile: the person the welcome and the admin's messages come from. */
export async function centralAdminPerson(): Promise<{ id: string; name: string } | null> {
  const user = await prisma.user.findFirst({
    where: { role: 'ADMIN', active: true, personId: { not: null }, person: { erasedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: { person: { select: { id: true, name: true } } },
  });
  return user?.person ?? null;
}

export function welcomeText(french: boolean, signature: string): string {
  if (french) {
    return [
      'Bienvenue à l’École de leadership 🙏',
      'Salutations de The God Nation. Votre formation a commencé, et le Livre 1 est ouvert pour vous.',
      '1. Lisez le livre à votre rythme.',
      '2. Passez son examen quand vous êtes prêt(e). La note de réussite est de 70 %.',
      '3. Quand vous réussissez, le livre suivant s’ouvre pour vous. La page de l’École de leadership indique ce qu’il faut.',
      '',
      'Votre responsable marchera avec vous et vous suivra. Vous pouvez m’écrire ici à tout moment.',
      signature,
    ].join('\n');
  }
  return [
    'Welcome to the Leadership School 🙏',
    'Greetings from The God Nation. Your training has started, and Book 1 is open for you.',
    '1. Read the book at your own pace.',
    '2. Take its exam when you are ready. The pass mark is 70%.',
    '3. When you pass, the next book opens for you. The Leadership School page shows what is needed.',
    '',
    'Your leader will walk with you and follow you up. You can write to me here at any time.',
    signature,
  ].join('\n');
}

/** The welcome in the person's chat, from the founder's profile. Never throws; false when it could not be sent. */
export async function sendTrainingWelcome(personId: string): Promise<boolean> {
  const from = await centralAdminPerson();
  if (!from) return false;
  const who = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true, erasedAt: true } });
  if (!who || who.erasedAt) return false;
  return sendPrivateNotice(from.id, personId, welcomeText(isFrench(who.preferredLanguage), `— ${from.name}`));
}

/** The website page that opens the Leadership School (after signing in with the same account). */
export const websiteSchoolUrl = (french = false): string => `${CLIENT_URL.replace(/\/+$/, '')}/member/school${french ? '?lang=fr' : ''}`;

export function continueEmailText(french: boolean, name: string) {
  const first = name.trim().split(/\s+/)[0] || name;
  return french
    ? {
        subject: 'Votre demande à l’École de leadership est approuvée',
        paragraphs: [
          `Bonjour ${first},`,
          'Votre demande pour commencer l’École de leadership de The God Nation est approuvée.',
          'Pour continuer, ouvrez notre site dans le navigateur de votre téléphone, connectez-vous avec la même adresse e-mail que dans l’application, puis ouvrez l’École de leadership.',
        ],
        buttonLabel: 'Ouvrir l’École de leadership',
        footer: 'Vous recevez ce message parce que vous avez demandé à commencer l’École de leadership.',
      }
    : {
        subject: 'Your Leadership School request is approved',
        paragraphs: [
          `Hello ${first},`,
          'Your request to start the Leadership School at The God Nation is approved.',
          'To continue, open our website in your phone’s browser, sign in with the same email you use in the app, and open the Leadership School.',
        ],
        buttonLabel: 'Open the Leadership School',
        footer: 'You are receiving this because you asked to start the Leadership School.',
      };
}

export type InviteResult = 'sent' | 'no-email' | 'failed' | 'not-configured';

/** Emails one approved person the "continue on the website" message, and notes it was sent. */
export async function sendContinueEmail(personId: string): Promise<InviteResult> {
  const account = await prisma.memberAccount.findUnique({ where: { personId }, select: { email: true, person: { select: { name: true, preferredLanguage: true, erasedAt: true } } } });
  if (!account || account.person.erasedAt) return 'no-email';
  const french = isFrench(account.person.preferredLanguage);
  const text = continueEmailText(french, account.person.name);
  const result = await EmailService.sendReminder({ to: account.email, subject: text.subject, paragraphs: text.paragraphs, buttonLabel: text.buttonLabel, buttonUrl: websiteSchoolUrl(french), footer: text.footer });
  if (!result.ok) return result.skipped ? 'not-configured' : 'failed';
  await prisma.trainingEnrollment.updateMany({ where: { personId }, data: { websiteInvitedAt: new Date() } });
  return 'sent';
}

/** People the central admin approved who have not yet been emailed the website link. */
const waitingWhere = { status: 'ACTIVE' as const, activatedByUserId: { not: null }, websiteInvitedAt: null, person: { erasedAt: null, memberAccount: { isNot: null } } };

export async function websiteInvitesWaiting(): Promise<number> {
  return prisma.trainingEnrollment.count({ where: waitingWhere });
}

/** Emails the next `limit` approved people (oldest first). Stops early when email is not set up. */
export async function sendWebsiteInvites(limit = 100): Promise<{ sent: number; failed: number; remaining: number; notConfigured: boolean }> {
  const rows = await prisma.trainingEnrollment.findMany({ where: waitingWhere, orderBy: { activatedAt: 'asc' }, take: Math.max(1, Math.min(limit, 200)), select: { personId: true } });
  let sent = 0;
  let failed = 0;
  let notConfigured = false;
  for (const r of rows) {
    const res = await sendContinueEmail(r.personId);
    if (res === 'sent') sent += 1;
    else if (res === 'not-configured') {
      notConfigured = true;
      break;
    } else failed += 1;
  }
  return { sent, failed, remaining: await websiteInvitesWaiting(), notConfigured };
}
