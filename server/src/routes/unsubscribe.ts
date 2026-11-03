import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { generalApiLimiter } from '../lib/rateLimit';
import { readUnsubscribeToken } from '../lib/unsubscribe';
import { currentConsent, recordConsent } from '../lib/contactConsent';
import { escapeAttr } from '../lib/ogMeta';

// GET/POST /api/unsubscribe?t=<token> — the "stop these emails" link in the
// reminder emails. Works without signing in (the token proves whose it is) and
// records the choice like any other, so the member sees it in their profile.
const router = Router();

const PAGE = {
  en: { ok: 'You will no longer receive updates by email from The God Nation.', bad: 'This link is not valid any more.', hint: 'You can change this any time in your profile, under "How we may contact you".', home: 'Go to The God Nation' },
  fr: { ok: 'Vous ne recevrez plus de nouvelles par e-mail de The God Nation.', bad: 'Ce lien n’est plus valide.', hint: 'Vous pouvez changer cela à tout moment dans votre profil, sous « Comment nous pouvons vous contacter ».', home: 'Aller à The God Nation' },
};

async function stop(token: unknown): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const personId = readUnsubscribeToken(token);
  if (!personId) return false;
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, preferredLanguage: true } });
  if (!person) return false;
  if ((await currentConsent(prisma, personId)).email !== false) {
    await recordConsent(prisma, { personId }, 'EMAIL', false, 'unsubscribe-link', person.preferredLanguage === 'fr' ? 'fr' : 'en');
  }
  return true;
}

router.get('/', generalApiLimiter, asyncHandler(async (req, res) => {
  const lang = req.query.lang === 'fr' ? 'fr' : 'en';
  const ok = await stop(req.query.t);
  const p = PAGE[lang];
  res.status(ok ? 200 : 400).set('Content-Type', 'text/html; charset=utf-8').send(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>The God Nation</title></head>` +
      `<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1e293b"><h1 style="font-size:20px;color:#0f2260">The God Nation</h1>` +
      `<p>${escapeAttr(ok ? p.ok : p.bad)}</p>${ok ? `<p style="font-size:14px;color:#64748b">${escapeAttr(p.hint)}</p>` : ''}` +
      `<p><a href="/" style="color:#0f2260">${escapeAttr(p.home)}</a></p></body></html>`,
  );
}));

// The one-click form mail apps use (RFC 8058).
router.post('/', generalApiLimiter, asyncHandler(async (req, res) => {
  res.status((await stop(req.query.t)) ? 200 : 400).json({ ok: true });
}));

export default router;
