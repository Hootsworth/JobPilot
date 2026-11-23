'use client';

import React, { useEffect, useId, useRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: Array<string | undefined | null | false>): string {
  return twMerge(clsx(inputs));
}

export function JobPilotLogo({
  size = 28,
  className
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 94"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <rect
        x="2"
        y="2"
        width="96"
        height="90"
        rx="22"
        fill="#121214"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="2"
      />
      <rect x="17" y="15" width="9.5" height="9.5" rx="2.2" fill="#FFFFFF" />
      <rect x="32.5" y="15" width="9.5" height="9.5" rx="2.2" fill="#FFFFFF" />
      <rect x="48" y="15" width="9.5" height="9.5" rx="2.2" fill="#FFFFFF" />
      <rect x="9" y="33" width="82" height="5.5" rx="2" fill="#FFFFFF" />
      <path
        d="M25 51L43 63.5L25 76"
        stroke="#FFFFFF"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="54" y="47" width="9.5" height="33" rx="1.5" fill="#0055FF" />
    </svg>
  );
}

export function AsciiWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-bold tracking-tight text-[var(--ink)] select-none',
        className
      )}
      aria-label="JobPilot"
    >
      <JobPilotLogo size={28} />
      <span className="text-base font-bold tracking-wide">JOBPILOT</span>
    </span>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-[4px] border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:bg-[var(--surface-card)] disabled:text-[var(--ash)] disabled:border-[var(--hairline)]';

  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] hover:opacity-90 active:bg-[var(--ink-deep)]',
    secondary:
      'bg-[var(--canvas)] text-[var(--ink)] border-[var(--hairline-strong)] hover:bg-[var(--surface-soft)]',
    ghost:
      'bg-transparent text-[var(--ink)] border-transparent hover:bg-[var(--surface-soft)]',
    danger:
      'bg-[var(--danger)] text-white border-[var(--danger)] hover:bg-[var(--danger-hover)]'
  };

  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'min-h-[36px] px-3 py-1 text-sm leading-normal',
    md: 'min-h-[40px] px-5 py-1 text-base leading-[1.8]'
  };

  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (inputProps: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid': 'true' | 'false';
  }) => React.ReactNode;
}

/**
 * Accessible form field wrapper following modern-web-guidance:
 * - Format hints placed ABOVE the input so autocomplete/mobile keyboards never cover them.
 * - Error ID listed in aria-describedby ONLY while an error is shown.
 * - aria-invalid explicitly kept as "false" until invalid.
 */
export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;

  const describedByIds: string[] = [];
  if (hint) describedByIds.push(hintId);
  if (error) describedByIds.push(errorId);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--ink)]">
        {label}
        {required ? (
          <span className="ml-1 text-[var(--danger-text)]" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <span id={hintId} className="text-xs text-[var(--mute)]">
          {hint}
        </span>
      ) : null}
      {children({
        id: htmlFor,
        ...(describedByIds.length > 0 ? { 'aria-describedby': describedByIds.join(' ') } : {}),
        'aria-invalid': error ? 'true' : 'false'
      })}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-[var(--danger-text)]" role="status">
          [!] {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('oc-input', className)} {...props} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn('oc-input min-h-[96px] py-3 resize-y', className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn('oc-input oc-select appearance-none pr-10 cursor-pointer', className)}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center justify-center text-[var(--mute)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block shrink-0"
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
        </svg>
      </span>
    </div>
  );
});

export function Badge({
  tone = 'neutral',
  children,
  className
}: {
  tone?: 'neutral' | 'dark' | 'success' | 'warning' | 'danger' | 'accent';
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<NonNullable<typeof tone>, string> = {
    neutral: 'bg-[var(--surface-card)] text-[var(--ink)] border-[var(--hairline)]',
    dark: 'bg-[var(--surface-dark)] text-[var(--on-dark)] border-[var(--surface-dark)]',
    success: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-text)]/30',
    warning: 'bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-text)]/30',
    danger: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-text)]/30',
    accent: 'bg-[var(--accent)]/10 text-[var(--accent-text)] border-[var(--accent-text)]/30'
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-[4px] border tabular-nums',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Hairline-bordered flat container adhering strictly to DESIGN.md:
 * 0px radius, no drop shadow, warm canvas or soft surface.
 */
