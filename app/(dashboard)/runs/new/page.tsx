import { AppShell } from "@/components/layout/app-shell"
import { PageContainer } from "@/components/layout/page-container"
import { RunForm } from "@/components/run-form"
import { getUserSettings } from "@/lib/supabase/queries"

export default async function NewRunPage() {
  const settings = await getUserSettings()

  return (
    <AppShell title="New Run">
      <PageContainer size="narrow">
        <RunForm defaults={settings} />
      </PageContainer>
    </AppShell>
  )
}
