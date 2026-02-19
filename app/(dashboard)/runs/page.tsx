import { AppShell } from "@/components/layout/app-shell"
import { RunsTable } from "@/components/runs-table"

export default function RunsPage() {
  return (
    <AppShell title="Runs">
      <RunsTable />
    </AppShell>
  )
}
