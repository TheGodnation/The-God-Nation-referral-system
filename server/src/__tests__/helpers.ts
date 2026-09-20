import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

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

export async function setWhatsAppSettings(
  en: string,
  fr: string,
  discoverEn?: string,
  discoverFr?: string,
) {
  const data = {
    whatsappUrlEn: en,
    whatsappUrlFr: fr,
    ...(discoverEn !== undefined ? { whatsappUrlDiscoverEn: discoverEn } : {}),
    ...(discoverFr !== undefined ? { whatsappUrlDiscoverFr: discoverFr } : {}),
  };
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
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
