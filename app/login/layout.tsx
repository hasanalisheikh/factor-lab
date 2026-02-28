import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign In | FactorLab",
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="relative isolate flex min-h-screen items-start justify-center overflow-hidden bg-background px-4 pb-8 pt-8 sm:px-6 sm:pt-10 lg:px-10 lg:pt-[8vh]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_8%,rgba(40,199,130,0.1),transparent_42%),radial-gradient(circle_at_84%_88%,rgba(40,199,130,0.06),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%)]" />
      <div className="relative z-10 w-full max-w-6xl">{children}</div>
    </main>
  )
}
