"use client";

import type { KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DesktopRunsTable } from "@/components/runs-table/desktop-runs-table";
import { MobileRunsList } from "@/components/runs-table/mobile-runs-list";
import { MOBILE_SORT_OPTIONS, sortRuns } from "@/components/runs-table/table-helpers";
import type {
  DesktopSortKey,
  MobileSortKey,
  RunsTableProps,
  SortDirection,
} from "@/components/runs-table/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function RunsTable({
  runs,
  searchQuery,
  progressMap = {},
  reportUrls = {},
}: RunsTableProps) {
  const router = useRouter();
  const [desktopSortKey, setDesktopSortKey] = useState<DesktopSortKey>("start_date");
  const [desktopSortDir, setDesktopSortDir] = useState<SortDirection>("desc");
  const [mobileSortKey, setMobileSortKey] = useState<MobileSortKey>("created_at");

  const desktopSortedRuns = useMemo(
    () => sortRuns(runs, desktopSortKey, desktopSortDir),
    [desktopSortDir, desktopSortKey, runs]
  );

  const mobileSortedRuns = useMemo(() => {
    const selectedSort =
      MOBILE_SORT_OPTIONS.find((option) => option.value === mobileSortKey) ??
      MOBILE_SORT_OPTIONS[0];
    return sortRuns(runs, selectedSort.value, selectedSort.direction);
  }, [mobileSortKey, runs]);

  const toggleSort = (key: DesktopSortKey) => {
    if (desktopSortKey === key) {
      setDesktopSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setDesktopSortKey(key);
    setDesktopSortDir("asc");
  };

  const openRun = (runId: string) => {
    router.push(`/runs/${runId}`);
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, runId: string) => {
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRun(runId);
  };

  return (
    <Card className="border-border bg-card md:overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="text-card-foreground text-[13px] font-medium">All Runs</CardTitle>
      </CardHeader>

      <MobileRunsList
        runs={mobileSortedRuns}
        searchQuery={searchQuery}
        mobileSortKey={mobileSortKey}
        progressMap={progressMap}
        reportUrls={reportUrls}
        onMobileSortChange={setMobileSortKey}
        onOpenRun={openRun}
        onCardKeyDown={handleCardKeyDown}
      />

      <DesktopRunsTable
        runs={runs}
        sortedRuns={desktopSortedRuns}
        searchQuery={searchQuery}
        progressMap={progressMap}
        onToggleSort={toggleSort}
      />
    </Card>
  );
}
