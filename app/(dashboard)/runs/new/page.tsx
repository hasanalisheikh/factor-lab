"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Zap } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createRun, type CreateRunState } from "@/app/actions/runs"
import { STRATEGY_LABELS, type StrategyId } from "@/lib/types"

const STRATEGIES = Object.entries(STRATEGY_LABELS) as [StrategyId, string][]

export default function NewRunPage() {
  const [strategy, setStrategy] = useState<string>("")
  const [state, formAction, isPending] = useActionState<CreateRunState, FormData>(
    createRun,
    null
  )

  return (
    <AppShell title="New Run">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/runs">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Back to runs"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h2 className="text-base font-semibold text-foreground">New Backtest Run</h2>
      </div>

      <Card className="bg-card border-border max-w-lg">
        <CardHeader className="pb-3 px-5 pt-5">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Configure Run
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <form action={formAction} className="flex flex-col gap-4">
            {/* Hidden strategy input for FormData */}
            <input type="hidden" name="strategy_id" value={strategy} />

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="name"
                className="text-[12px] font-medium text-muted-foreground"
              >
                Run name
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Momentum 2015–2020"
                className="h-8 text-[13px] bg-secondary/40 border-border"
                required
              />
            </div>

            {/* Strategy */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Strategy
              </Label>
              <Select value={strategy} onValueChange={setStrategy} required>
                <SelectTrigger className="h-8 w-full text-[13px] bg-secondary/40 border-border">
                  <SelectValue placeholder="Select a strategy…" />
                </SelectTrigger>
                <SelectContent
                  portal={false}
                  position="popper"
                  sideOffset={4}
                  align="start"
                  collisionPadding={12}
                  className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]"
                >
                  {STRATEGIES.map(([id, label]) => (
                    <SelectItem key={id} value={id} className="text-[13px]">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="start_date"
                  className="text-[12px] font-medium text-muted-foreground"
                >
                  Start date
                </Label>
                <Input
                  id="start_date"
                  name="start_date"
                  type="date"
                  className="h-8 text-[13px] bg-secondary/40 border-border"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="end_date"
                  className="text-[12px] font-medium text-muted-foreground"
                >
                  End date
                </Label>
                <Input
                  id="end_date"
                  name="end_date"
                  type="date"
                  className="h-8 text-[13px] bg-secondary/40 border-border"
                  required
                />
              </div>
            </div>

            {/* Error message */}
            {state?.error && (
              <p className="text-[12px] text-destructive bg-destructive/8 border border-destructive/20 rounded-md px-3 py-2">
                {state.error}
              </p>
            )}

            {/* Submit */}
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !strategy}
              className="h-8 text-[12px] font-medium mt-1 w-full"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              {isPending ? "Queueing…" : "Queue Backtest"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  )
}
