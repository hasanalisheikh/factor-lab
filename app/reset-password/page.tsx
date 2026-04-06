import { ResetPasswordForm } from "@/components/auth/reset-password-form";

function parseSentAt(value?: string) {
  if (!value) {
    return undefined;
  }

  const sentAt = Number(value);
  return Number.isFinite(sentAt) && sentAt > 0 ? sentAt : undefined;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{
    email?: string;
    sent_at?: string;
  }>;
}) {
  const { email, sent_at: sentAt } = await searchParams;

  return <ResetPasswordForm initialEmail={email} initialSentAt={parseSentAt(sentAt)} />;
}
