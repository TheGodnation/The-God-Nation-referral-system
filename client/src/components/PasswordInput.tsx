import { useState } from 'react';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}

// Section 34: eye/show-hide control, reused across login, leader setup,
// change-password, and password-reset forms. Does not alter password
// handling in any way — purely a visibility toggle on a plain <input>.
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  placeholder,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className="input pr-12"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-600"
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M3 3l18 18M10.58 10.58a2 2 0 002.83 2.83M9.88 4.6A9.77 9.77 0 0112 4.5c5 0 9 4.5 9 7.5a10.6 10.6 0 01-2.16 3.19M6.12 6.12A10.6 10.6 0 003 12c0 3 4 7.5 9 7.5 1.3 0 2.53-.28 3.62-.78" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M3 12s3.5-7.5 9-7.5 9 7.5 9 7.5-3.5 7.5-9 7.5S3 12 3 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
