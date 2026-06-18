import { ArrowUpDown } from "lucide-react";

import type { DesktopSortKey } from "./types";

export function SortHeader({
  label,
  sort,
  onToggle,
}: {
  label: string;
  sort: DesktopSortKey;
  onToggle: (key: DesktopSortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(sort)}
      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}
