const db = require('../../db/client');

async function findByExternalId(externalOrderId) {
  return db.order.findUnique({
    where: { externalOrderId },
    include: {
      items: true,
      returns: true,
      trackingEvents: { orderBy: { sequence: 'asc' } },
    },
  });
}

/**
 * Upserts the cached order shell + replaces items/trackingEvents wholesale.
 * Wrapped in a transaction so a partial upstream response never leaves the
 * cache in a half-updated state.
 */
async function upsertFromUpstream(externalOrderId, upstreamData) {
  const { items, trackingEvents, ...orderFields } = upstreamData;

  return db.$transaction(async (tx) => {
    const order = await tx.order.upsert({
      where: { externalOrderId },
      update: { ...orderFields },
      create: { externalOrderId, ...orderFields },
    });

    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    await tx.orderItem.createMany({
      data: items.map((item) => ({ ...item, orderId: order.id })),
    });

    await tx.trackingEvent.deleteMany({ where: { orderId: order.id } });
    await tx.trackingEvent.createMany({
      data: trackingEvents.map((ev) => ({ ...ev, orderId: order.id })),
    });

    return tx.order.findUnique({
      where: { id: order.id },
      include: { items: true, returns: true, trackingEvents: { orderBy: { sequence: 'asc' } } },
    });
  });
}

async function logLookup({ orderId, actorType, repEmail, action, requestId, ipAddress }) {
  return db.lookupAuditLog.create({
    data: { orderId, actorType, repEmail, action, requestId, ipAddress },
  });
}

module.exports = { findByExternalId, upsertFromUpstream, logLookup };
