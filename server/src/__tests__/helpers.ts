import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { normalizeToE164 } from '../lib/phone';
import { selectApplicableReferralVisit } from '../lib/attribution';

export async function createLeader(name: string, email: string, code: string, password = 'password123') {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: 'LEADER', active: true, isTestData: true },
  });
  const referralCode = await prisma.referralCode.create({
    data: { code, leaderId: user.id, active: true, isTestData: true },
  });
  return { user, referralCode };
}

export async function createAdmin(email = 'admin@test.local', password = 'AdminPass123!') {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { name: 'Test Admin', email, passwordHash, role: 'ADMIN', active: true },
  });
}

const DUPLICATE_WHATSAPP_MESSAGE =
  'This WhatsApp number may have already been used to register. If you entered the wrong number, please correct it and try again. If you have not yet been added to the WhatsApp group, please contact us so that we can assist you and add you manually.';

// Test-only stand-in for the now-removed POST /api/registrations route
// (server/src/routes/registrations.ts, deleted when the public join flow
// moved to the 3-screen /register wizard — see memberAuth.ts's
// /signup/{start,check-code,finish}). Many older tests use this purely as a
// fixture to create a Registration (+ linked Person, + referral attribution
// from the visitor's latest ReferralVisit) without exercising the deleted
// HTTP endpoint itself. Faithfully reproduces that route's exact Prisma
// writes and response shape so those tests keep testing what they actually
// care about (attribution, pathway, deletion, exports, …).
export async function createRegistrationFixture(
  visitorId: string,
  data: { name: string; whatsapp: string; language?: 'en' | 'fr'; pathway?: 'TRAINING' | 'DISCOVER_GROW'; email?: string },
): Promise<{ status: number; body: any }> {
  const normalizedWhatsApp = normalizeToE164(data.whatsapp);
  const language = data.language ?? 'en';
  const pathway = data.pathway ?? 'TRAINING';
  if (!normalizedWhatsApp) {
    return { status: 400, body: { error: 'Please enter a valid WhatsApp number, including country code.' } };
  }

  const selectedVisit = await selectApplicableReferralVisit(visitorId);

  try {
    const registration = await prisma.$transaction(async (tx) => {
      const isTestData = selectedVisit?.isTestData ?? false;
      const created = await tx.registration.create({
        data: {
          visitorId,
          normalizedWhatsApp,
          name: data.name,
          email: data.email ?? null,
          language,
          pathway,
          utmSource: selectedVisit?.utmSource ?? null,
          utmMedium: selectedVisit?.utmMedium ?? null,
          utmCampaign: selectedVisit?.utmCampaign ?? null,
          landingPage: selectedVisit?.landingPage ?? null,
          isTestData,
          person: {
            connectOrCreate: {
              where: { whatsappNumber: normalizedWhatsApp },
              create: {
                name: data.name,
                whatsappNumber: normalizedWhatsApp,
                email: data.email ?? null,
                preferredLanguage: language,
                isTestData,
              },
            },
          },
        },
      });

      if (selectedVisit?.referralCode?.leaderId) {
        await tx.referralRelationship.create({
          data: {
            leaderId: selectedVisit.referralCode.leaderId,
            registrationId: created.id,
            referralCodeId: selectedVisit.referralCode.id,
          },
        });
      }

      await tx.event.create({
        data: { type: 'REGISTERED', registrationId: created.id, visitorId, isTestData: created.isTestData },
      });

      return created;
    });

    return {
      status: 201,
      body: {
        registrationId: registration.id,
        language: registration.language,
        pathway: registration.pathway,
        confirmationEmailSent: false,
      },
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 409, body: { error: DUPLICATE_WHATSAPP_MESSAGE, code: 'DUPLICATE_WHATSAPP' } };
    }
    throw err;
  }
}

// Test-only stand-in for the now-removed GET /api/registrations/:id/whatsapp
// redirect, which used to record a WHATSAPP_CLICKED Event before sending the
// visitor on to a configured WhatsApp group. That redirect (and the settings
// fields naming its destinations) no longer exist, but a few older features
// that merely *consume* this historical event (e.g. a Leader's own "has this
// referral joined WhatsApp yet" status) are left as-is for now — this just
// creates the Event row directly so those tests keep exercising that
// consuming code, not the deleted producer.
export async function recordWhatsappClick(registrationId: string, visitorId?: string) {
  const registration = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } });
  return prisma.event.create({
    data: { type: 'WHATSAPP_CLICKED', registrationId, visitorId: visitorId ?? registration.visitorId, isTestData: registration.isTestData },
  });
}

export async function setLeaderSignupPhrase(phrase: string | null) {
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', leaderSignupPhrase: phrase },
    update: { leaderSignupPhrase: phrase },
  });
}

export function extractCookie(res: any, name: string): string | undefined {
  const setCookies: string[] = res.headers['set-cookie'] || [];
  for (const c of setCookies) {
    const match = c.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}
