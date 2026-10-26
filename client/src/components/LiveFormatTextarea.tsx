import { forwardRef, useRef, type TextareaHTMLAttributes } from 'react';
import { renderLive } from '../lib/liveFormat';

/**
 * A writing box that shows bold, italic and crossed-out words as you write
 * them, like WhatsApp (the *, _ and ~ symbols stay, faint grey). The real
 * textarea sits on top with see-through text, so typing, selecting, drafts
 * and the keyboard work exactly as before; a copy of the text painted behind
 * it shows the formatting. `className` goes on both, so they line up.
 */
export const LiveFormatTextarea = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string; wrapperClassName?: string }
>(function LiveFormatTextarea({ value, className = '', wrapperClassName = '', onScroll, ...rest }, ref) {
  const mirror = useRef<HTMLDivElement>(null);
  return (
    <div className={`live-format relative ${wrapperClassName}`}>
      <div
        ref={mirror}
        aria-hidden="true"
        data-testid="live-format-mirror"
        className={`lf-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words ${className}`}
      >
        {renderLive(value)}
      </div>
      <textarea
        ref={ref}
        value={value}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        {...rest}
        // See-through text and background over the painted copy; the caret stays dark.
        className={`${className} relative !bg-transparent !text-transparent caret-slate-900 [-webkit-text-fill-color:transparent]`}
      />
    </div>
  );
});
