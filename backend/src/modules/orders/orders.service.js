const repo = require('./orders.repository');
const carrierClient = require('../../lib/carrierClient');
const AppError = require('../../lib/AppError');

const CACHE_TTL_MS = 60_000;

function isFresh(cachedAt) {
  return Date.now() - new Date(cachedAt).getTime() < CACHE_TTL_MS;
}

/**
 * Read-through cache:
 * serve from Postgres if fresh, otherwise hit the upstream carrier/order
 * system and refresh the cache.
 */
async function getCachedOrRefresh(externalOrderId) {
  const cached = await repo.findByExternalId(externalOrderId);

  if (cached && isFresh(cached.cachedAt)) {
    return cached;
  }

  const upstream = await carrierClient.fetchOrder(externalOrderId);

  return repo.upsertFromUpstream(externalOrderId, upstream);
}

/**
 * Authorization + audit logging live here so every caller gets the same rules.
 *
 * Customer:
 * - Email is required before any database/upstream lookup.
 * - Email must match the order's customer email.
 *
 * REP:
 * - No customer email check.
 * - Every successful lookup is logged with the rep's email.
 */
async function getOrderForActor({
  externalOrderId,
  actor,
  email,
  requestId,
  ipAddress,
}) {
  // Reject malformed customer requests BEFORE doing any database
  // or upstream work. This prevents an unnecessary cache refresh or
  // carrier call for a request that can never succeed.
  if (actor.type === 'CUSTOMER' && !email) {
    throw AppError.badRequest(
      'Email is required to look up an order',
      'EMAIL_REQUIRED'
    );
  }

  const order = await getCachedOrRefresh(externalOrderId);

  if (actor.type === 'CUSTOMER') {
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