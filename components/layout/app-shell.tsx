import { Topbar } from "@/components/layout/topbar"

export function AppShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <>
      <Topbar title={title} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col gap-4 max-w-[1440px]">
          {children}
        </div>
      </main>
    </>
  )
}
