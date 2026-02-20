import Link from "next/link"
import { Plus } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import { RunsTable } from "@/components/runs-table"
import { getRuns } from "@/lib/supabase/queries"

export default async function RunsPage() {
  const runs = await getRuns()

  return (
    <AppShell title="Runs">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground font-mono">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
        </p>
        <Link href="/runs/new">
          <Button size="sm" className="h-8 text-[12px] font-medium">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Run
          </Button>
        </Link>
      </div>
      <RunsTable runs={runs} />
    </AppShell>
  )
}
