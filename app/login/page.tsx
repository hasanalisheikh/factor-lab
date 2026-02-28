import { LoginForm } from "@/components/auth/login-form"
import { LoginVisual } from "@/components/auth/login-visual"
import { Card } from "@/components/ui/card"

export default function LoginPage() {
  return (
    <div className="h-full w-full">
      <Card className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border-white/10 bg-card/95 shadow-[0_28px_75px_-36px_rgba(0,0,0,0.95)] lg:h-[72vh] lg:max-h-[72vh]">
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(120deg,rgba(8,11,17,0)_38%,rgba(8,11,17,0.86)_55%,rgba(10,15,22,1)_100%),radial-gradient(circle_at_86%_14%,rgba(40,199,130,0.2),transparent_40%),radial-gradient(circle_at_78%_86%,rgba(40,199,130,0.1),transparent_44%)]" />
        <div className="relative z-10 grid h-full grid-cols-1 lg:grid-cols-5">
          <section className="relative order-2 border-t border-white/10 bg-card/96 p-4 sm:p-5 lg:order-1 lg:col-span-2 lg:h-full lg:border-t-0 lg:border-r lg:p-4">
            <LoginForm />
            <p className="absolute bottom-4 left-4 text-xs text-white/45 sm:bottom-5 sm:left-5 lg:bottom-4 lg:left-4">
              FactorLab • Quant Research Dashboard
              <br />
              Not financial advice.
            </p>
          </section>
          <section className="order-1 min-h-[180px] overflow-hidden lg:order-2 lg:col-span-3 lg:h-full lg:min-h-0">
            <LoginVisual />
          </section>
        </div>
      </Card>
    </div>
  )
}
