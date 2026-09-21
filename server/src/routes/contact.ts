import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { contactFormLimiter } from '../lib/rateLimit';
import { EmailService } from '../lib/email';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(1).max(5000),
  language: z.enum(['en', 'fr']),
  // Honeypot: a hidden field a real visitor never sees or fills in. Any
  // non-empty value here means the submission came from a bot — the form
  // still reports success (never tips off the bot) but the message is
  // silently dropped: no DB row, no email, no server secret exposed.
  website: z.string().max(200).optional().or(z.literal('')),
});

// POST /api/contact — public, unauthenticated. The notification recipient
// always comes from trusted server-side configuration (Settings.contactEmail)
// — never from the request body — so there is no way for a submission to
// redirect where the message is sent.
router.post('/', contactFormLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check your name, email, and message.' });
  }
  const { name, email, message, language, website } = parsed.data;

  if (website) {
    // Spam bot tripped the honeypot — report success without doing anything.
    return res.status(201).json({ ok: true });
  }

  const saved = await prisma.contactMessage.create({
    data: { name, email, message, language },
  });

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  const recipient = settings?.contactEmail;
  if (recipient) {
    const result = await EmailService.sendContactMessage({ to: recipient, name, email, message, language });
    if (result.ok) {
      await prisma.contactMessage.update({ where: { id: saved.id }, data: { emailSentAt: new Date() } });
    }
  }

  res.status(201).json({ ok: true });
}));

export default router;
