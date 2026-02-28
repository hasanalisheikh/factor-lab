import { Card } from "@/components/ui/card"

export function LoginVisual() {
  return (
    <div className="relative flex h-full w-full min-h-[220px] items-center justify-center overflow-hidden p-4 sm:p-5 lg:min-h-0 lg:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_74%_18%,rgba(40,199,130,0.1),transparent_42%),radial-gradient(circle_at_20%_78%,rgba(40,199,130,0.05),transparent_45%)]" />

      <Card className="relative mx-auto w-full max-w-[86%] border-white/25 bg-black/25 p-3 shadow-[0_30px_70px_-35px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-4 lg:p-5">
        <div className="absolute -right-10 -top-10 size-28 rounded-full bg-primary/20 blur-2xl" />
        <div className="absolute -bottom-8 -left-10 size-24 rounded-full bg-primary/15 blur-2xl" />

        <svg
          viewBox="0 0 700 440"
          role="img"
          aria-label="Isometric quant dashboard illustration"
          className="relative w-full max-h-[46vh] lg:max-h-[52vh]"
        >
          <defs>
            <linearGradient id="panelA" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#28c782" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#1a9f66" stopOpacity="0.78" />
            </linearGradient>
            <linearGradient id="panelB" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#172129" />
              <stop offset="100%" stopColor="#101720" />
            </linearGradient>
          </defs>

          <polygon points="100,280 320,220 555,285 340,352" fill="#0c1318" stroke="#2f3e35" />
          <polygon points="100,280 100,332 340,404 340,352" fill="#121b24" stroke="#34483d" />
          <polygon points="340,352 340,404 555,340 555,285" fill="#162330" stroke="#3a5345" />

          <polygon points="215,250 295,230 367,249 288,268" fill="url(#panelA)" />
          <polygon points="215,250 215,286 288,309 288,268" fill="#1ea16b" />
          <polygon points="288,268 288,309 367,286 367,249" fill="#37be84" />

          <polygon points="396,237 471,218 536,236 462,254" fill="#20382e" />
          <polygon points="396,237 396,266 462,287 462,254" fill="#172920" />
          <polygon points="462,254 462,287 536,265 536,236" fill="#2b4a3d" />

          <rect x="150" y="82" width="264" height="136" rx="12" fill="url(#panelB)" stroke="#385245" />
          <path d="M174 176 L214 147 L242 156 L275 124 L312 132 L344 106 L391 118" fill="none" stroke="#6de9b0" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="391" cy="118" r="6" fill="#6de9b0" />
          <rect x="170" y="103" width="86" height="15" rx="7" fill="#47b983" fillOpacity="0.35" />
          <rect x="170" y="126" width="120" height="12" rx="6" fill="#2f7d5d" fillOpacity="0.62" />

          <rect x="446" y="112" width="122" height="146" rx="14" fill="#101922" stroke="#385245" />
          <path d="M507 145 L524 159 V183 C524 213 507 233 507 233 C507 233 490 213 490 183 V159 L507 145Z" fill="#1a4535" stroke="#63d8a3" strokeWidth="2" />
          <path d="M494 192 L503 182 L509 187 L522 173" fill="none" stroke="#89f5c2" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="468" y="118" width="78" height="10" rx="5" fill="#5fcfa0" fillOpacity="0.3" />
        </svg>

        <p className="mt-1 text-center text-xs font-medium tracking-[0.01em] text-white/62 sm:text-sm">
          Backtest. Compare. Report.
        </p>
      </Card>
    </div>
  )
}
