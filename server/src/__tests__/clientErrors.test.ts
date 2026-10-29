import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// A crashed screen reports itself: only logged, cut short, anyone may send.
const app = createApp();

afterEach(() => vi.restoreAllMocks());

describe('POST /api/client-errors', () => {
  it('logs a crash report, cut to size, without needing a sign-in', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/client-errors')
      .set('X-Forwarded-For', '10.160.0.1')
      .send({ kind: 'render', message: 'x'.repeat(900), stack: 's'.repeat(5000), path: '/member/chats', userAgent: 'iPhone iOS 15', standalone: true });
    expect(res.status).toBe(202);
    const line = log.mock.calls.find((c) => c[0] === '[client-error]');
    expect(line).toBeTruthy();
    const logged = JSON.parse(line![1] as string);
    expect(logged.message).toHaveLength(300);
    expect(logged.stack).toHaveLength(1500);
    expect(logged).toMatchObject({ kind: 'render', path: '/member/chats', userAgent: 'iPhone iOS 15', standalone: true });
  });

  it('accepts a report that a file upload failed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/client-errors').set('X-Forwarded-For', '10.160.0.9').send({ kind: 'upload', message: 'Book PDF upload failed: storage status 403, 4000000 bytes' });
    expect(res.status).toBe(202);
    expect(log.mock.calls.some((c) => c[0] === '[client-error]' && String(c[1]).includes('"kind":"upload"'))).toBe(true);
  });

  it('refuses a report with no message, and has a limit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await request(app).post('/api/client-errors').set('X-Forwarded-For', '10.160.0.2').send({ kind: 'render' })).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (await request(app).post('/api/client-errors').set('X-Forwarded-For', '10.160.0.3').send({ message: 'boom' })).status;
    }
    expect(last).toBe(429);
  });
});
