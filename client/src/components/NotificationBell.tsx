import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

type NotificationType = 'FOLLOW_UP_ASSIGNED' | 'PRIVATE_MESSAGE_RECEIVED' | 'RESOURCE_GRANTED' | 'ROLE_ASSIGNED';

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
        return t('notifications.follow_up_assigned', { name: metadata.followedPersonName ?? '' });
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
