import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson } from '../lib/leadership';
import { addEscalationMessage, createEscalation, escalationViewFor, escalationsAskedBy, escalationsForLeader } from '../lib/escalations';

// A leader's hard questions: ask the leaders of the parent assembly or the
// central admin about one of their people, follow the answer, and — for the
// leaders of a parent assembly — answer the questions sent to them.
const router = Router();
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

const createSchema = z.object({
  aboutPersonId: z.string().min(1),
  question: z.string().trim().min(1).max(4000),
  urgent: z.boolean().default(false),
  to: z.enum(['PARENT', 'CENTRAL']),
});

router.post('/escalations', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Write your question and choose who to ask.' });
  const result = await createEscalation({ askerPersonId: req.leaderPersonId!, ...parsed.data });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ id: result.id, level: result.level, bypassed: result.bypassed });
}));

router.get('/escalations/mine', asyncHandler(async (req, res) => {
  res.json({ items: await escalationsAskedBy(req.leaderPersonId!) });
}));

router.get('/escalations/inbox', asyncHandler(async (req, res) => {
  res.json({ items: await escalationsForLeader(req.leaderPersonId!) });
}));

router.post('/escalations/:id/messages', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Write a message.' });
  const id = String(req.params.id);
  const actor = { kind: 'PERSON' as const, personId: req.leaderPersonId! };
  const result = await addEscalationMessage(id, actor, parsed.data.body);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ item: await escalationViewFor(id, actor) });
}));

export default router;
