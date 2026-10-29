import { Router } from 'express';
import { z } from 'zod';
import { clientErrorLimiter } from '../lib/rateLimit';

// POST /api/client-errors — the app tells the server when a screen crashed
// ("Something went wrong"), so the cause shows up in the server log instead
// of staying on one person's phone. Nothing is stored: it is only logged,
// cut to a small size, with no names, numbers or cookies. Anyone may send it
// (a crashed screen may be a signed-out one), so it is rate-limited.
const router = Router();

const clip = (n: number) => z.string().max(n * 4).transform((s) => s.slice(0, n));
const bodySchema = z.object({
  kind: z.enum(['render', 'script', 'chunk']).default('render'),
  message: clip(300),
  stack: clip(1500).optional(),
  componentStack: clip(800).optional(),
  path: clip(200).optional(),
  userAgent: clip(250).optional(),
  language: clip(20).optional(),
  standalone: z.boolean().optional(),
});

router.post('/', clientErrorLimiter, (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid report.' });
  console.error('[client-error]', JSON.stringify(parsed.data));
  res.status(202).json({ ok: true });
});

export default router;
