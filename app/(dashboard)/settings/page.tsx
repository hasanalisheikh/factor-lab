import { AppShell } from "@/components/layout/app-shell";
import { PageContainer } from "@/components/layout/page-container";
import { SettingsForm } from "@/components/settings-form";
import { getUserSettings } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [settings, params] = await Promise.all([getUserSettings(), searchParams]);

  const userInfo = {
    id: user.id,
    email: user.email ?? "",
    is_guest: Boolean(user.user_metadata?.is_guest),
  };

  return (
    <AppShell title="Settings">
      <PageContainer size="medium">
        <SettingsForm defaults={settings} user={userInfo} defaultTab={params.tab} />
      </PageContainer>
    </AppShell>
  );
}
