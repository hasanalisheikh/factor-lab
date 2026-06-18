import {
  CommonFrameworkSection,
  LimitationsSection,
  MetricsGlossarySection,
  RebalanceMechanicsSection,
  StrategiesSection,
} from "@/app/(dashboard)/strategies/_components/strategy-sections";
import { AppShell } from "@/components/layout/app-shell";
import { PageContainer } from "@/components/layout/page-container";

export default function StrategiesPage() {
  return (
    <AppShell title="Strategies">
      <PageContainer size="medium">
        <div className="mb-6">
          <h1 className="text-foreground text-xl font-semibold">
            Strategy Glossary &amp; Methodology
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[13px]">
            How FactorLab strategies are constructed, executed, and measured. All strategies share
            the same equal-weight reporting framework, while factor strategies rebalance monthly and
            ML strategies rebalance daily.
          </p>
        </div>

        <CommonFrameworkSection />
        <StrategiesSection />
        <RebalanceMechanicsSection />
        <MetricsGlossarySection />
        <LimitationsSection />
      </PageContainer>
    </AppShell>
  );
}
