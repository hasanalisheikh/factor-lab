import { AppShell } from "@/components/layout/app-shell"
import { CompareWorkbench } from "@/components/compare/compare-workbench"
import { getCompareRunBundles, getStrategyComparisonRuns } from "@/lib/supabase/queries"

export const dynamic = "force-dynamic"

export default async function ComparePage() {
  const [bundles, strategyRuns] = await Promise.all([
    getCompareRunBundles(40),
    getStrategyComparisonRuns(),
  ])

  return (
    <AppShell title="Compare">
      <CompareWorkbench bundles={bundles} strategyRuns={strategyRuns} />
    </AppShell>
  )
}
