import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo";

export default function RunNotFound() {
  return (
    <>
      <Topbar title="Not Found" />
      <main className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-4 text-center">
          <div className="bg-secondary flex h-12 w-12 items-center justify-center rounded-xl">
            <LogoMark size={28} className="text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-foreground text-base font-semibold">Run not found</h2>
            <p className="text-muted-foreground text-[13px]">
              {"The backtest run you're looking for doesn't exist or has been deleted."}
            </p>
          </div>
          <Link href="/runs">
            <Button
              variant="outline"
              size="sm"
              className="border-border h-8 text-[12px] font-medium"
            >
              Back to Runs
            </Button>
          </Link>
        </div>
      </main>
    </>
  );
}
