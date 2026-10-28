import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { formatBytes, isAllowedAttachmentMime, maxBytesForMime, MAX_HEADQUARTERS_POST_MEDIA } from '../lib/attachmentLimits';
import { SocialEmbed, type SocialEmbedInfo } from '../components/updates/SocialEmbed';

// ---------------------------------------------------------------------------
// The Share screen. Opens when something is shared to this app from the
// phone's Share menu (WhatsApp, TikTok, Facebook, Instagram…) — the service
// worker (public/sw.js) keeps the shared text and files on the phone and
// sends us here. It can also be opened by hand to paste a link (that's how
// it works on iPhones, which don't show web apps in the Share menu).
//
// Only the Central Admin (admin account, or their own member profile) — and
// later, Leaders the admin switches on — can post from here. Everyone else
// just sees a short "only leaders" note; nothing is posted.
// ---------------------------------------------------------------------------

const SHARE_CACHE = 'god-nation-share-v1';
const SHARE_META_KEY = '/__share/meta';

interface SharedMeta {
  title: string;
  text: string;
  url: string;
  files: { key: string; name: string; type: string; size: number }[];
}

interface Status {
  canShare: boolean;
  isAdmin?: boolean;
  canPostNetworkWide?: boolean;
  canPostAsSelf?: boolean;
  voices?: Voice[];
  communities?: { id: string; name: string }[];
}

type Voice = 'COMMUNICATION_DEPARTMENT' | 'CENTRAL_AUTHORITY' | 'SELF';

interface PickedFile {
  file: File;
  type: string;
  problem: string | null;
}

// Phones label the same kind of file in different ways (a WhatsApp voice
// note is often "audio/ogg; codecs=opus" or has no type at all). Turn them
// into the names the server accepts.
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'audio/opus': 'audio/ogg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
};

export function normalizeMime(type: string, name: string): string {
  const base = (type || '').split(';')[0].trim().toLowerCase();
  const fixed = ALIASES[base] ?? base;
  if (fixed && isAllowedAttachmentMime(fixed)) return fixed;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? fixed;
}

async function readSharedItems(): Promise<{ meta: SharedMeta; files: File[] } | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(SHARE_META_KEY);
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as SharedMeta;
    const files: File[] = [];
    for (const f of meta.files ?? []) {
      const res = await cache.match(f.key);
      if (!res) continue;
      const blob = await res.blob();
      files.push(new File([blob], f.name, { type: f.type || blob.type }));
    }
    return { meta, files };
  } catch {
    return null;
  }
}

async function clearSharedItems() {
  try {
    if (typeof caches !== 'undefined') await caches.delete(SHARE_CACHE);
  } catch {
    /* nothing to clear */
  }
}

/** Shared text and link joined the way a person would write it. */
function combineText(meta: SharedMeta): string {
  const parts = [meta.text.trim()];
  if (meta.url && !meta.text.includes(meta.url)) parts.push(meta.url.trim());
  if (!parts[0] && meta.title) parts.unshift(meta.title.trim());
  return parts.filter(Boolean).join('\n');
}

