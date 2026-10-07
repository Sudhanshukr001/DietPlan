import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { isValidElement } from 'react';
import { Check } from 'lucide-react';

/** Small presentational primitives shared by onboarding and today. */

type CardTone = 'plain' | 'accent' | 'warm' | 'calm' | 'alert';

const CARD_TONES: Record<CardTone, string> = {
  plain: '',
  accent: 'border-accent-line bg-accent-soft',
  warm: 'border-warm-line bg-warm-soft',
  calm: 'border-calm-line bg-calm-soft',
  alert: 'border-alert-line bg-alert-soft',
};

export function Card({
  children,
  className = '',
  tone = 'plain',
  interactive = false,
  as: Tag = 'section',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: CardTone;
  readonly interactive?: boolean;
  readonly as?: 'section' | 'article' | 'div' | 'li';
}): ReactNode {
  return (
    <Tag
      className={`card edge-light p-5 ${CARD_TONES[tone]} ${interactive ? 'lift' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
  icon,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-balance text-ink">
          {icon}
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Eyebrow label above a title — small, spaced, quiet. */
export function Eyebrow({ children, className = '' }: { readonly children: ReactNode; readonly className?: string }): ReactNode {
  return (
    <p className={`text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-3 ${className}`}>
      {children}
    </p>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  icon,
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'accent' | 'warm' | 'calm' | 'alert';
  readonly icon?: ReactNode;
}): ReactNode {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-2 text-ink-2 ring-1 ring-inset ring-line',
    accent: 'bg-accent-soft text-accent ring-1 ring-inset ring-accent-line',
    warm: 'bg-warm-soft text-warm ring-1 ring-inset ring-warm-line',
    calm: 'bg-calm-soft text-calm ring-1 ring-inset ring-calm-line',
    alert: 'bg-alert-soft text-alert ring-1 ring-inset ring-alert-line',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold ${tones[tone] ?? tones.neutral}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Emoji or icon in a soft tinted disc — gives every row a consistent anchor. */
export function Badge({
  children,
  tone = 'neutral',
  size = 'md',
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'accent' | 'warm' | 'calm' | 'plum';
  readonly size?: 'sm' | 'md' | 'lg';
}): ReactNode {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-2 text-ink',
    accent: 'bg-accent-soft text-accent',
    warm: 'bg-warm-soft text-warm',
    calm: 'bg-calm-soft text-calm',
    plum: 'bg-plum-soft text-plum',
  };
  const sizes: Record<string, string> = {
    sm: 'size-7 text-sm',
    md: 'size-9 text-lg',
    lg: 'size-12 text-2xl',
  };
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-xl ${sizes[size]} ${tones[tone] ?? tones.neutral}`}
    >
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[image:var(--gradient-accent)] text-[var(--color-accent-ink)] shadow-[var(--shadow-glow)] hover:brightness-[1.06] active:brightness-95',
  secondary:
    'border border-line-strong bg-surface text-ink shadow-card hover:border-ink-4 hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  quiet: 'bg-surface-2 text-ink hover:bg-surface-3',
  danger: 'border border-alert-line bg-alert-soft text-alert hover:bg-alert/10',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-10 gap-1.5 rounded-[var(--radius-sm)] px-3 text-[0.8125rem]',
  md: 'min-h-11 gap-2 rounded-[var(--radius-md)] px-4 text-sm',
  lg: 'min-h-12 gap-2.5 rounded-[var(--radius-md)] px-5 text-[0.9375rem]',
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  fullWidth = false,
  className = '',
  ...rest
}: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly className?: string;
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-label'?: string;
  readonly 'aria-pressed'?: boolean;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={rest['aria-expanded']}
      aria-label={rest['aria-label']}
      aria-pressed={rest['aria-pressed']}
      className={`press focus-ring inline-flex items-center justify-center font-semibold disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none ${
        BUTTON_SIZES[size]
      } ${BUTTON_VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Circular progress used for the headline "how is today going" number.
 * The number is exposed to assistive tech as text, not as an image.
 */
export function Ring({
  value,
  size = 132,
  stroke = 10,
  label,
  caption,
  tone = 'accent',
}: {
  /** 0..1 */
  readonly value: number;
  readonly size?: number;
  readonly stroke?: number;
  readonly label: string;
  readonly caption?: string;
  readonly tone?: 'accent' | 'calm' | 'warm';
}): ReactNode {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tones: Record<string, string> = {
    accent: 'stroke-[var(--color-accent)]',
    calm: 'stroke-[var(--color-calm)]',
    warm: 'stroke-[var(--color-warm)]',
  };
  const captionTones: Record<string, string> = {
    accent: 'text-accent',
    calm: 'text-calm',
    warm: 'text-warm',
  };
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(clamped * 100)}%${caption ? `. ${caption}` : ''}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden focusable="false">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={`${tones[tone]} transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out-soft)]`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`nums text-3xl font-semibold tracking-tight ${captionTones[tone]}`}>
          {Math.round(clamped * 100)}
          <span className="text-lg">%</span>
        </span>
        {caption ? (
          <span className="mt-0.5 max-w-[6.5rem] text-center text-[0.6875rem] leading-tight text-ink-3">
            {caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Meter({
  value,
  label,
  detail,
  tone = 'accent',
  suffix,
}: {
  /** 0..1 */
  readonly value: number;
  readonly label: string;
  readonly detail?: string;
  readonly tone?: 'accent' | 'calm' | 'warm';
  /** Shown instead of a bare percentage, e.g. "1.2 / 2 L". */
  readonly suffix?: string;
}): ReactNode {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tones: Record<string, string> = {
    accent: 'bg-[image:var(--gradient-accent)]',
    calm: 'bg-[image:var(--gradient-calm)]',
    warm: 'bg-[image:var(--gradient-warm)]',
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-medium text-ink">{label}</span>
        <span className="nums text-xs font-medium text-ink-3">
          {suffix ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div
        className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-[var(--ease-out-soft)] ${tones[tone] ?? tones.accent}`}
          style={{ width: `${pct}%` }}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 -left-1/3 w-1/3 bg-[image:var(--gradient-sheen)]"
            style={{ animation: 'sheen 2.6s var(--ease-out-soft) 0.4s infinite' }}
          />
        </div>
      </div>
      {detail ? <p className="mt-1 text-xs leading-relaxed text-ink-3">{detail}</p> : null}
    </div>
  );
}

