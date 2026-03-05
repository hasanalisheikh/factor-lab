import Link from "next/link"
import { Plus } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import { RunsTable } from "@/components/runs-table"
import { RunsSearchBar } from "@/components/runs-search-bar"
import { ActiveRunsPoller } from "@/components/active-runs-poller"
import { getRuns, getRunsCount } from "@/lib/supabase/queries"

export const revalidate = 0

type PageProps = {
  searchParams: Promise<{ q?: string; status?: string; strategy?: string; universe?: string }>
}

export default async function RunsPage({ searchParams }: PageProps) {
  const { q, status, strategy, universe } = await searchParams
  const filters = {
    search: q,
    status,
    strategy,
    universe,
  }
  const [runs, totalRuns] = await Promise.all([
    getRuns({ limit: 75, ...filters }),
    getRunsCount(filters),
  ])

  const hasActiveRuns = runs.some((r) => r.status === "queued" || r.status === "running")

  return (
    <AppShell title="Runs">
      <ActiveRunsPoller hasActiveRuns={hasActiveRuns} />
      <div className="mx-auto w-full max-w-[1200px] flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <RunsSearchBar defaultQuery={q} />
          <div className="flex items-center gap-3 shrink-0">
            <p className="text-[12px] text-muted-foreground font-mono hidden sm:block">
              {runs.length} of {totalRuns} run{totalRuns !== 1 ? "s" : ""}
            </p>
            <Link href="/runs/new">
              <Button size="sm" className="h-8 text-[12px] font-medium">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                New Run
              </Button>
            </Link>
          </div>
        </div>
        <RunsTable runs={runs} searchQuery={q} />
      </div>
    </AppShell>
  )
}
