import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { databaseReached, reachDatabaseOnce, resetHealthForTests } from '../lib/health';

// Render's health check (Health Check Path: /api/health). During a release the old version keeps serving members
// until the new one answers 200, so a new version is healthy only once it has reached the database. After that the
// check never queries the database again (it must not keep it awake, nor restart the server over a short drop).

afterEach(() => {
  vi.restoreAllMocks();
  resetHealthForTests();
});

describe('Health check', () => {
  it('answers 200 once the database has been reached, and does not query it again after that', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(databaseReached()).toBe(true);

    const query = vi.spyOn(prisma, '$queryRaw');
    for (let i = 0; i < 3; i++) expect((await request(app).get('/api/health')).status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });

  it('answers 503 while the database has never answered, then 200 as soon as it does', async () => {
    const app = createApp();
    const query = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error("Can't reach database server"));
    const down = await request(app).get('/api/health');
    expect(down.status).toBe(503);
    expect(down.body.ok).toBe(false);
    query.mockRestore();
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('gives up waiting after the time limit when the database hangs', async () => {
    vi.spyOn(prisma, '$queryRaw').mockReturnValueOnce(new Promise(() => {}) as never);
    expect(await reachDatabaseOnce(50)).toBe(false);
    expect(databaseReached()).toBe(false);
  });
});
