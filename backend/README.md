# Northstar Support Backend

## Setup

```bash
npm install
cp .env.example .env   # fill in your Neon connection strings + secrets
npm run prisma:generate
npm run prisma:migrate   # creates tables via DIRECT_URL
npm run prisma:seed      # loads NS-10492 / NS-20871 demo data
npm run dev               # http://localhost:3001
```

Neon setup notes:
- Grab **two** connection strings from the Neon dashboard: the pooled one (`-pooler` in the hostname) for `DATABASE_URL`, and the direct one for `DIRECT_URL`. Migrations fail against the pooled connection — this is the single most common setup mistake.
- Add `?sslmode=require` to both if it isn't already there.

## Auth model

Every request gets a `req.actor`:
- No `Authorization` header → `{ type: 'CUSTOMER' }`. Must pass `?email=` on GET requests / `email` in POST bodies, checked against the order's `customerEmail`.
- `Authorization: Bearer rep:<email>` → `{ type: 'REP', repEmail }`. No email-match check; every lookup is still logged with their `repEmail` for audit.

This is a **sprint-stage stub**, not real SSO — see the TODO in `src/middleware/auth.js`. It's wired end-to-end so the audit log is honest from day one, but the token verification itself needs to be swapped for real SSO/JWT verification before this handles real PII in production.

## API contract

All responses: `{ data: {...}, requestId: "..." }` on success, `{ error: { code, message, requestId, details? } }` on failure. `requestId` is also echoed as the `X-Request-Id` response header.

### `GET /api/orders/:orderId`
Query: `?email=` (required for customers, optional for reps)

```json
{
  "data": {
    "orderId": "NS-10492",
    "placedOn": "2026-08-08T00:00:00.000Z",
    "carrier": "FedEx",
    "trackingNumber": "48000250030662",
    "eta": "2026-08-14T00:00:00.000Z",
    "status": "SHIPPED",
    "items": [{ "name": "...", "sku": "...", "status": "DELIVERED" }],
    "returns": null,
    "trackingEvents": [
      { "title": "...", "location": "...", "latitude": 38.25, "longitude": -85.75, "occurredAt": "...", "state": "DONE" }
    ]
  },
  "requestId": "..."
}
```

Error codes: `VALIDATION_ERROR` (400), `EMAIL_REQUIRED` (400), `EMAIL_MISMATCH` (403), `ORDER_NOT_FOUND` (404), `RATE_LIMITED` (429).

### `POST /api/returns/:orderId`
Body: `{ "reason": "wrong_size" | "wrong_item" | "damaged" | "no_longer_needed" | "quality_issue" | "other", "email": "..." }`

```json
{
  "data": { "status": "REQUESTED", "reason": "wrong_size", "initiatedAt": "...", "estimatedRefundAt": null },
  "requestId": "..."
}
```

Error codes: as above, plus `RETURN_ALREADY_EXISTS` (400, includes `details.existingStatus`).

## What's deliberately still stubbed for this sprint
- `src/lib/carrierClient.js` — hardcoded mock data standing in for Northstar's real order system. Swap `fetchOrder` for a real HTTP call; nothing above it changes.
- `src/middleware/auth.js` — rep "sessions" are a shared-secret-prefixed string, not real SSO.
- No Redis — the 60s cache TTL lives in Postgres itself (`cachedAt` column), fine at this scale.
