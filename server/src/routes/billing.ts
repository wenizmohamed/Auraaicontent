// Stripe checkout + customer portal + webhook receiver. Activated when
// STRIPE_SECRET_KEY is present in env; otherwise the routes return 503 so
// the rest of the app keeps booting in dev/local.
//
// Trials: a 14-day trial is created on register (auth.ts). When the trial
// expires the org drops to 'free' until the user completes Stripe Checkout.
// The webhook flips the plan back up on subscription.updated.

import { errStatus, errMessage } from '../services/providers/errors.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard, requireOrgRole } from '../middleware/auth.js';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER,
  studio: process.env.STRIPE_PRICE_STUDIO,
  agency: process.env.STRIPE_PRICE_AGENCY,
};
const APP_URL = process.env.PREVIEW_URL || 'http://localhost:3200';

// Lazy-import Stripe — keeps the dep tree light when Stripe isn't configured.
async function getStripe() {
  if (!STRIPE_KEY) return null;
  const { default: Stripe } = await import('stripe');
  return new Stripe(STRIPE_KEY);
}

function planFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === PRICE_IDS.starter) return 'starter';
  if (priceId === PRICE_IDS.studio) return 'studio';
  if (priceId === PRICE_IDS.agency) return 'agency';
  return null;
}

export async function billingRoutes(app: FastifyInstance) {

  // POST /api/billing/checkout — create a Stripe Checkout Session.
  // Body: { plan: 'starter' | 'studio' | 'agency' }
  app.post('/checkout', { preHandler: [authGuard, requireOrgRole('OWNER', 'ADMIN')] }, async (request, reply) => {
    const stripe = await getStripe();
    if (!stripe) return reply.status(503).send({ error: 'Billing not configured' });

    const { plan } = (request.body as { plan?: string }) || {};
    const orgId = request.orgId!;
    const priceId = plan ? PRICE_IDS[plan as keyof typeof PRICE_IDS] : null;
    if (!priceId) return reply.status(400).send({ error: 'Unknown plan' });

    const org = await db.organization.findUnique({ where: { id: orgId }, select: { stripeCustomerId: true, name: true } });
    if (!org) return reply.status(404).send({ error: 'Organization not found' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/settings/billing?success=1`,
      cancel_url: `${APP_URL}/settings/billing?canceled=1`,
      customer: org.stripeCustomerId || undefined,
      customer_email: org.stripeCustomerId ? undefined : request.user?.email,
      client_reference_id: orgId,
      metadata: { orgId },
      subscription_data: { metadata: { orgId } },
    });

    return { url: session.url };
  });

  // POST /api/billing/portal — Stripe Customer Portal session
  app.post('/portal', { preHandler: [authGuard, requireOrgRole('OWNER', 'ADMIN')] }, async (request, reply) => {
    const stripe = await getStripe();
    if (!stripe) return reply.status(503).send({ error: 'Billing not configured' });

    const orgId = request.orgId!;
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { stripeCustomerId: true } });
    if (!org?.stripeCustomerId) return reply.status(400).send({ error: 'No Stripe customer for this org' });

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${APP_URL}/settings/billing`,
    });
    return { url: session.url };
  });

  // POST /api/billing/webhook — Stripe webhook receiver. Validates the
  // signature against STRIPE_WEBHOOK_SECRET and flips Organization.plan/status.
  // No authGuard: Stripe's signature IS the auth.
  app.post('/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const stripe = await getStripe();
    if (!stripe) return reply.status(503).send({ error: 'Billing not configured' });
    if (!WEBHOOK_SECRET) return reply.status(503).send({ error: 'Webhook secret not configured' });

    const sig = request.headers['stripe-signature'] as string | undefined;
    if (!sig) return reply.status(400).send({ error: 'Missing signature' });

    const raw = (request.body as any) ?? {};
    const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw);

    let event: import('stripe').Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawString, sig, WEBHOOK_SECRET);
    } catch (err) {
      return reply.status(400).send({ error: `Invalid signature: ${errMessage(err)}` });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as import('stripe').Stripe.Checkout.Session;
        const orgId = s.metadata?.orgId || s.client_reference_id;
        if (orgId) {
          await db.organization.update({
            where: { id: orgId },
            data: { stripeCustomerId: s.customer as string },
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as import('stripe').Stripe.Subscription;
        const orgId = sub.metadata?.orgId;
        const priceId = sub.items.data[0]?.price.id;
        const plan = planFromPriceId(priceId);
        if (orgId && plan) {
          await db.organization.update({
            where: { id: orgId },
            data: { plan, status: sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status },
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as import('stripe').Stripe.Subscription;
        const orgId = sub.metadata?.orgId;
        if (orgId) {
          await db.organization.update({
            where: { id: orgId },
            data: { plan: 'free', status: 'canceled' },
          });
        }
        break;
      }
    }

    return reply.send({ received: true });
  });
}
