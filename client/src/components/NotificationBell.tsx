import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStoreApp } from '../lib/storeApp';
import { api } from '../lib/api';

type NotificationType =
  | 'FOLLOW_UP_ASSIGNED'
  | 'PRIVATE_MESSAGE_RECEIVED'
  | 'RESOURCE_GRANTED'
  | 'ROLE_ASSIGNED'
  | 'FRIEND_REQUEST_RECEIVED'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'PRAYER_REQUEST_COMMENT'
  | 'PRAYER_REQUEST_SUBMITTED_PRIVATELY'
  | 'ANNOUNCEMENT_PUBLISHED'
  | 'HEADQUARTERS_POST_PUBLISHED'
  | 'AREA_LEADERSHIP_ASSIGNED'
  | 'AREA_REPRESENTATION_REQUEST_DECLINED'
  | 'EXAM_RETAKE_GRANTED'
  | 'EXAM_RETAKE_DECLINED'
  | 'BOOK_PAYMENT_CONFIRMED'
  | 'BOOK_PAYMENT_REJECTED'
  | 'PAYMENT_ORDER_NEW'
  | 'BOOK_PASSED_PAY'
  | 'PAYMENT_ORDER_MESSAGE'
  | 'TRAINING_GRACE_GRANTED'
  | 'READ_REQUESTED'
  | 'READ_APPROVED'
  | 'TRAINING_GRACE_DECLINED'
  | 'REFERRAL_EARNING'
  | 'REFERRAL_PAYOUT_PAID'
  | 'REFERRAL_PAYOUT_REJECTED'
  | 'EVENT_NEW'
  | 'EVENT_REMINDER'
  | 'MEMBER_REPORT_REVIEWED'
  | 'POST_PUBLISHED'
  | 'POST_LIKED'
  | 'POST_REPLIED'
  | 'ASSEMBLY_OPENED'
  | 'ADDED_TO_ASSEMBLY'
  | 'SANCTION_PLACED'
  | 'SANCTION_LIFTED'
  | 'SANCTION_ENDED'
  | 'EXCUSE_REQUESTED'
  | 'REMOVAL_REQUESTED'
  | 'REMOVAL_DECIDED'
  | 'REMOVED_FROM_ASSEMBLY'
  | 'REPRESENTATIVE_APPOINTED'
  | 'REPRESENTATIVE_ENDED'
  | 'REPORT_REMINDER'
  | 'REPORT_LATE'
  | 'ESCALATION_RECEIVED'
  | 'INSTRUCTION_RECEIVED'
  | 'INSTRUCTION_REMINDER'
  | 'ESCALATION_ANSWERED'
  | 'ESCALATION_BYPASSED'
  | 'CLINIC_EXAM_OPEN'
  | 'GIFT_CONFIRMED'
  | 'GIFT_REJECTED'
  | 'FAITH_NEEDS_CONVERSATION'
  | 'LEADER_ASSIGNED';

interface NotificationRow {
  id: string;
  type: NotificationType;
  metadata: Record<string, unknown> | null;
  targetType: string | null;
  targetId: string | null;
  readAt: string | null;
  createdAt: string;
}

