import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

// When the database cannot be reached, a page or a file of the app must not fail because of it: the sign-in lookup is only
// for the API. (Before, every request with a sign-in cookie failed with an error, even the app's own scripts.)
const app = createApp();

afterEach(() => vi.restoreAllMocks());

describe('the sign-in lookup is for the API only', () => {
  it('does not read the database for a page or a file, even with a sign-in cookie, and keeps working when the database is down', async () => {
    const admin = vi.spyOn(prisma.session, 'findUnique').mockRejectedValue(new Error("Can't reach database server"));
    const member = vi.spyOn(prisma.memberSession, 'findUnique').mockRejectedValue(new Error("Can't reach database server"));
    const res = await request(app).get('/assets/not-there.js').set('Cookie', 'sid=abc; msid=def');
    expect(res.status).not.toBe(500); // not found (or the start page), but never a database error
    expect(admin).not.toHaveBeenCalled();
    expect(member).not.toHaveBeenCalled();
  });

  it('still looks the person up for the API', async () => {
    const admin = vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);
    const member = vi.spyOn(prisma.memberSession, 'findUnique').mockResolvedValue(null);
    const res = await request(app).get('/api/member/me').set('Cookie', 'sid=abc; msid=def');
    expect(res.status).toBe(401);
    expect(admin).toHaveBeenCalled();
    expect(member).toHaveBeenCalled();
  });
});
