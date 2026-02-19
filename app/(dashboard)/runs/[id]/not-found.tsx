import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { Button } from "@/components/ui/button"
import { LogoMark } from "@/components/logo"

export default function RunNotFound() {
  return (
    <>
      <Topbar title="Not Found" />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-4">
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
            <LogoMark size={28} className="text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">Run not found</h2>
            <p className="text-[13px] text-muted-foreground">
              {"The backtest run you're looking for doesn't exist or has been deleted."}
            </p>
          </div>
          <Link href="/runs">
            <Button variant="outline" size="sm" className="text-[12px] font-medium h-8 border-border">
              Back to Runs
            </Button>
          </Link>
        </div>
      </main>
    </>
  )
}
