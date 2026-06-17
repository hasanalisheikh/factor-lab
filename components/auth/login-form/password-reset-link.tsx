"use client";

export function PasswordResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-white/45 hover:text-emerald-400 hover:underline"
    >
      Forgot password?
    </button>
  );
}