export function SectionBlock({
  title,
  marker = '[+]',
  action,
  description,
  children,
  className
}: {
  title: string;
  marker?: string;
  action?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border border-[var(--hairline)] bg-[var(--canvas)] rounded-none',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--hairline)] bg-[var(--surface-soft)]">
        <div>
          <h2 className="text-base font-bold text-[var(--ink)]">
            <span className="text-[var(--mute)] mr-2">{marker}</span>
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-[var(--mute)] mt-0.5">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function TabStrip<T extends string>({
  tabs,
  activeTab,
  onChange,
  label
}: {
  tabs: Array<{ id: T; label: string; badge?: string | number }>;
  activeTab: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex items-center gap-1 overflow-x-auto border-b border-[var(--hairline-strong)]"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-none border-b-2 transition-colors cursor-pointer min-h-[44px]',
              active
                ? 'text-[var(--ink)] border-[var(--ink)]'
                : 'text-[var(--mute)] border-transparent hover:text-[var(--ink)]'
            )}
          >
            {tab.label}
            {tab.badge !== undefined ? (
              <span className="ml-2 text-xs text-[var(--mute)] tabular-nums">[{tab.badge}]</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function AlertBanner({
  tone = 'info',
  title,
  message,
  action
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message: string;
  action?: React.ReactNode;
}) {
  const styles: Record<NonNullable<typeof tone>, { box: string; prefix: string }> = {
    info: { box: 'bg-[var(--surface-soft)] text-[var(--ink)] border-[var(--hairline-strong)]', prefix: '[i]' },
    success: { box: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-text)]/40', prefix: '[ok]' },
    warning: { box: 'bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-text)]/40', prefix: '[!]' },
    error: { box: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-text)]/40', prefix: '[err]' }
  };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border px-4 py-3 text-sm rounded-[4px]',
        styles[tone].box
      )}
    >
      <div className="space-y-0.5">
        <p className="font-medium">
          <span className="mr-2 font-bold">{styles[tone].prefix}</span>
          {title ?? message}
        </p>
        {title ? <p className="text-xs opacity-90">{message}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse bg-[var(--surface-card)] rounded-none', className)}
    />
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-[var(--hairline-strong)] bg-[var(--surface-soft)] p-6 text-left">
      <p className="text-sm font-bold text-[var(--ink)]">[-] {title}</p>
      <p className="text-sm text-[var(--body)] mt-1 max-w-prose">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Accessible native <dialog> confirmation modal per modern-web-guidance:
 * - Opened via showModal(), closedby="any" + pointer-rect fallback
 * - No role="dialog" or aria-modal (native modal supplies them)
 * - autofocus on safe Cancel action for destructive prompts
 * - Resets dialog.returnValue on close
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      const result = dialog.returnValue;
      dialog.returnValue = '';
      if (result === 'confirm') {
        void onConfirm();
      } else {
        onCancel();
      }
    };

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      pressedOutsideRef.current = isOutside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      if (pressedOutsideRef.current && isOutside(e)) {
        dialog.close('cancel');
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onConfirm, onCancel]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="space-y-4">
        <h2 id={titleId} className="text-base font-bold text-[var(--ink)]">
          [!] {title}
        </h2>
        <p className="text-sm text-[var(--body)]">{description}</p>
        <form method="dialog" className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="submit" value="cancel" variant="secondary" autoFocus>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            value="confirm"
            variant={destructive ? 'danger' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </form>
      </div>
    </dialog>
  );
}
