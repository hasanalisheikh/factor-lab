import { AppShell } from "@/components/layout/app-shell"
import { PageContainer } from "@/components/layout/page-container"
import { RunForm } from "@/components/run-form"
import { getDataCoverage, getUserSettings } from "@/lib/supabase/queries"

export default async function NewRunPage() {
  const [settings, coverage] = await Promise.all([
    getUserSettings(),
    getDataCoverage(),
  ])

  const dataCoverage =
    coverage.minDate && coverage.maxDate
      ? { minDateStr: coverage.minDate, maxDateStr: coverage.maxDate }
      : null

  return (
    <AppShell title="New Run">
      <PageContainer size="narrow">
        <RunForm defaults={settings} dataCoverage={dataCoverage} />
      </PageContainer>
    </AppShell>
  )
}
