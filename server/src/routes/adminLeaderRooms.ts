import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { MAX_MESSAGE_CHARS } from '../lib/textLimits';
import { pushToPersons } from '../lib/push';
import { listLeaders, generationsOf } from '../lib/leaderInstructions';
import {
  ALL_LEADERS_ROOM,
  getLeadershipCollaborationUnreadCount,
  getOrCreateLeadershipCollaborationConversation,
  listRoomMessages,
  markRoomRead,
  postRoomMessage,
} from '../lib/leadershipCollaboration';

// The National Coordinator (the central admin) in the leaders' rooms: one room for every generation of the assembly
// tree and one for all leaders. They read and write there as "National Coordinator", and the leaders of the room are
// told. Offered twice, with the same rules — in the admin dashboard and in the central admin's own member profile.
// Leaders reach the same rooms through their own routes (leaderLeadershipCollaboration.ts).
const generationSchema = z.object({ generation: z.coerce.number().int().min(-1).max(50) });

function buildRoomsRouter(resolvePersonId: (req: Request) => Promise<string | null>) {
  const router = Router();

  // The rooms that exist now: "All leaders", and a room for each generation that has leaders.
  async function roomExists(generation: number) {
    if (generation === ALL_LEADERS_ROOM) return true;
    return generationsOf(await listLeaders()).includes(generation);
  }

  router.get('/', asyncHandler(async (req, res) => {
    const personId = await resolvePersonId(req);
    const leaders = await listLeaders();
    const rooms = [ALL_LEADERS_ROOM, ...generationsOf(leaders)];
    const items = await Promise.all(
      rooms.map(async (generation) => {
        const conversation = await getOrCreateLeadershipCollaborationConversation(generation);
        const last = await prisma.leadershipCollaborationMessage.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        return {
          generation,
          leaders: generation === ALL_LEADERS_ROOM ? leaders.length : leaders.filter((l) => l.generations.includes(generation)).length,
          unreadCount: personId ? await getLeadershipCollaborationUnreadCount(personId, conversation.id) : 0,
          lastMessageAt: last?.createdAt ?? null,
        };
      }),
    );
    res.json({ items, canWrite: Boolean(personId) });
  }));

  router.get('/:generation/messages', asyncHandler(async (req, res) => {
    const g = generationSchema.safeParse(req.params);
    if (!g.success || !(await roomExists(g.data.generation))) return res.status(404).json({ error: 'Room not found.' });
    const q = z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).optional() }).safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid pagination parameters.' });
    const personId = await resolvePersonId(req);
    const result = await listRoomMessages(g.data.generation, personId ?? '', q.data);
    if ('error' in result) return res.status(400).json({ error: result.error });
    res.json(result);
  }));

  router.post('/:generation/messages', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const g = generationSchema.safeParse(req.params);
    if (!g.success || !(await roomExists(g.data.generation))) return res.status(404).json({ error: 'Room not found.' });
    const body = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid message.' });
    const personId = await resolvePersonId(req);
    if (!personId) return res.status(400).json({ error: 'Create your member profile first, to write in the rooms.' });
    const created = await postRoomMessage(g.data.generation, personId, body.data.body);
    // The leaders of the room are told (never the sender).
    const leaders = await listLeaders();
    const recipients = leaders.filter((l) => l.personId !== personId && (g.data.generation === ALL_LEADERS_ROOM || l.generations.includes(g.data.generation))).map((l) => l.personId);
    if (recipients.length > 0) {
      pushToPersons(recipients, {
        title: '💬 National Coordinator',
        body: body.data.body.length > 100 ? `${body.data.body.slice(0, 100)}…` : body.data.body,
        url: '/member/leadership-dashboard?section=together',
      }).catch(() => {});
    }
    res.status(201).json({ id: created.id, createdAt: created.createdAt, notified: recipients.length });
  }));

  router.post('/:generation/read', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const g = generationSchema.safeParse(req.params);
    const body = z.object({ messageId: z.string().min(1) }).safeParse(req.body);
    if (!g.success || !body.success || !(await roomExists(g.data.generation))) return res.status(404).json({ error: 'Room not found.' });
    const personId = await resolvePersonId(req);
    if (!personId) return res.json({ unreadCount: 0 });
    const result = await markRoomRead(g.data.generation, personId, body.data.messageId);
    if (!result) return res.status(400).json({ error: 'Invalid message reference.' });
    res.json(result);
  }));

  return router;
}

export const adminLeaderRoomsRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildRoomsRouter(async (req) => req.user?.personId ?? null));
  return router;
})();

export const memberCentralLeaderRoomsRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(buildRoomsRouter(async (req) => req.member!.personId));
  return router;
})();
