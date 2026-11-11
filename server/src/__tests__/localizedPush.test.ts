import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

// Phone alerts that name the National Coordinator are written in each reader's own language.
const sent: { kind: string; ids: string[]; payload: any }[] = [];
vi.mock('../lib/push', () => ({
  isPushConfigured: () => true,
  vapidPublicKey: () => 'k',
  pushToPerson: vi.fn(async (id: string, payload: any) => { sent.push({ kind: 'person', ids: [id], payload }); }),
  pushToUser: vi.fn(async (id: string, payload: any) => { sent.push({ kind: 'user', ids: [id], payload }); }),
  pushToPersons: vi.fn(async (ids: string[], payload: any) => { sent.push({ kind: 'persons', ids, payload }); }),
}));

import { prisma } from '../lib/prisma';
import { notifyPrivateMessageReceived, notifyLeadersNotFollowingUp } from '../lib/notifications';
import { pushToPersonsLocalized } from '../lib/pushLocalized';

let n = 0;
const person = (name: string, language: 'en' | 'fr') => prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378900${String(n).padStart(5, '0')}`, preferredLanguage: language } });
beforeEach(() => { sent.length = 0; });

describe('Phone alerts in the reader\'s language', () => {
  it('a message from the National Coordinator says "Coordinateur national" to a French reader and "National Coordinator" to an English one', async () => {
    const admin = await person('Founder', 'en');
    await prisma.user.create({ data: { name: 'Founder', email: `lp-${++n}@test.local`, passwordHash: await bcrypt.hash('GoodPass123!', 4), role: 'ADMIN', personId: admin.id } });
    for (const [language, expected] of [['fr', 'Coordinateur national'], ['en', 'National Coordinator']] as const) {
      const member = await person('Member', language);
      const conversation = await prisma.privateConversation.create({ data: { memberPersonId: member.id, initiatorPersonId: admin.id } });
      sent.length = 0;
      await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: admin.id });
      expect(sent).toHaveLength(1);
      expect(sent[0].payload.title).toBe(`${admin.name} · ${expected}`);
    }
  });

  it('a message from an ordinary person carries no label', async () => {
    const leader = await person('Leader', 'en');
    const member = await person('Member', 'fr');
    const conversation = await prisma.privateConversation.create({ data: { memberPersonId: member.id, initiatorPersonId: leader.id } });
    await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: leader.id });
    expect(sent[0].payload.title).toBe(leader.name);
  });

  it('the same alert goes to English and French readers in their own words, each group once', async () => {
    const en = await person('Anglo', 'en');
    const fr1 = await person('Franco', 'fr');
    const fr2 = await person('Franca', 'fr');
    await pushToPersonsLocalized([en.id, fr1.id, fr2.id], (french) => ({ title: french ? '💬 Coordinateur national' : '💬 National Coordinator', body: 'x' }));
    expect(sent).toHaveLength(2);
    expect(sent.find((s) => s.payload.title === '💬 National Coordinator')?.ids).toEqual([en.id]);
    expect(sent.find((s) => s.payload.title === '💬 Coordinateur national')?.ids.sort()).toEqual([fr1.id, fr2.id].sort());
  });

  it('the alert about leaders who are not following up is in the coordinator\'s language', async () => {
    const french = await person('Fondateur', 'fr');
    await notifyLeadersNotFollowingUp(french.id, 2);
    expect(sent[0].payload).toMatchObject({ title: '⚠️ Responsables qui ne suivent pas', body: '2 responsables n’ont contacté personne depuis une semaine.' });
    const english = await person('Founder', 'en');
    sent.length = 0;
    await notifyLeadersNotFollowingUp(english.id, 1);
    expect(sent[0].payload).toMatchObject({ title: '⚠️ Leaders not following up', body: '1 leader has not contacted anyone for a week.' });
  });
});
