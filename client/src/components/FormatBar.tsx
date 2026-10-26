import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleInline, toggleLines, type Edit, type InlineMark, type LineKind } from '../lib/formatting';

// The formatting buttons above a writing box: bold, italic, strikethrough,
// lists, quote (and heading, for posts). They act on the selected words, or
// on the line the cursor is on, and work by adding the symbols described in
// lib/richText.tsx. The box keeps focus, so the phone keyboard stays up.

export function FormatBar({
  textareaRef,
  value,
  onChange,
  headings = false,
  className = '',
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  headings?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

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

  const inline = (mark: InlineMark) => () => run((text, sel) => toggleInline(text, sel, mark));
  const lines = (kind: LineKind) => () => run((text, sel) => toggleLines(text, sel, kind));

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
    <div role="toolbar" aria-label={t('format.toolbar') ?? ''} className={`flex flex-wrap items-center gap-1 ${className}`}>
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          aria-label={b.label}
          title={b.label}
          // Keeps the cursor and the keyboard in the box while a button is tapped.
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.on}
          className="flex h-9 min-w-[2.25rem] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {b.face}
        </button>
      ))}
    </div>
  );
}
