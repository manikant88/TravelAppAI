import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "text" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      type={type}
      className={cx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)}
    />
  );
}

export function IconButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={cx("ui-icon-button", className)} />;
}

export type BadgeTone = "info" | "success" | "warning" | "danger" | "neutral";

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; children: ReactNode }) {
  return <span {...props} className={cx("ui-badge", `ui-badge--${tone}`, className)}>{children}</span>;
}

export function Chip({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} variant="secondary" size="sm" className={cx("ui-chip", className)} />;
}

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <article {...props} className={cx("ui-card", className)}>{children}</article>;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("ui-field", className)}>
      <span className="ui-field__label">{label}</span>
      {children}
      {hint ? <small className="ui-field__hint">{hint}</small> : null}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("ui-input", className)} />;
}