export function SharePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const missed = params.get('missed') === '1';

  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [voice, setVoice] = useState<Voice>('COMMUNICATION_DEPARTMENT');
  const [everyone, setEveryone] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState('');

  const [preview, setPreview] = useState<{ link: SocialEmbedInfo | null; playable: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(list: File[]) {
    setFiles((prev) => {
      const next = [...prev];
      for (const file of list) {
        const type = normalizeMime(file.type, file.name);
        let problem: string | null = null;
        if (!isAllowedAttachmentMime(type)) problem = t('share.file_unsupported') ?? '';
        else if (file.size > (maxBytesForMime(type) ?? 0)) problem = t('share.file_too_large', { max: formatBytes(maxBytesForMime(type) ?? 0) }) ?? '';
        next.push({ file, type, problem });
      }
      return next;
    });
  }

  // Who am I, and is anything waiting from the Share menu?
  useEffect(() => {
    api
      .get<Status>('/api/share-into-app/status')
      .then((s) => {
        setStatus(s);
        if (s.canShare && !s.canPostNetworkWide) setEveryone(false);
      })
      .catch(() => setStatusError(true));
    void readSharedItems().then((shared) => {
      if (!shared) return;
      setBody(combineText(shared.meta));
      if (shared.files.length) addFiles(shared.files);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check the link (if any) and show how it will look in the feed.
  const firstLink = useMemo(() => body.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? null, [body]);
  useEffect(() => {
    if (!status?.canShare || !firstLink) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      api
        .post<{ link: SocialEmbedInfo | null; playable: boolean }>('/api/share-into-app/link-preview', { text: firstLink })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [firstLink, status?.canShare]);

  const goodFiles = files.filter((f) => !f.problem).slice(0, MAX_HEADQUARTERS_POST_MEDIA);
  const tooMany = files.filter((f) => !f.problem).length > MAX_HEADQUARTERS_POST_MEDIA;
  const hasContent = Boolean(title.trim() || body.trim() || goodFiles.length);
  const audienceOk = everyone || groupIds.length > 0;

  async function post() {
    setError(null);
    setPosting(true);
    try {
      setProgress(t('share.progress_preparing') ?? '');
      const created = await api.post<{ id: string }>('/api/share-into-app/posts', {
        title: title.trim(),
        body: body.trim(),
        link: firstLink,
        voice,
        networkWide: everyone,
        communityIds: everyone ? [] : groupIds,
      });

      for (let i = 0; i < goodFiles.length; i += 1) {
        const { file, type } = goodFiles[i];
        setProgress(t('share.progress_uploading', { n: i + 1, total: goodFiles.length }) ?? '');
        const name = file.name || `file-${i + 1}`;
        const auth = await api.post<{ storageKey: string; uploadUrl: string }>(`/api/share-into-app/posts/${created.id}/media/authorize`, {
          originalFilename: name,
          mimeType: type,
          byteSize: file.size,
        });
        const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
        if (!put.ok) throw new Error(t('share.upload_failed') ?? 'upload failed');
        await api.post(`/api/share-into-app/posts/${created.id}/media`, {
          storageKey: auth.storageKey,
          originalFilename: name,
          mimeType: type,
          byteSize: file.size,
        });
      }

      setProgress(t('share.progress_publishing') ?? '');
      await api.post(`/api/share-into-app/posts/${created.id}/publish`);
      await clearSharedItems();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : t('share.post_failed') ?? '');
    } finally {
      setPosting(false);
      setProgress('');
    }
  }

  const homeLink = status?.isAdmin && !status.canPostAsSelf ? '/admin/dashboard' : '/member/updates';

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-xl px-4 py-5">
        <h1 className="mb-1 text-xl font-bold text-brand-900">{t('share.title')}</h1>

        {!status && !statusError && <p className="text-sm text-slate-500">{t('share.loading')}</p>}
        {statusError && <p className="text-sm text-red-700">{t('share.status_failed')}</p>}

        {status && !status.canShare && (
          <div className="mt-4 rounded-xl bg-white p-5 text-center shadow-sm">
            <p className="text-3xl" aria-hidden>
              🔒
            </p>
            <p className="mt-2 font-semibold text-slate-900">{t('share.not_allowed')}</p>
            <Link to="/member/updates" className="btn-primary mt-4 inline-block px-5 py-2">
              {t('share.back_to_app')}
            </Link>
          </div>
        )}

        {status?.canShare && done && (
          <div className="mt-4 rounded-xl bg-white p-5 text-center shadow-sm">
            <p className="text-3xl" aria-hidden>
              ✅
            </p>
            <p className="mt-2 font-semibold text-slate-900">{t('share.posted')}</p>
            <Link to={homeLink} className="btn-primary mt-4 inline-block px-5 py-2">
              {t('share.see_it')}
            </Link>
          </div>
        )}

        {status?.canShare && !done && (
          <div className="mt-3 space-y-5">
            <p className="text-sm text-slate-600">{t('share.intro')}</p>
            {missed && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('share.missed')}</p>}

            {/* Posting as */}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-800">{t('share.post_as')}</legend>
              <div className="space-y-2">
                {(status.voices ?? []).filter((v) => v !== 'SELF' || status.canPostAsSelf).map((v) => (
                  <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${voice === v ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white'}`}>
                    <input type="radio" name="voice" checked={voice === v} onChange={() => setVoice(v)} />
                    <span className="text-sm font-medium text-slate-900">
                      {v === 'COMMUNICATION_DEPARTMENT' ? t('headquartersPosts.comm_dept_name') : v === 'CENTRAL_AUTHORITY' ? t('headquartersPosts.hq_name') : t('share.voice_self')}
                      {v !== 'SELF' && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">✓</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Message */}
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="share-title">
                {t('share.headline')} <span className="font-normal text-slate-400">{t('share.optional')}</span>
              </label>
              <input id="share-title" className="input" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="share-body">
                {t('share.message')}
              </label>
              <textarea id="share-body" className="input" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('share.message_placeholder') ?? ''} />
              <p className="mt-1 text-xs text-slate-500">{t('share.copy_text_tip')}</p>
            </div>

            {/* How the link will look */}
            {firstLink && (
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-800">{t('share.preview')}</p>
                {previewLoading && <p className="text-sm text-slate-500">{t('share.checking_link')}</p>}
                {!previewLoading && preview?.link && (
                  <>
                    {!preview.playable && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('share.not_playable')}</p>}
                    <SocialEmbed embed={preview.link} />
                  </>
                )}
              </div>
            )}

            {/* Files from WhatsApp */}
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-800">{t('share.files')}</p>
              {files.length === 0 && <p className="text-sm text-slate-500">{t('share.no_files')}</p>}
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-xl" aria-hidden>
                      {f.type.startsWith('image/') ? '🖼️' : f.type.startsWith('video/') ? '🎬' : f.type.startsWith('audio/') ? '🎧' : '📄'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-900">{f.file.name || t('share.file')}</span>
                      <span className={`block text-xs ${f.problem ? 'text-red-700' : 'text-slate-500'}`}>{f.problem ?? formatBytes(f.file.size)}</span>
                    </span>
                    <button type="button" className="text-xs font-semibold text-slate-500 hover:text-red-700" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                      {t('share.remove')}
                    </button>
                  </li>
                ))}
              </ul>
              {tooMany && <p className="mt-1 text-xs text-amber-700">{t('share.too_many', { max: MAX_HEADQUARTERS_POST_MEDIA })}</p>}
              <button type="button" className="btn-secondary mt-2 px-4 py-2 text-sm" onClick={() => fileInput.current?.click()}>
                ＋ {t('share.add_file')}
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </div>

            {/* Who sees it */}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-800">{t('share.who_sees')}</legend>
              {status.canPostNetworkWide && (
                <label className="mb-2 flex items-center gap-3 text-sm">
                  <input type="radio" name="audience" checked={everyone} onChange={() => setEveryone(true)} />
                  {t('share.everyone')}
                </label>
              )}
              <label className="flex items-center gap-3 text-sm">
                <input type="radio" name="audience" checked={!everyone} onChange={() => setEveryone(false)} />
                {t('share.some_groups')}
              </label>
              {!everyone && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
                  <input className="input mb-2" placeholder={t('share.search_groups') ?? ''} value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {(status.communities ?? [])
                      .filter((c) => c.name.toLowerCase().includes(groupSearch.trim().toLowerCase()))
                      .map((c) => (
                        <label key={c.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                          <input
                            type="checkbox"
                            checked={groupIds.includes(c.id)}
                            onChange={(e) => setGroupIds((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)))}
                          />
                          {c.name}
                        </label>
                      ))}
                    {(status.communities ?? []).length === 0 && <p className="px-1 text-sm text-slate-500">{t('share.no_groups')}</p>}
                  </div>
                </div>
              )}
            </fieldset>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="button" className="btn-primary w-full py-3 text-base" disabled={posting || !hasContent || !audienceOk} onClick={() => void post()}>
              {posting ? progress || t('share.posting') : t('share.post_now')}
            </button>
            <Link to={homeLink} className="block text-center text-sm text-slate-500 hover:underline" onClick={() => void clearSharedItems()}>
              {t('share.cancel')}
            </Link>
          </div>
        )}
      </section>
    </PageShell>
  );
}
