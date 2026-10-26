import { useRef, type RefObject, type TextareaHTMLAttributes } from 'react';
import { FormatBar } from './FormatBar';

/** A writing box with the formatting buttons above it (bold, italic, lists…), for posts and updates. */
export function FormattedTextarea({
  value,
  onValueChange,
  headings = false,
  textareaRef,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (next: string) => void;
  /** Whether "# Heading" lines are offered (posts, not comments). */
  headings?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  return (
    <div>
      <FormatBar textareaRef={ref} value={value} onChange={onValueChange} headings={headings} className="mb-1.5" />
      <textarea ref={ref} value={value} onChange={(e) => onValueChange(e.target.value)} {...rest} />
    </div>
  );
}
