import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlanCatalog, getTrialDays } from "@/lib/plans/catalog";
import { pricedPlans, type PricedPlan } from "@/lib/utils/pricing";
import { MarketingNav } from "./_components/MarketingNav";
import { Hero } from "./_components/Hero";
import { IntegrationsBar } from "./_components/IntegrationsBar";
import { Features } from "./_components/Features";
import { Pricing } from "./_components/Pricing";
import { TrialInfo } from "./_components/TrialInfo";
import { MarketingFooter } from "./_components/MarketingFooter";

export default async function HomePage() {
  // Signed-in visitors go straight to the app — the same behaviour the old
  // src/app/page.tsx redirect gave them, except an incompletely-provisioned
  // self-serve signup goes back to /welcome instead of into the dashboard's
  // own login bounce. Keeping this means the marketing page only ever
  // renders logged-out, so it needs no signed-in header state.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const pendingCompany = user.user_metadata?.company_name as string | undefined;
    const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
    redirect(!tenantSchema && pendingCompany ? "/welcome" : "/dashboard");
  }

  const trialDays = await getTrialDays();
  let pricing: PricedPlan[] = [];
  try {
    pricing = pricedPlans((await getPlanCatalog()).filter((p) => p.visibility === "public"));
  } catch (err) {
    console.error("[marketing] plan catalog unavailable", err);
  }

  return (
    <>
      <MarketingNav />
      <main>
        <Hero trialDays={trialDays} />
        <IntegrationsBar />
        <Features />
        <Pricing plans={pricing} trialDays={trialDays} />
        <TrialInfo trialDays={trialDays} />
      </main>
      <MarketingFooter />
    </>
  );
}
