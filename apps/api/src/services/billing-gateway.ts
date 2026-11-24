import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CREDIT_PACKS,
  PLAN_CATALOG,
  type BillingCurrency,
  type CheckoutResponse,
  type CreateCheckoutRequest,
  type CreditPackId,
  type PaymentProvider,
  type PlanId
} from '@jobpilot/shared';
import type { ApiConfig } from '../config.js';
import type { DataStore } from '../store/types.js';
import { buildBillingSnapshot } from './entitlements.js';

export interface BillingCheckoutParams {
  userId: string;
  userEmail?: string;
  request: CreateCheckoutRequest;
  config: ApiConfig;
  store: DataStore;
  fetchImpl?: typeof fetch;
}

function safeHexOrBase64Equal(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyWebhookSignature(params: {
  provider: PaymentProvider;
  rawBody: string;
  signatureHeader: string | undefined;
  config: ApiConfig;
}): boolean {
  const { provider, rawBody, signatureHeader, config } = params;
  if (!signatureHeader) return false;

  if (provider === 'razorpay') {
    if (!config.razorpayWebhookSecret) return false;
    const expected = createHmac('sha256', config.razorpayWebhookSecret)
      .update(rawBody)
      .digest('hex');
    return safeHexOrBase64Equal(expected, signatureHeader.trim());
  }

  if (provider === 'dodo') {
    if (!config.dodoWebhookSecret) return false;
    const expected = createHmac('sha256', config.dodoWebhookSecret)
      .update(rawBody)
      .digest('hex');
    return safeHexOrBase64Equal(expected, signatureHeader.trim());
  }

  if (provider === 'stripe') {
    if (!config.stripeWebhookSecret) return false;
    // Stripe-Signature format: t=timestamp,v1=sig
    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});
    const ts = parts['t'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;
    const expected = createHmac('sha256', config.stripeWebhookSecret)
      .update(`${ts}.${rawBody}`)
      .digest('hex');
    return safeHexOrBase64Equal(expected, v1);
  }

  return false;
}

