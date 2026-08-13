const repo = require('./orders.repository');
const carrierClient = require('../../lib/carrierClient');
const AppError = require('../../lib/AppError');

const CACHE_TTL_MS = 60_000;

function isFresh(cachedAt) {
  return Date.now() - new Date(cachedAt).getTime() < CACHE_TTL_MS;
}

/**
 * Read-through cache: serve from Postgres if fresh, otherwise hit the
 * upstream carrier/order system and refresh the cache. The caller
 * (controller) doesn't know or care which path was taken.
 */
async function getCachedOrRefresh(externalOrderId) {
  const cached = await repo.findByExternalId(externalOrderId);
  if (cached && isFresh(cached.cachedAt)) return cached;

  const upstream = await carrierClient.fetchOrder(externalOrderId); // throws AppError.notFound if missing
  return repo.upsertFromUpstream(externalOrderId, upstream);
}

/**
 * Authorization + audit logging live here, not in the controller, so every
 * caller of this service gets the same rules regardless of route.
 *
 * - CUSTOMER actor: must supply the matching email, or gets a 403 (order
 *   exists but isn't theirs) — never a leaky "not found" that would let
 *   someone distinguish "wrong ID" from "wrong email" by response shape... actually
 *   we deliberately DO distinguish those (see controller), because order IDs
 *   aren't sensitive on their own; email ownership is what's being protected.
 * - REP actor: no email check — reps can look up any order, but every
 *   lookup is logged with their repEmail for the audit trail.
 */
async function getOrderForActor({ externalOrderId, actor, email, requestId, ipAddress }) {
  const order = await getCachedOrRefresh(externalOrderId);

  if (actor.type === 'CUSTOMER') {
    if (!email) {
      throw AppError.badRequest('Email is required to look up an order', 'EMAIL_REQUIRED');
    }
    if (order.customerEmail.toLowerCase() !== email.toLowerCase()) {
      await repo.logLookup({
        orderId: order.id,
        actorType: 'CUSTOMER',
        repEmail: null,
        action: 'ORDER_LOOKUP_DENIED',
        requestId,
        ipAddress,
      });
      throw AppError.forbidden(
        `Order ${externalOrderId} found, but the email doesn't match our records for this order.`,
        'EMAIL_MISMATCH'
      );
    }
  }

  await repo.logLookup({
    orderId: order.id,
    actorType: actor.type,
    repEmail: actor.type === 'REP' ? actor.repEmail : null,
    action: 'ORDER_LOOKUP',
    requestId,
    ipAddress,
  });

  return order;
}

module.exports = { getOrderForActor };
