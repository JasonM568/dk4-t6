"use client";

export function ConfirmSubmitButton({ label, message, className }: { label: string; message: string; className: string }) {
  return <button type="submit" className={className} onClick={(event) => { if (!confirm(message)) event.preventDefault(); }}>{label}</button>;
}
