import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/shared";
import { HeroSection } from "@/components/marketing/hero";
import { ProblemSection } from "@/components/marketing/problem";
import { SolutionSection } from "@/components/marketing/solution";
import { FeaturesSection } from "@/components/marketing/features";
import { HowItWorksSection } from "@/components/marketing/how-it-works";
import { TokenOptimizationSection } from "@/components/marketing/token-optimization";
import { PhoneControlSection } from "@/components/marketing/phone-control";
import { SafetySection } from "@/components/marketing/safety";
import { WarRoomSection } from "@/components/marketing/war-room-section";
import { UseCasesSection } from "@/components/marketing/use-cases";
import { FinalCTASection } from "@/components/marketing/final-cta";

// The public marketing site. Static-friendly: no session, no fleet data — pure presentation.
export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main id="main">
        <HeroSection />
        <ProblemSection />
        <SolutionSection />
        <FeaturesSection />
        <HowItWorksSection />
        <TokenOptimizationSection />
        <PhoneControlSection />
        <SafetySection />
        <WarRoomSection />
        <UseCasesSection />
        <FinalCTASection />
      </main>
      <MarketingFooter />
    </>
  );
}
