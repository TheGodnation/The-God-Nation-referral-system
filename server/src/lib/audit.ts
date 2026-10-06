import { prisma } from './prisma';

interface AuditParams {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records an audit trail entry for an important Admin/security action.
 * Never pass passwords, password hashes, or session secrets in metadata.
 */
export async function recordAudit(params: AuditParams) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata as any,
    },
  });
}

const BRUTE_FORCE_WINDOW_MS = 15 * 60 * 1000;
const BRUTE_FORCE_MAX_FAILURES = 5;

/**
 * Returns true if the identifier (email) has exceeded the allowed number of
 * failed login attempts within the brute-force detection window.
 */
export async function isBruteForced(identifier: string): Promise<boolean> {
  const since = new Date(Date.now() - BRUTE_FORCE_WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: { identifier: identifier.toLowerCase(), success: false, createdAt: { gte: since } },
  });
  return failures >= BRUTE_FORCE_MAX_FAILURES;
}

export async function recordLoginAttempt(
  identifier: string,
  success: boolean,
  ip?: string,
  userAgent?: string,
) {
  await prisma.loginAttempt.create({
    data: { identifier: identifier.toLowerCase(), success, ip, userAgent },
  });
}
