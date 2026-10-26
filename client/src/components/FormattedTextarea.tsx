import { useRef, useState, type RefObject, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionFormatBar } from './FormatBar';
import { LiveFormatTextarea } from './LiveFormatTextarea';

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
  textareaRef,
  onSelect,
  onKeyUp,
  onTouchEnd,
  onBlur,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (next: string) => void;
  /** Whether "# Heading" lines are offered (posts, not comments). */
  headings?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement>;
}) {
  const { t } = useTranslation();
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  const [hasSelection, setHasSelection] = useState(false);
  const barPressedAt = useRef(0);
  const selected = (el: HTMLTextAreaElement) => el.selectionEnd !== el.selectionStart;
  return (
    <div>
      <div
        className="mb-1.5 flex min-h-[2.75rem] items-center"
        onPointerDownCapture={() => (barPressedAt.current = Date.now())}
        onTouchStartCapture={() => (barPressedAt.current = Date.now())}
        onMouseDownCapture={() => (barPressedAt.current = Date.now())}
      >
        {hasSelection ? (
          <SelectionFormatBar textareaRef={ref} value={value} onChange={onValueChange} headings={headings} />
        ) : (
          <p className="px-1 text-xs text-slate-500">{t('format.hint')}</p>
        )}
      </div>
      <LiveFormatTextarea
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
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