// In-App Notifications Foundation — a small, shared bell used identically
// across the Admin/Leader/Member dashboards (each already renders the same
// title/logout header row; this slots in beside it). No message text is
// ever stored server-side (see lib/notifications.ts) — every message below
// is rendered entirely from `type` + `metadata` through this app's existing
// i18n convention, never a hardcoded or server-sent string.
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadUnreadCount() {
    api
      .get<{ unreadCount: number }>('/api/notifications/unread-count')
      .then((res) => setUnreadCount(res.unreadCount))
      .catch(() => {
        // Non-fatal — the bell simply shows no badge until the next
        // successful poll (e.g. opening the list itself).
      });
  }

  useEffect(loadUnreadCount, []);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<{ items: NotificationRow[] }>('/api/notifications?page=1&pageSize=20')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('notifications.load_failed'));
        setLoading(false);
      });
  }

  function toggleOpen() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) load();
      return next;
    });
  }

  async function markRead(notification: NotificationRow) {
    if (notification.readAt) return;
    try {
      await api.patch(`/api/notifications/${notification.id}/read`, {});
      setItems((prev) => prev.map((i) => (i.id === notification.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Non-fatal — the notification simply stays visually unread; the
      // user can try again.
    }
  }

  function renderMessage(n: NotificationRow): string {
    const metadata = n.metadata ?? {};
    switch (n.type) {
      case 'FOLLOW_UP_ASSIGNED':
        return metadata.count ? t('notifications.follow_up_batch', { count: Number(metadata.count) }) : t('notifications.follow_up_assigned', { name: metadata.followedPersonName ?? '' });
      case 'PRIVATE_MESSAGE_RECEIVED': {
        const senderName = metadata.senderName as string | null | undefined;
        return t('notifications.private_message_received', {
          name: senderName || t('privateMessages.from_central_authority'),
        });
      }
      case 'RESOURCE_GRANTED': {
        const title = isFr ? metadata.resourceTitleFr || metadata.resourceTitleEn : metadata.resourceTitleEn;
        return t('notifications.resource_granted', { title: title ?? '' });
      }
      case 'ROLE_ASSIGNED':
        return t('notifications.role_assigned', { community: metadata.communityName ?? '' });
      case 'FRIEND_REQUEST_RECEIVED':
        return t('notifications.friend_request_received', { name: metadata.senderName ?? '' });
      case 'FRIEND_REQUEST_ACCEPTED':
        return t('notifications.friend_request_accepted', { name: metadata.senderName ?? '' });
      case 'PRAYER_REQUEST_COMMENT':
        return t('notifications.prayer_request_comment', { name: metadata.commenterName ?? '' });
      case 'PRAYER_REQUEST_SUBMITTED_PRIVATELY':
        return t('notifications.prayer_request_submitted_privately', { name: metadata.authorName ?? '' });
      case 'ANNOUNCEMENT_PUBLISHED': {
        const title = isFr ? metadata.titleFr || metadata.titleEn : metadata.titleEn;
        return t('notifications.announcement_published', { title: title ?? '' });
      }
      case 'HEADQUARTERS_POST_PUBLISHED': {
        const title = isFr ? metadata.titleFr || metadata.titleEn : metadata.titleEn;
        return t('notifications.headquarters_post_published', { title: title ?? '' });
      }
      case 'AREA_LEADERSHIP_ASSIGNED':
        return t('notifications.area_leadership_assigned', { title: metadata.areaTitle ?? '', area: metadata.areaPath ?? '' });
      case 'AREA_REPRESENTATION_REQUEST_DECLINED':
        return t('notifications.area_representation_request_declined', { area: metadata.areaPath ?? '' });
      case 'EXAM_RETAKE_GRANTED':
        return t('notifications.exam_retake_granted', { number: metadata.bookNumber ?? '' });
      case 'EXAM_RETAKE_DECLINED':
        return t('notifications.exam_retake_declined', { number: metadata.bookNumber ?? '' });
      case 'BOOK_PAYMENT_CONFIRMED':
        return Number(metadata.count ?? 1) > 1
          ? t('notifications.book_payment_confirmed_many', { count: Number(metadata.count) })
          : t('notifications.book_payment_confirmed', { number: metadata.bookNumber ?? '' });
      case 'BOOK_PAYMENT_REJECTED':
        return Number(metadata.count ?? 1) > 1
          ? t('notifications.book_payment_rejected_many', { count: Number(metadata.count) })
          : t('notifications.book_payment_rejected', { number: metadata.bookNumber ?? '' });
      case 'PAYMENT_ORDER_NEW':
        return Number(metadata.count ?? 1) > 1
          ? t('notifications.payment_order_new_many', { name: metadata.name ?? '', count: Number(metadata.count) })
          : t('notifications.payment_order_new', { name: metadata.name ?? '', number: metadata.bookNumber ?? '' });
      case 'PAYMENT_ORDER_MESSAGE':
        return metadata.reminder ? t('notifications.payment_order_reminder', { name: metadata.name ?? '' }) : t('notifications.payment_order_message', { name: metadata.name ?? '' });
      case 'BOOK_PASSED_PAY':
        return t(isStoreApp() ? 'notifications.book_passed_store' : 'notifications.book_passed_pay', { number: metadata.bookNumber ?? '' });
      case 'MEMBER_REPORT_REVIEWED': {
        // To the person whose post was reported: a polite reminder of the community's standards.
        if (metadata.audience === 'REPORTED') return t(metadata.removed ? 'notifications.report_author_removed' : 'notifications.report_author_notice');
        const base = t(metadata.outcome === 'VIOLATION' ? 'notifications.report_violation' : metadata.outcome === 'NO_VIOLATION' ? 'notifications.report_no_violation' : 'notifications.report_reviewed');
        return metadata.note ? `${base} ${t('notifications.report_note', { note: String(metadata.note) })}` : base;
      }
      case 'CLINIC_EXAM_OPEN':
        return t('notifications.clinic_exam_open', { number: metadata.number ?? '', questions: metadata.questions ?? '' });
      case 'GIFT_CONFIRMED':
      case 'GIFT_REJECTED':
        return t(n.type === 'GIFT_CONFIRMED' ? 'notifications.gift_confirmed' : 'notifications.gift_rejected', { amount: `${Number(metadata.amount ?? 0).toLocaleString('fr-FR')} FCFA` });
      case 'FAITH_NEEDS_CONVERSATION':
        return t(metadata.bookNumber ? 'notifications.faith_needs_conversation' : 'notifications.faith_needs_conversation_plain', { name: metadata.personName ?? '', number: metadata.bookNumber ?? '' });
      case 'LEADER_ASSIGNED':
        return t('notifications.leader_assigned', { name: metadata.leaderName ?? '' });
      case 'INSTRUCTION_RECEIVED':
        return t('notifications.instruction_received');
      case 'INSTRUCTION_REMINDER':
        return t('notifications.instruction_reminder');
      case 'ESCALATION_RECEIVED':
        return t(metadata.passedOn ? 'notifications.escalation_passed_on' : metadata.urgent ? 'notifications.escalation_urgent' : 'notifications.escalation_received', { asker: metadata.askerName ?? '', about: metadata.aboutName ?? '' });
      case 'ESCALATION_ANSWERED':
        return t('notifications.escalation_answered', { name: metadata.answererName ?? '', about: metadata.aboutName ?? '' });
      case 'ESCALATION_BYPASSED':
        return t(metadata.role === 'ASKER' ? 'notifications.escalation_bypassed_asker' : metadata.reason === 'AWAY' ? 'notifications.escalation_bypassed_away' : 'notifications.escalation_bypassed_skipped', { asker: metadata.askerName ?? '', about: metadata.aboutName ?? '' });
      case 'SANCTION_PLACED': {
        const date = metadata.endsAt ? new Date(String(metadata.endsAt)).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long' }) : '';
        return t('notifications.sanction_placed', { assembly: metadata.assemblyName ?? '', date, reason: metadata.reason ?? '' });
      }
      case 'SANCTION_LIFTED':
        return t('notifications.sanction_lifted', { assembly: metadata.assemblyName ?? '' });
      case 'SANCTION_ENDED':
        return t('notifications.sanction_ended', { assembly: metadata.assemblyName ?? '' });
      case 'EXCUSE_REQUESTED':
        return t('notifications.excuse_requested', { name: metadata.personName ?? '', assembly: metadata.assemblyName ?? '' });
      case 'REMOVAL_REQUESTED':
        return t('notifications.removal_requested', { requester: metadata.requesterName ?? '', name: metadata.personName ?? '', assembly: metadata.assemblyName ?? '' });
      case 'REMOVAL_DECIDED':
        return t(metadata.approved ? 'notifications.removal_decided_yes' : 'notifications.removal_decided_no', { name: metadata.personName ?? '', assembly: metadata.assemblyName ?? '' });
      case 'REPORT_REMINDER':
        return t('notifications.report_reminder');
      case 'REPORT_LATE':
        return t('notifications.report_late');
      case 'REPRESENTATIVE_APPOINTED':
        return t('notifications.representative_appointed', { generation: metadata.generation ?? '' });
      case 'REPRESENTATIVE_ENDED':
        return t('notifications.representative_ended', { generation: metadata.generation ?? '' });
      case 'REMOVED_FROM_ASSEMBLY':
        return t('notifications.removed_from_assembly', { assembly: metadata.assemblyName ?? '' });
      case 'ADDED_TO_ASSEMBLY':
        return t('notifications.added_to_assembly', { name: metadata.assemblyName ?? '' });
      case 'ASSEMBLY_OPENED':
        return t('notifications.assembly_opened', { name: metadata.assemblyName ?? '', parent: metadata.parentName ?? '' });
      case 'POST_PUBLISHED':
        return t('notifications.post_published_all', { name: metadata.authorName ?? '' });
      case 'POST_LIKED':
        return t(`notifications.post_liked_${metadata.kind === 'COMMENT' ? 'comment' : metadata.kind === 'MESSAGE' ? 'message' : 'post'}`, { name: metadata.actorName ?? '', emoji: metadata.emoji ?? '👍' });
      case 'POST_REPLIED':
        return t(`notifications.post_replied_${metadata.kind === 'COMMENT_REPLY' ? 'comment' : metadata.kind === 'MESSAGE_REPLY' ? 'message' : 'post'}`, { name: metadata.actorName ?? '' });
      case 'READ_REQUESTED':
        return t('notifications.read_requested', { name: metadata.personName ?? '' });
      case 'READ_APPROVED':
        return t('notifications.read_approved');
      case 'TRAINING_GRACE_GRANTED':
        return t('notifications.training_grace_granted', { count: Number(metadata.books ?? 0) });
      case 'TRAINING_GRACE_DECLINED':
        return t('notifications.training_grace_declined');
      case 'REFERRAL_EARNING':
        return t('notifications.referral_earning', { amount: Number(metadata.amount ?? 0).toLocaleString('fr-FR') });
      case 'REFERRAL_PAYOUT_PAID':
        return t('notifications.referral_payout_paid', { amount: Number(metadata.amount ?? 0).toLocaleString('fr-FR') });
      case 'REFERRAL_PAYOUT_REJECTED':
        return t('notifications.referral_payout_rejected');
      case 'EVENT_NEW':
      case 'EVENT_REMINDER': {
        const when = metadata.startsAt ? new Date(String(metadata.startsAt)).toLocaleString(isFr ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        return t(n.type === 'EVENT_NEW' ? 'notifications.notif_new' : 'notifications.notif_soon', { title: metadata.title ?? '', community: metadata.community ?? '', when });
      }
      default:
        return '';
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={t('notifications.title')}
        className="btn-secondary relative px-3 py-2"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-medium text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-100 bg-white p-3 shadow-lg">
          <h3 className="mb-2 font-medium text-brand-900">{t('notifications.title')}</h3>
          {loading && <p className="text-sm text-slate-400">{t('notifications.loading')}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!loading && !error && (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {items.map((n) => (
                <li
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={`cursor-pointer rounded p-2 text-sm ${n.readAt ? 'text-slate-500' : 'bg-brand-50 font-medium text-brand-900'}`}
                >
                  <p>{renderMessage(n)}</p>
                  {n.type === 'LEADER_ASSIGNED' && n.targetId && (
                    <a href={`/member/people/${n.targetId}`} className="text-xs font-semibold text-brand-700 underline">
                      {t('myLeader.message')}
                    </a>
                  )}
                  {n.type === 'FAITH_NEEDS_CONVERSATION' && n.targetId && (
                    <a href={`/member/faith/${n.targetId}`} className="text-xs font-semibold text-brand-700 underline">
                      {t('faith.notification_open')}
                    </a>
                  )}
                  <p className="mt-0.5 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</p>
                </li>
              ))}
              {items.length === 0 && <li className="py-2 text-center text-sm text-slate-400">{t('notifications.empty')}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
