import { LoginForm } from "@/components/auth/login-form"
import { LoginVisual } from "@/components/auth/login-visual"
import { Card } from "@/components/ui/card"

export default function LoginPage() {
  return (
    <div className="w-full">
      <Card className="mx-auto w-full max-w-6xl overflow-hidden border-white/10 bg-card/95 shadow-[0_28px_75px_-36px_rgba(0,0,0,0.95)] lg:h-[72vh] lg:max-h-[72vh]">
        <div className="grid h-full grid-cols-1 lg:grid-cols-5">
          <section className="order-2 border-t border-white/10 bg-card/95 p-4 sm:p-5 lg:order-1 lg:col-span-2 lg:border-t-0 lg:border-r lg:p-5">
            <LoginForm />
          </section>
          <section className="order-1 min-h-[180px] lg:order-2 lg:col-span-3 lg:min-h-0">
            <LoginVisual />
          </section>
        </div>
      </Card>
    </div>
  )
}
