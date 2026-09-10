import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';
import * as emailModule from '../lib/email';

const app = createApp();

async function loginAsAdmin(agent: ReturnType<typeof request.agent>, email: string, password: string) {
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return csrf;
}

async function registerVisitor(overrides: { whatsapp: string; email?: string; name?: string }) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  const res = await agent
    .post('/api/registrations')
    .set('X-CSRF-Token', csrf)
    .send({
      name: overrides.name ?? 'Reminder Test',
      whatsapp: overrides.whatsapp,
      language: 'en',
      pathway: 'TRAINING',
      ...(overrides.email ? { email: overrides.email } : {}),
    });
  return res.body.registrationId as string;
}

describe('Acceptance Test — WhatsApp join reminders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts and emails only registrants with an email who have not clicked the join link', async () => {
    vi.spyOn(emailModule.EmailService, 'sendRegistrationConfirmation').mockResolvedValue({ ok: true });
    const reminderSpy = vi.spyOn(emailModule.EmailService, 'sendWhatsAppReminder').mockResolvedValue({ ok: true });

    await createAdmin('admin-reminders@test.local', 'AdminPass123!');
    // Needed so the "already clicked" fixture below can actually redirect
    // (and thus record its click) instead of failing with "not configured".
    await setWhatsAppSettings('https://wa.example/en', 'https://wa.example/fr');

    // Qualifies: has an email, never clicked.
    const qualifies = await registerVisitor({ whatsapp: '+237670004001', email: 'qualifies@example.com' });

    // Does not qualify: no email at all.
    await registerVisitor({ whatsapp: '+237670004002' });

    // Does not qualify: has an email but already clicked the join link.
    const alreadyClicked = await registerVisitor({ whatsapp: '+237670004003', email: 'clicked@example.com' });
    await request(app).get(`/api/registrations/${alreadyClicked}/whatsapp`); // records a WHATSAPP_CLICKED event

    // Does not qualify by default: test data.
    await prisma.registration.create({
      data: {
        visitorId: 'test-visitor-reminder',
        normalizedWhatsApp: '+237670004004',
        name: 'Test Data Reg',
        email: 'testdata@example.com',
        language: 'en',
        pathway: 'TRAINING',
        isTestData: true,
      },
    });

    const admin = request.agent(app);
    const csrf = await loginAsAdmin(admin, 'admin-reminders@test.local', 'AdminPass123!');

    const countRes = await admin.get('/api/admin/whatsapp-reminders/count');
    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(1);

    const countWithTestData = await admin.get('/api/admin/whatsapp-reminders/count?includeTestData=true');
    expect(countWithTestData.body.count).toBe(2);

    const sendRes = await admin.post('/api/admin/whatsapp-reminders/send').set('X-CSRF-Token', csrf);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body).toEqual({ attempted: 1, sent: 1, failed: 0 });
    expect(reminderSpy).toHaveBeenCalledTimes(1);
    expect(reminderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'qualifies@example.com',
        language: 'en',
        link: expect.stringContaining(`/api/registrations/${qualifies}/whatsapp`),
      }),
    );

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'WHATSAPP_REMINDER_BULK_SENT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.metadata).toEqual({ attempted: 1, sent: 1, failed: 0 });
  });

  it('requires Admin authentication', async () => {
    const res = await request(app).get('/api/admin/whatsapp-reminders/count');
    expect(res.status).toBe(401);
  });
});
