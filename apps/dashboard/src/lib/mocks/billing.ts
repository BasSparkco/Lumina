// Mock for the Phase 5 "Billing/subscriptions" contract — there's no Stripe integration or
// billing/plan model on the backend yet (grepped: only `usePermissions().canManageBilling`
// exists, and it was unused before this page). Swap for real `req<T>()` calls once the backend
// exposes a plan/subscription endpoint and a Stripe Checkout session endpoint.
//
// "Upgrade" here completes instantly against localStorage rather than simulating a fake external
// redirect — Stripe Checkout is a real hosted page with a real webhook completing the purchase
// server-side, and faking that round-trip client-side would be more misleading than useful. Swap
// `upgrade()`'s body for a real "create Checkout session, redirect to its URL" call later.

export type PlanId = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export interface Plan {
  id: PlanId;
  screenLimit: number | null;
  priceMonthly: number;
}

export const PLANS: Plan[] = [
  { id: 'FREE', screenLimit: 3, priceMonthly: 0 },
  { id: 'STARTER', screenLimit: 10, priceMonthly: 29 },
  { id: 'PRO', screenLimit: 50, priceMonthly: 99 },
  { id: 'ENTERPRISE', screenLimit: null, priceMonthly: 299 },
];

export function planLimit(planId: PlanId): number | null {
  return PLANS.find(p => p.id === planId)?.screenLimit ?? null;
}

const STORAGE_KEY = 'lumina_mock_billing_plan';

// Testing-phase default: STARTER (10 screens) instead of FREE, so accounts aren't capped
// at 3 screens while the billing page is hidden. Revert to 'FREE' when billing comes back.
function loadPlan(): PlanId {
  if (typeof window === 'undefined') return 'STARTER';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return (raw as PlanId | null) ?? 'STARTER';
}

function savePlan(planId: PlanId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, planId);
}

const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

export const billingApi = {
  getCurrentPlan: async (): Promise<PlanId> => {
    await delay();
    return loadPlan();
  },
  upgrade: async (planId: PlanId): Promise<PlanId> => {
    await delay();
    savePlan(planId);
    return planId;
  },
};
