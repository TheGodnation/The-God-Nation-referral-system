import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { activePaymentProvider } from '../lib/payments';
import { notifyBookPaymentDecision } from '../lib/notifications';
import { creditReferralEarning } from '../lib/referralEarnings';

// POST /api/payments/webhook — the payment company tells us an automatic
// Mobile Money payment succeeded or failed (see lib/payments.ts). Nobody
// signs in here: the provider's own signature check is what makes it
// trustworthy, and an unknown or already-settled payment is ignored, so a
// repeated notification changes nothing.
const router = Router();

router.post('/webhook', asyncHandler(async (req, res) => {
  const provider = activePaymentProvider();
  if (!provider) return res.status(404).json({ error: 'Not found.' });
  const notification = await provider.readNotification(req);
  if (!notification) return res.status(400).json({ error: 'Invalid notification.' });

  const payment = await prisma.bookPayment.findUnique({ where: { providerRef: notification.providerRef } });
  if (!payment) return res.json({ ok: true });
  const changed = await prisma.bookPayment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { status: notification.status, decidedAt: new Date() },
  });
  if (changed.count === 1) {
    await recordAudit({ action: `BOOK_PAYMENT_${notification.status}`, targetType: 'BookPayment', targetId: payment.id, metadata: { provider: provider.name } });
    if (notification.status === 'CONFIRMED') {
      await notifyBookPaymentDecision(payment, true).catch(() => {});
      await creditReferralEarning({ ...payment, status: 'CONFIRMED' });
    }
  }
  res.json({ ok: true });
}));

export default router;
