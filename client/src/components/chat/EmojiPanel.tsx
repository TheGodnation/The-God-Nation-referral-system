import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMOJI_GROUPS, type EmojiGroupKey } from '../../lib/emojiData';
import { ChatIcon } from './icons';

// The WhatsApp-style emoji panel that takes the keyboard's place under the
// chat bar: Recents first, then every category in one scrolling list, with
// tabs along the bottom to jump between them, a search, and a delete key.
// Loaded only when someone first opens it (see ChatComposer), so the emoji
// list never slows down opening a chat.
const RECENTS_KEY = 'godnation.emojiRecents';
const MAX_RECENTS = 32;
const DEFAULT_RECENTS = ['🙏', '🙌', '❤️', '👍', '😊', '😂', '👏', '🔥', '✝️', '🎉', '💪', '😇'];

const TAB_ICON: Record<EmojiGroupKey, string> = {
  smileys: '😀',
  animals: '🐻',
  food: '🍔',
  activities: '⚽',
  travel: '🚗',
  objects: '💡',
  symbols: '🔣',
  flags: '🏳️',
};

const FIRST_BATCH = 96;
const BATCH = 160;
const TOTAL = EMOJI_GROUPS.reduce((n, g) => n + g.emojis.length, 0);
// Where each category starts in the one long list.
const GROUP_STARTS = (() => {
  const starts = {} as Record<EmojiGroupKey, number>;
  let n = 0;
  for (const g of EMOJI_GROUPS) {
    starts[g.key] = n;
    n += g.emojis.length;
  }
  return starts;
})();

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.length && list.every((x) => typeof x === 'string')) return list.slice(0, MAX_RECENTS);
  } catch {
    // Private window or blocked storage: fall back to the defaults.
  }
  return DEFAULT_RECENTS;
}

function saveRecents(list: string[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Not saved — recents then last only for this visit.
  }
}

export default function EmojiPanel({ onPick, onBackspace }: { onPick: (emoji: string) => void; onBackspace: () => void }) {
  const { t } = useTranslation();
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'recents' | EmojiGroupKey>('recents');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  // Recents and the first screenfuls appear at once; the rest is added a
  // moment later, a batch at a time, so the panel opens without a pause
  // even on a slow phone.
  const [shownCount, setShownCount] = useState(FIRST_BATCH);
  const pendingJumpRef = useRef<EmojiGroupKey | null>(null);
  // The list shown under "Recents" stays put while the panel is open, so a
  // tapped emoji doesn't jump to the front under the person's finger.
  const [shownRecents] = useState(recents);

  function pick(emoji: string) {
    onPick(emoji);
    setRecents((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENTS);
      saveRecents(next);
      return next;
    });
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const found: string[] = [];
    for (const group of EMOJI_GROUPS) {
      for (const [emoji, name] of group.emojis) {
        if (name.toLowerCase().includes(q)) found.push(emoji);
        if (found.length >= 160) return found;
      }
    }
    return found;
  }, [query]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || searching) return;
    const onScroll = () => {
      let current: 'recents' | EmojiGroupKey = 'recents';
      for (const key of ['recents', ...EMOJI_GROUPS.map((g) => g.key)] as const) {
        const section = sectionRefs.current[key];
        if (section && section.offsetTop - el.offsetTop <= el.scrollTop + 8) current = key;
      }
      setActiveTab(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [searching]);

  useEffect(() => {
    if (shownCount >= TOTAL) return;
    const id = window.setTimeout(() => setShownCount((n) => n + BATCH), 50);
    return () => window.clearTimeout(id);
  }, [shownCount]);

  function scrollToSection(key: 'recents' | EmojiGroupKey) {
    const el = scrollRef.current;
    const section = sectionRefs.current[key];
    if (el && section) el.scrollTop = section.offsetTop - el.offsetTop;
  }

  // A tab for a category not drawn yet draws everything up to it first.
  useEffect(() => {
    const key = pendingJumpRef.current;
    if (key && sectionRefs.current[key]) {
      pendingJumpRef.current = null;
      scrollToSection(key);
    }
  }, [shownCount]);

  function jumpTo(key: 'recents' | EmojiGroupKey) {
    setActiveTab(key);
    const start = key === 'recents' ? 0 : GROUP_STARTS[key];
    if (start >= shownCount) {
      pendingJumpRef.current = key as EmojiGroupKey;
      setShownCount(start + FIRST_BATCH);
    } else {
      scrollToSection(key);
    }
  }

  const grid = (emojis: string[]) => (
    <div className="grid grid-cols-8 gap-y-1">
      {emojis.map((emoji, i) => (
        <button
          key={`${emoji}-${i}`}
          type="button"
          onClick={() => pick(emoji)}
          className="flex h-10 items-center justify-center rounded-lg text-[26px] leading-none active:bg-slate-200"
        >
          {emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mt-2 flex h-[300px] flex-col rounded-t-2xl bg-white" data-testid="emoji-panel">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        {searching ? (
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('groupChat.emoji_search') ?? ''}
            aria-label={t('groupChat.emoji_search') ?? ''}
            className="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-1.5 text-[16px] outline-none"
          />
        ) : (
          <button type="button" onClick={() => setSearching(true)} aria-label={t('groupChat.emoji_search') ?? ''} className="p-1 text-slate-600">
            <ChatIcon name="search" />
          </button>
        )}
        {searching && (
          <button
            type="button"
            onClick={() => {
              setSearching(false);
              setQuery('');
            }}
            className="text-sm text-slate-500"
          >
            {t('groupChat.cancel')}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onBackspace} aria-label={t('groupChat.emoji_backspace') ?? ''} className="p-1 text-slate-600">
          <ChatIcon name="backspace" />
        </button>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {searching ? (
          query.trim() && results.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">{t('groupChat.emoji_none')}</p>
          ) : (
            <div className="pt-2">{grid(results)}</div>
          )
        ) : (
          <>
            <section ref={(el) => (sectionRefs.current.recents = el)}>
              <h3 className="px-1 pb-1 pt-2 text-sm font-semibold text-slate-500">{t('groupChat.emoji_recents')}</h3>
              {grid(shownRecents)}
            </section>
            {EMOJI_GROUPS.filter((g) => GROUP_STARTS[g.key] < shownCount).map((group) => (
              <section
                key={group.key}
                ref={(el) => (sectionRefs.current[group.key] = el)}
                className="[contain-intrinsic-size:auto_800px] [content-visibility:auto]"
              >
                <h3 className="px-1 pb-1 pt-3 text-sm font-semibold text-slate-500">{t(`groupChat.emoji_group_${group.key}`)}</h3>
                {grid(group.emojis.slice(0, shownCount - GROUP_STARTS[group.key]).map(([emoji]) => emoji))}
              </section>
            ))}
          </>
        )}
      </div>

      {!searching && (
        <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1">
          <button
            type="button"
            onClick={() => jumpTo('recents')}
            aria-label={t('groupChat.emoji_recents') ?? ''}
            className={`rounded-full p-1.5 ${activeTab === 'recents' ? 'bg-slate-200 text-slate-800' : 'text-slate-500'}`}
          >
            <ChatIcon name="clock" className="h-5 w-5" />
          </button>
          {EMOJI_GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => jumpTo(group.key)}
              aria-label={t(`groupChat.emoji_group_${group.key}`) ?? ''}
              className={`rounded-full p-1.5 text-lg leading-none ${activeTab === group.key ? 'bg-slate-200' : 'opacity-50 grayscale'}`}
            >
              {TAB_ICON[group.key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
