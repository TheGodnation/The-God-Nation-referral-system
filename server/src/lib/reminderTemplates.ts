import type { ReminderKind } from '@prisma/client';

// The words of the reminder emails, in English and French. Short, kind and
// plain: what to do, one button, and how to ignore or stop them.
type Lang = 'en' | 'fr';

export interface ReminderText {
  subject: string;
  paragraphs: string[];
  buttonLabel: string;
  footer: string;
}

const hi = (name: string | null, lang: Lang) => (name ? (lang === 'fr' ? `Bonjour ${name},` : `Hi ${name},`) : lang === 'fr' ? 'Bonjour,' : 'Hi,');

export function reminderText(kind: ReminderKind, lang: Lang, name: string | null): ReminderText {
  const fr = lang === 'fr';
  const ignore = fr ? 'Si ce n’était pas vous, vous pouvez ignorer cet e-mail.' : 'If this was not you, you can ignore this email.';
  switch (kind) {
    case 'FINISH_SIGNUP_1':
      return fr
        ? {
            subject: 'Terminez votre inscription à The God Nation',
            paragraphs: [hi(null, lang), 'Vous avez commencé à rejoindre The God Nation, mais vous ne vous êtes pas encore connecté.', 'Cela prend une minute : connectez-vous avec l’adresse e-mail et le mot de passe que vous avez choisis, dites-nous votre nom et où vous habitez, et nous vous placerons dans votre groupe.'],
            buttonLabel: 'Terminer mon inscription',
            footer: ignore,
          }
        : {
            subject: 'Finish joining The God Nation',
            paragraphs: [hi(null, lang), 'You started joining The God Nation, but you have not signed in yet.', 'It takes one minute: sign in with the email and password you chose, tell us your name and where you live, and we will place you in your group.'],
            buttonLabel: 'Finish joining',
            footer: ignore,
          };
    case 'FINISH_SIGNUP_2':
      return fr
        ? {
            subject: 'Votre place à The God Nation vous attend',
            paragraphs: [hi(null, lang), 'Nous avons gardé votre place dans la communauté. Il suffit de vous connecter avec l’adresse e-mail et le mot de passe que vous avez choisis.', 'Si vous avez oublié votre mot de passe, la page de connexion vous aide à en choisir un nouveau.'],
            buttonLabel: 'Me connecter',
            footer: ignore,
          }
        : {
            subject: 'Your place at The God Nation is waiting',
            paragraphs: [hi(null, lang), 'We have kept your place in the community. Just sign in with the email and password you chose.', 'If you forgot your password, the sign-in page helps you choose a new one.'],
            buttonLabel: 'Sign in',
            footer: ignore,
          };
    case 'FINISH_PROFILE':
      return fr
        ? {
            subject: 'Une dernière étape : votre nom et votre lieu',
            paragraphs: [hi(null, lang), 'Vous êtes connecté, il ne reste qu’une étape : nous dire votre nom et où vous habitez. Ensuite nous vous plaçons dans votre groupe et vous pouvez commencer.'],
            buttonLabel: 'Terminer mon profil',
            footer: ignore,
          }
        : {
            subject: 'One last step: your name and place',
            paragraphs: [hi(null, lang), 'You are signed in, and there is only one step left: tell us your name and where you live. Then we place you in your group and you can begin.'],
            buttonLabel: 'Finish my profile',
            footer: ignore,
          };
    case 'WINBACK':
      return fr
        ? {
            subject: 'Vous nous manquez à The God Nation',
            paragraphs: [hi(name, lang), 'Cela fait un moment que nous ne vous avons pas vu. Votre communauté est toujours là : de nouveaux messages, votre groupe et la Clinique de la Domination vous attendent.'],
            buttonLabel: 'Revenir',
            footer: 'Vous recevez cet e-mail parce que vous avez accepté de recevoir des nouvelles par e-mail. Pour ne plus en recevoir :',
          }
        : {
            subject: 'We miss you at The God Nation',
            paragraphs: [hi(name, lang), 'It has been a while since we saw you. Your community is still here: new messages, your group and the Dominion Clinic are waiting for you.'],
            buttonLabel: 'Come back',
            footer: 'You get this email because you agreed to receive updates by email. To stop them:',
          };
  }
}
