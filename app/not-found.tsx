import Link from "next/link"
import { LogoMark } from "@/components/logo"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center px-4">
        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
          <LogoMark size={28} className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">Page not found</h2>
          <p className="text-[13px] text-muted-foreground">
            {"The page you're looking for doesn't exist or has been moved."}
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" size="sm" className="text-[12px] font-medium h-8 border-border">
            Go to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  )
}
