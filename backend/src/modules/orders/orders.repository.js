const db = require('../../db/client');

async function findByExternalId(externalOrderId) {
  return db.order.findUnique({
    where: { externalOrderId },
    include: {
      items: true,
      returns: true,
      trackingEvents: {
        orderBy: { sequence: 'asc' },
      },
    },
  });
}

async function findById(id) {
  return db.order.findUnique({
    where: { id },
    include: {
      items: true,
      returns: true,
      trackingEvents: {
        orderBy: { sequence: 'asc' },
      },
    },
  });
}

/**
 * Upserts the cached order shell + replaces items/trackingEvents wholesale.
 *
 * The transaction contains only the writes that need to be atomic.
 * The final read happens after commit so it does not consume transaction
 * timeout budget.
 */
async function upsertFromUpstream(externalOrderId, upstreamData) {
  const { items, trackingEvents, ...orderFields } = upstreamData;

  const order = await db.$transaction(
    async (tx) => {
      const order = await tx.order.upsert({
        where: { externalOrderId },
        update: { ...orderFields },
        create: {
          externalOrderId,
          ...orderFields,
        },
      });

      await tx.orderItem.deleteMany({
        where: { orderId: order.id },
      });

      await tx.orderItem.createMany({
        data: items.map((item) => ({
          ...item,
          orderId: order.id,
        })),
      });

      await tx.trackingEvent.deleteMany({
        where: { orderId: order.id },
      });

      await tx.trackingEvent.createMany({
        data: trackingEvents.map((ev) => ({
          ...ev,
          orderId: order.id,
        })),
      });

      return order;
    },
    {
      timeout: 15_000,
      maxWait: 10_000,
    }
  );

  // Read only after the transaction has committed.
  return findById(order.id);
}

async function logLookup({
  orderId,
  actorType,
  repEmail,
  action,
  requestId,
  ipAddress,
}) {
  return db.lookupAuditLog.create({
    data: {
      orderId,
      actorType,
      repEmail,
      action,
      requestId,
      ipAddress,
    },
  });
}

module.exports = {
  findByExternalId,
  findById,
  upsertFromUpstream,
  logLookup,
};