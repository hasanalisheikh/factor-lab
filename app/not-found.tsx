import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <div className="bg-secondary flex h-12 w-12 items-center justify-center rounded-xl">
          <LogoMark size={28} className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-base font-semibold">Page not found</h2>
          <p className="text-muted-foreground text-[13px]">
            {"The page you're looking for doesn't exist or has been moved."}
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" size="sm" className="border-border h-8 text-[12px] font-medium">
            Go to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
