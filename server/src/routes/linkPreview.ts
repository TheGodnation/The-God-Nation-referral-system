import { Router } from 'express';
import { requireMember } from '../lib/memberAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { linkPreviewLimiter } from '../lib/rateLimit';
import { linkPreview } from '../lib/linkPreview';

// The card shown under a link in a chat or a post. Signed-in members only; the answer is just title, sentence and picture.
export const memberLinkPreviewRoutes = (() => {
  const router = Router();
  router.use(requireMember, linkPreviewLimiter);
  router.get('/', asyncHandler(async (req, res) => {
    const url = String(req.query.url ?? '');
    if (!url) return res.status(400).json({ error: 'A link is needed.' });
    const preview = await linkPreview(url);
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ preview });
  }));
  return router;
})();
