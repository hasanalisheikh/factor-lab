import { AppShell } from "@/components/layout/app-shell"
import { ensureUniverseDataReady } from "@/app/actions/runs"
import { PageContainer } from "@/components/layout/page-container"
import { RunForm } from "@/components/run-form"
import { getDataCoverage, getUserSettings } from "@/lib/supabase/queries"
import type { UniverseId } from "@/lib/universe-config"

export const dynamic = "force-dynamic"

export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const diagnostics = params.diagnostics === "1"
  const [settings, coverage] = await Promise.all([
    getUserSettings(),
    getDataCoverage(),
  ])
  const defaultUniverse = (settings?.default_universe ?? "ETF8") as UniverseId
  const initialUniverseState = await ensureUniverseDataReady(defaultUniverse)

  const dataCoverage =
    coverage.minDate && coverage.maxDate
      ? { minDateStr: coverage.minDate, maxDateStr: coverage.maxDate }
      : null

  return (
    <AppShell title="New Run">
      <PageContainer size="narrow">
        <RunForm
          defaults={settings}
          dataCoverage={dataCoverage}
          initialUniverseState={initialUniverseState}
          diagnostics={diagnostics}
        />
      </PageContainer>
    </AppShell>
  )
}
