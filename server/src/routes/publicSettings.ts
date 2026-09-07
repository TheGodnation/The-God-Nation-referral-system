import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/settings/public — read-only, unauthenticated. Everything here is
// meant to be publicly visible (support contact, social links, editable
// homepage copy). WhatsApp destination URLs themselves are intentionally
// NOT exposed here — the server chooses and redirects to them itself
// (section 21); a client never needs or gets to see the raw URLs.
router.get('/public', async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  res.json({
    supportWhatsappUrl: settings?.supportWhatsappUrl ?? null,
    facebookUrl: settings?.facebookUrl ?? null,
    instagramUrl: settings?.instagramUrl ?? null,
    tiktokUrl: settings?.tiktokUrl ?? null,
    youtubeUrl: settings?.youtubeUrl ?? null,
    content: (settings?.content as Record<string, string> | null) ?? {},
  });
});

export default router;
