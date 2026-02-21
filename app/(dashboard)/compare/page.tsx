import { AppShell } from "@/components/layout/app-shell"
import { CompareWorkbench } from "@/components/compare/compare-workbench"
import { getCompareRunBundles } from "@/lib/supabase/queries"

export const dynamic = "force-dynamic"

export default async function ComparePage() {
  const bundles = await getCompareRunBundles(40)

  return (
    <AppShell title="Compare">
      <CompareWorkbench bundles={bundles} />
    </AppShell>
  )
}
