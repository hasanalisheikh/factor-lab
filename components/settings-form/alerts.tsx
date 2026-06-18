import { Check } from "lucide-react";

export function ErrorAlert({ message }: { message: string }) {
  return (
    <p className="text-destructive bg-destructive/8 border-destructive/20 rounded-md border px-3 py-2 text-[12px]">
      {message}
    </p>
  );
}

export function SuccessAlert({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-md border border-emerald-800/40 bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-400">
      <Check className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}