export async function createBillingCheckout(
  params: BillingCheckoutParams
): Promise<CheckoutResponse> {
  const { userId, request, config, store } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  if (request.kind === 'plan' && request.planId === 'free') {
    await store.applyPlanChange(userId, {
      planId: 'free',
      currency: request.currency,
      paymentProvider: 'manual',
      metadata: { source: 'self_downgrade' }
    });
    const snapshot = await buildBillingSnapshot(userId, config, store);
    return {
      mode: 'instant_demo',
      checkoutUrl: null,
      message: 'Switched to the Free plan (25 monthly Fast AI credits).',
      snapshot
    };
  }

  // If live Stripe checkout is configured and demo billing is off, create a Stripe Checkout Session.
  if (!config.allowDemoBilling && config.stripeSecretKey) {
    const currencyCode = request.currency.toLowerCase();
    const isPlan = request.kind === 'plan';
    const plan = isPlan ? PLAN_CATALOG[request.planId] : null;
    const pack = !isPlan ? CREDIT_PACKS[request.packId] : null;

    const unitAmount = isPlan
      ? (request.currency === 'INR' ? plan!.priceInr : plan!.priceUsd) * 100
      : (request.currency === 'INR' ? pack!.priceInr : pack!.priceUsd) * 100;

    const mode = plan?.billingInterval === 'monthly' ? 'subscription' : 'payment';
    const productName = isPlan ? `JobPilot ${plan!.name}` : `JobPilot ${pack!.name}`;

    const form = new URLSearchParams();
    form.set('mode', mode);
    form.set('success_url', `${config.webBaseUrl}/billing?checkout=success`);
    form.set('cancel_url', `${config.webBaseUrl}/billing?checkout=cancelled`);
    if (params.userEmail) form.set('customer_email', params.userEmail);
    form.set('metadata[userId]', userId);
    form.set('metadata[kind]', request.kind);
    form.set('metadata[currency]', request.currency);
    if (isPlan) {
      form.set('metadata[planId]', request.planId);
    } else {
      form.set('metadata[packId]', request.packId);
    }
    form.set('line_items[0][price_data][currency]', currencyCode);
    form.set('line_items[0][price_data][unit_amount]', String(unitAmount));
    form.set('line_items[0][price_data][product_data][name]', productName);
    if (mode === 'subscription') {
      form.set('line_items[0][price_data][recurring][interval]', 'month');
    }
    form.set('line_items[0][quantity]', '1');

    const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Payment checkout session failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const sessionJson = (await res.json()) as { url?: string };
    const snapshot = await buildBillingSnapshot(userId, config, store);
    return {
      mode: 'redirect',
      checkoutUrl: sessionJson.url ?? null,
      message: 'Redirecting to Stripe Checkout...',
      snapshot
    };
  }

  if (!config.allowDemoBilling) {
    throw new Error(
      'No live payment gateway is configured on this server (set STRIPE_SECRET_KEY or ALLOW_DEMO_BILLING=true).'
    );
  }

  // Instant sandbox / demo checkout mode
  if (request.kind === 'plan') {
    const plan = PLAN_CATALOG[request.planId];
    await store.applyPlanChange(userId, {
      planId: request.planId,
      currency: request.currency,
      paymentProvider: 'manual',
      metadata: { source: 'demo_checkout' }
    });
    const snapshot = await buildBillingSnapshot(userId, config, store);
    return {
      mode: 'instant_demo',
      checkoutUrl: null,
      message: `Activated ${plan.name} (${plan.monthlyCredits} credits).`,
      snapshot
    };
  }

  const pack = CREDIT_PACKS[request.packId];
  await store.grantTopupCredits(userId, {
    packId: request.packId,
    credits: pack.credits,
    paymentProvider: 'manual',
    metadata: { source: 'demo_checkout', currency: request.currency }
  });
  const snapshot = await buildBillingSnapshot(userId, config, store);
  return {
    mode: 'instant_demo',
    checkoutUrl: null,
    message: `Added ${pack.credits} non-expiring top-up credits.`,
    snapshot
  };
}

export async function processVerifiedWebhookEvent(params: {
  provider: PaymentProvider;
  payload: Record<string, unknown>;
  store: DataStore;
}): Promise<{ handled: boolean; message: string }> {
  const { provider, payload, store } = params;

  const metadata =
    (payload['metadata'] as Record<string, unknown> | undefined) ??
    ((payload['data'] as Record<string, unknown> | undefined)?.['object'] as
      | Record<string, unknown>
      | undefined)?.['metadata'] as Record<string, unknown> | undefined;

  if (!metadata || typeof metadata['userId'] !== 'string') {
    return { handled: false, message: 'No userId metadata on webhook event.' };
  }

  const userId = metadata['userId'];
  const kind = metadata['kind'];
  const currency = (metadata['currency'] === 'USD' ? 'USD' : 'INR') as BillingCurrency;

  if (kind === 'plan' && typeof metadata['planId'] === 'string') {
    const planId = metadata['planId'] as PlanId;
    if (planId in PLAN_CATALOG) {
      await store.applyPlanChange(userId, {
        planId,
        currency,
        paymentProvider: provider,
        metadata: { source: `webhook:${provider}` }
      });
      return { handled: true, message: `Applied plan ${planId} for ${userId}` };
    }
  }

  if (kind === 'topup' && typeof metadata['packId'] === 'string') {
    const packId = metadata['packId'] as CreditPackId;
    if (packId in CREDIT_PACKS) {
      await store.grantTopupCredits(userId, {
        packId,
        credits: CREDIT_PACKS[packId].credits,
        paymentProvider: provider,
        metadata: { source: `webhook:${provider}`, currency }
      });
      return { handled: true, message: `Granted ${packId} for ${userId}` };
    }
  }

  return { handled: false, message: 'Unhandled webhook metadata payload.' };
}
