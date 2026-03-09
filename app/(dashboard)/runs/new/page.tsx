import { AppShell } from "@/components/layout/app-shell"
import { PageContainer } from "@/components/layout/page-container"
import { RunForm } from "@/components/run-form"
import { getDataCoverage, getUserSettings, getTickerDateRanges } from "@/lib/supabase/queries"
import { computeUniverseValidFrom, ALL_UNIVERSES } from "@/lib/universe-config"

export default async function NewRunPage() {
  const [settings, coverage, tickerRanges] = await Promise.all([
    getUserSettings(),
    getDataCoverage(),
    getTickerDateRanges(),
  ])

  // Compute valid_from for each universe from DB truth
  const universeValidFrom = Object.fromEntries(
    ALL_UNIVERSES.map((u) => [u, computeUniverseValidFrom(u, tickerRanges)])
  ) as Record<string, string | null>

  const dataCoverage =
    coverage.minDate && coverage.maxDate
      ? { minDateStr: coverage.minDate, maxDateStr: coverage.maxDate }
      : null

  return (
    <AppShell title="New Run">
      <PageContainer size="narrow">
        <RunForm defaults={settings} dataCoverage={dataCoverage} universeValidFrom={universeValidFrom} />
      </PageContainer>
    </AppShell>
  )
}
