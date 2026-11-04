import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleInline, toggleLines, type Edit, type InlineMark, type LineKind } from '../lib/formatting';

// The formatting buttons above a writing box: bold, italic, strikethrough,
// lists, quote (and heading, for posts). They act on the selected words, or
// on the line the cursor is on, and work by adding the symbols described in
// lib/richText.tsx. The box keeps focus, so the phone keyboard stays up.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** What the buttons do to the text: wrap the selected words in a symbol, or turn the lines into a list / quote / heading. */
function useFormatActions(textareaRef: RefObject<HTMLTextAreaElement | null>, value: string, onChange: (next: string) => void) {
  function run(edit: (text: string, sel: { start: number; end: number }) => Edit) {
    const el = textareaRef.current;
    const sel = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
    const result = edit(value, sel);
    onChange(result.text);
    // The box is controlled: put the selection back once the new text is in it.
    window.requestAnimationFrame(() => {
      const box = textareaRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(result.sel.start, result.sel.end);
    });
  }
  return {
    inline: (mark: InlineMark) => () => run((text, sel) => toggleInline(text, sel, mark)),
    lines: (kind: LineKind) => () => run((text, sel) => toggleLines(text, sel, kind)),
  };
}

/** Keeps the cursor and the keyboard in the box while a button is tapped (mouse, finger or pen). */
const keepFocus = {
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onTouchStart: (e: React.TouchEvent) => e.preventDefault(),
};

export function FormatBar({
  textareaRef,
  value,
  onChange,
  headings = false,
  hint = false,
  className = '',
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  headings?: boolean;
  /** A short line telling how to use the buttons (select words, then tap). */
  hint?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { inline, lines } = useFormatActions(textareaRef, value, onChange);

  const buttons: { key: string; label: string; face: React.ReactNode; on: () => void }[] = [
    { key: 'bold', label: t('format.bold'), face: <b>B</b>, on: inline('*') },
    { key: 'italic', label: t('format.italic'), face: <i className="font-serif">I</i>, on: inline('_') },
    { key: 'strike', label: t('format.strike'), face: <s>S</s>, on: inline('~') },
    { key: 'bullets', label: t('format.bullets'), face: '•≡', on: lines('bullet') },
    { key: 'numbers', label: t('format.numbers'), face: '1.', on: lines('number') },
    { key: 'quote', label: t('format.quote'), face: '❝', on: lines('quote') },
    ...(headings ? [{ key: 'heading', label: t('format.heading'), face: 'H', on: lines('heading') }] : []),
  ];

  return (
    <div className={className}>
    <div role="toolbar" aria-label={t('format.toolbar') ?? ''} className="flex flex-wrap items-center gap-1">
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          aria-label={b.label}
          title={b.label}
          {...keepFocus}
          onClick={b.on}
          className="flex h-9 min-w-[2.25rem] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {b.face}
        </button>
      ))}
    </div>
    {hint && <p className="mt-1 text-xs text-slate-500">{t('format.hint')}</p>}
    </div>
  );
}

/** True on phones and tablets (a finger, not a mouse), where the phone shows its own Cut · Copy · Paste menu over selected words. */
function useTouchScreen(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
  return Boolean(query?.matches);
}

/**
 * How far the visible screen's bottom edge is above the bottom of the page — i.e. the height of
 * the phone keyboard — so a bar can sit right on top of the keyboard, far from the phone's own menu.
 */
function useKeyboardHeight(active: boolean): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) return undefined;
    const update = () => setH(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return h;
}

/**
 * The bar shown when words are selected: Bold · Italic · Strikethrough, and "More" for lists
 * and quotes. Select your words, tap one, and they change (tap again to undo).
 *
 * On a phone the bar sits just above the keyboard, with large buttons and clear gaps, because the
 * phone's own Cut · Copy · Select all menu appears over the selected words and used to hide or
 * crowd it (a tap meant for Bold landed on Cut). On a computer it stays over the box.
 */
export function SelectionFormatBar({
  textareaRef,
  value,
  onChange,
  headings = false,
  className = '',
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** Whether "Heading" is offered under "More" (posts, not chat). */
  headings?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { inline, lines } = useFormatActions(textareaRef, value, onChange);
  const [more, setMore] = useState(false);
  const touch = useTouchScreen();
  const keyboard = useKeyboardHeight(touch);
  const item = touch
    ? 'flex h-12 min-w-[3.25rem] items-center justify-center whitespace-nowrap rounded-xl bg-slate-50 px-4 text-base text-slate-800 ring-1 ring-slate-200 active:bg-slate-200'
    : 'whitespace-nowrap rounded-xl px-3 py-2 text-[15px] text-slate-800 active:bg-slate-100';
  const gap = touch ? 'gap-3' : 'gap-0.5';
  const bar = (
    <div
      role="toolbar"
      aria-label={t('format.toolbar') ?? ''}
      data-testid="selection-format-bar"
      data-placement={touch ? 'keyboard' : 'inline'}
      className={`flex max-w-full flex-wrap items-center ${gap} self-start rounded-2xl bg-white shadow-lg ring-1 ring-slate-200 ${touch ? 'justify-center p-2' : 'px-1 py-1'} ${className}`}
    >
      <button type="button" {...keepFocus} onClick={inline('*')} aria-label={t('format.bold') ?? ''} className={`${item} font-bold`}>
        {t('format.bold')}
      </button>
      <button type="button" {...keepFocus} onClick={inline('_')} aria-label={t('format.italic') ?? ''} className={`${item} italic`}>
        {t('format.italic')}
      </button>
      <button type="button" {...keepFocus} onClick={inline('~')} aria-label={t('format.strike') ?? ''} className={`${item} line-through`}>
        {t('format.strike')}
      </button>
      {/* A clear space before "More", so a tap on Strikethrough never opens it by mistake. */}
      <button type="button" {...keepFocus} onClick={() => setMore((v) => !v)} aria-expanded={more} aria-label={t('format.more') ?? ''} className={`${item} font-bold ${touch ? 'ml-2' : ''}`}>
        ⋮
      </button>
      {more && (
        <>
          <button type="button" {...keepFocus} onClick={lines('bullet')} aria-label={t('format.bullets') ?? ''} className={item}>
            •≡
          </button>
          <button type="button" {...keepFocus} onClick={lines('number')} aria-label={t('format.numbers') ?? ''} className={item}>
            1.
          </button>
          <button type="button" {...keepFocus} onClick={lines('quote')} aria-label={t('format.quote') ?? ''} className={item}>
            ❝
          </button>
          {headings && (
            <button type="button" {...keepFocus} onClick={lines('heading')} aria-label={t('format.heading') ?? ''} className={`${item} font-bold`}>
              H
            </button>
          )}
        </>
      )}
    </div>
  );
  if (!touch) return bar;
  // Lifted out of the page and fixed above the keyboard (events still reach the box's wrapper).
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3 pb-2" style={{ bottom: keyboard }}>
      <div className="pointer-events-auto max-w-full">{bar}</div>
    </div>,
    document.body,
  );
}
