import { AppShell } from "@/components/layout/app-shell"
import { RunsTable } from "@/components/runs-table"
import { getRuns } from "@/lib/supabase/queries"

export default async function RunsPage() {
  const runs = await getRuns()

  return (
    <AppShell title="Runs">
      <RunsTable runs={runs} />
    </AppShell>
  )
}
