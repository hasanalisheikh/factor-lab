export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="animate-in fade-in-0 duration-200 ease-out flex flex-col flex-1 min-w-0 overflow-hidden">
      {children}
    </div>
  )
}
