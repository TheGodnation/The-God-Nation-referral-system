import { useRef, useState, type RefObject, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionFormatBar } from './FormatBar';
import { LiveFormatTextarea } from './LiveFormatTextarea';
import { smartPaste } from '../lib/pasteHtml';

/**
 * A writing box for posts and updates that works like WhatsApp: select words
 * and a Bold · Italic · Strikethrough bar appears over the box (⋮ for lists,
 * quote and heading); the words show bold / italic as you write. Before
 * anything is selected the same spot shows a short hint, so the box never
 * jumps when the bar appears.
 */
export function FormattedTextarea({
  value,
  onValueChange,
  headings = false,
  compact = false,
  textareaRef,
  onSelect,
  onKeyUp,
  onTouchEnd,
  onBlur,
  onPaste,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (next: string) => void;
  /** Whether "# Heading" lines are offered (posts, not comments). */
  headings?: boolean;
  /** A tighter writing box: the hint line takes less room. */
  compact?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement>;
}) {
  const { t } = useTranslation();
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  const [hasSelection, setHasSelection] = useState(false);
  const barPressedAt = useRef(0);
  // After a paste that kept its structure: what was there before, so "paste as plain text" can swap it.
  const [pasted, setPasted] = useState<{ before: string; start: number; end: number; plain: string } | null>(null);
  const selected = (el: HTMLTextAreaElement) => el.selectionEnd !== el.selectionStart;
  const place = (el: HTMLTextAreaElement | null, at: number) =>
    window.requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
    });
  return (
    <div>
      <div
        className={`flex items-center ${compact ? 'mb-1 min-h-[1.5rem]' : 'mb-1.5 min-h-[2.75rem]'}`}
        onPointerDownCapture={() => (barPressedAt.current = Date.now())}
        onTouchStartCapture={() => (barPressedAt.current = Date.now())}
        onMouseDownCapture={() => (barPressedAt.current = Date.now())}
      >
        {hasSelection ? (
          <SelectionFormatBar textareaRef={ref} value={value} onChange={onValueChange} headings={headings} />
        ) : pasted ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-600" data-testid="paste-note">
            <span>{t('format.pasted')}</span>
            <button
              type="button"
              className="rounded-lg px-2 py-1.5 font-medium text-brand-700 underline"
              onClick={() => {
                const next = pasted.before.slice(0, pasted.start) + pasted.plain + pasted.before.slice(pasted.end);
                onValueChange(next);
                place(ref.current, pasted.start + pasted.plain.length);
                setPasted(null);
              }}
            >
              {t('format.paste_plain')}
            </button>
          </p>
        ) : (
          <p className={`px-1 text-slate-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>{t('format.hint')}</p>
        )}
      </div>
      <LiveFormatTextarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setPasted(null);
          onValueChange(e.target.value);
        }}
        onPaste={(e) => {
          onPaste?.(e);
          if (e.defaultPrevented || !headings) return;
          // A teaching or post keeps the shape of what was copied: headings, bold, lists, tables.
          const el = e.currentTarget;
          const plain = e.clipboardData.getData('text/plain');
          const converted = smartPaste({ html: e.clipboardData.getData('text/html'), plain });
          if (!converted) return;
          const start = el.selectionStart ?? value.length;
          const end = el.selectionEnd ?? start;
          const before = value.slice(0, start);
          const after = value.slice(end);
          // Headings, tables and lists must begin on a line of their own.
          const lead = before && !before.endsWith('\n') && /^(#{1,3} |\||- |\d+\. |> )/.test(converted) ? '\n' : '';
          const trail = after && !after.startsWith('\n') && /\n(#{1,3} |\||- |\d+\. |> )/.test(`\n${converted.split('\n').pop() ?? ''}`) ? '\n' : '';
          const inserted = `${lead}${converted}${trail}`;
          const next = before + inserted + after;
          if (rest.maxLength !== undefined && next.length > rest.maxLength) return; // let the phone paste (and trim) as usual
          e.preventDefault();
          onValueChange(next);
          setPasted({ before: value, start, end, plain: plain || converted });
          place(el, start + inserted.length);
        }}
        onSelect={(e) => {
          setHasSelection(selected(e.currentTarget));
          onSelect?.(e);
        }}
        onKeyUp={(e) => {
          setHasSelection(selected(e.currentTarget));
          onKeyUp?.(e);
        }}
        onTouchEnd={(e) => {
          // A long-press selects words; the phone settles the selection a moment later.
          const el = e.currentTarget;
          window.setTimeout(() => setHasSelection(selected(el)), 120);
          onTouchEnd?.(e);
        }}
        onBlur={(e) => {
          // Tapping the bar itself blurs the box on some phones: keep the bar then.
          window.setTimeout(() => {
            if (Date.now() - barPressedAt.current > 700) setHasSelection(false);
          }, 250);
          onBlur?.(e);
        }}
        {...rest}
      />
    </div>
  );
}
