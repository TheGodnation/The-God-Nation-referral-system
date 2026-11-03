import { describe, it, expect, vi } from 'vitest';
import { isTransientConnectionError, isUnreachableError, retryTransient } from '../lib/prisma';

// The database (a free plan that sleeps when idle) sometimes closes a pooled connection or is
// briefly unreachable while it wakes. Those are retried; real errors are never retried.
describe('Database reconnect', () => {
  it('recognises a closed connection and an unreachable database, and nothing else', () => {
    expect(isTransientConnectionError(new Error('Error in PostgreSQL connection: Error { kind: Closed, cause: None }'))).toBe(true);
    expect(isUnreachableError(Object.assign(new Error('x'), { code: 'P1001' }))).toBe(true);
    expect(isUnreachableError(new Error("Can't reach database server at `host`:`5432`"))).toBe(true);
    expect(isUnreachableError(new Error('Unique constraint failed'))).toBe(false);
    expect(isTransientConnectionError(new Error('Unique constraint failed'))).toBe(false);
  });

  it('retries once after a closed connection', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Error in PostgreSQL connection: Error { kind: Closed }')).mockResolvedValue('ok');
    expect(await retryTransient(run, [1])).toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits and retries while the database wakes up, then succeeds', async () => {
    const wake = Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    const run = vi.fn().mockRejectedValueOnce(wake).mockRejectedValueOnce(wake).mockResolvedValue('awake');
    expect(await retryTransient(run, [1, 1, 1])).toBe('awake');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('gives up after the last pause and reports the error', async () => {
    const wake = Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    const run = vi.fn().mockRejectedValue(wake);
    await expect(retryTransient(run, [1, 1])).rejects.toThrow("Can't reach database server");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never retries a real error (so nothing is ever done twice)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Unique constraint failed on the fields: (`email`)'));
    await expect(retryTransient(run, [1])).rejects.toThrow('Unique constraint');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stops at once if the retry fails with a different, real error', async () => {
    const wake = Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    const run = vi.fn().mockRejectedValueOnce(wake).mockRejectedValueOnce(new Error('Foreign key constraint failed'));
    await expect(retryTransient(run, [1, 1, 1])).rejects.toThrow('Foreign key');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