/** A number worth noticing, with its unit set smaller beside it. */
export function Stat({
  value,
  unit,
  label,
  tone = 'plain',
}: {
  readonly value: string;
  readonly unit?: string;
  readonly label?: string;
  readonly tone?: 'plain' | 'accent' | 'alert';
}): ReactNode {
  const tones: Record<string, string> = {
    plain: 'text-ink',
    accent: 'text-accent',
    alert: 'text-alert',
  };
  return (
    <div>
      <p className={`nums text-lg font-semibold tracking-tight ${tones[tone] ?? tones.plain}`}>
        {value}
        {unit ? <span className="ml-0.5 text-xs font-medium text-ink-3">{unit}</span> : null}
      </p>
      {label ? <p className="text-[0.6875rem] uppercase tracking-wide text-ink-3">{label}</p> : null}
    </div>
  );
}

/** Selectable card used across onboarding: title, explanation, check state. */
export function Choice({
  title,
  description,
  selected,
  onClick,
}: {
  readonly title: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`press focus-ring flex w-full items-start gap-3 rounded-md border p-3.5 text-left ${
        selected
          ? 'border-accent bg-accent-soft shadow-[var(--shadow-card)]'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
          selected ? 'border-accent bg-accent text-[var(--color-accent-ink)]' : 'border-line-strong bg-surface'
        }`}
      >
        {selected ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{description}</span> : null}
      </span>
    </button>
  );
}

/** Compact toggle chip for multi-select lists. */
export function Chip({
  children,
  selected,
  onClick,
  tone = 'accent',
}: {
  readonly children: ReactNode;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly tone?: 'accent' | 'calm';
}): ReactNode {
  const on =
    tone === 'calm'
      ? 'border-calm bg-calm-soft text-calm shadow-[var(--shadow-card)]'
      : 'border-accent bg-accent-soft text-accent shadow-[var(--shadow-card)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`press focus-ring min-h-9 rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium ${
        selected ? on : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A `<label>` wraps its whole subtree: clicking the heading (or the hint)
 * activates whatever control it finds. That is right for a text input, and
 * wrong for a group of Choice/Chip buttons, where tapping the question silently
 * re-selected the *first* option and undid the user's answer. So the label is
 * only used when the children really are one control.
 */
function isNativeControl(children: ReactNode): boolean {
  if (!isValidElement(children)) return false;
  const type = children.type;
  return type === 'input' || type === 'select' || type === 'textarea';
}

export function Field({
  label,
  hint,
  children,
  control = false,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
  /** Force label semantics when the control is wrapped, e.g. by a ₹ prefix. */
  readonly control?: boolean;
}): ReactNode {
  const Tag = control || isNativeControl(children) ? 'label' : 'div';
  return (
    <Tag className="block">
      <span className="text-[0.8125rem] font-semibold text-ink">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{hint}</span> : null}
      <div className="mt-2">{children}</div>
    </Tag>
  );
}

export function Skeleton({ className = '' }: { readonly className?: string }): ReactNode {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden />;
}

/** Nothing-here state that still tells the user what to do next. */
export function EmptyState({
  icon,
  title,
  detail,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly detail?: string;
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2/60 px-4 py-8 text-center">
      {icon ? <span className="text-2xl" aria-hidden>{icon}</span> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {detail ? <p className="max-w-xs text-xs leading-relaxed text-ink-3">{detail}</p> : null}
    </div>
  );
}

/** Text-like inputs: name, city, numbers, times. Styled by the `.field` layer. */
export const inputClass = 'field min-h-11';

/** Dropdowns get our own chevron so they match the rest of the app. */
export const selectClass = 'field field-select min-h-11';

/** Type-safe passthrough for elements that need native button attributes. */
export type NativeButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
