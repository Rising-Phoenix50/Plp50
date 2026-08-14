const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// NOTE: these tests expect a real (test/dev) database reachable via DATABASE_URL,
// seeded via `npm run prisma:seed`. They're integration tests by design —
// the repository layer is thin enough that mocking it would just test the mock.

process.env.NODE_ENV = 'development';

let app, supertest, request;

before(async () => {
  supertest = require('supertest');
  app = require('../../src/app');
  request = supertest(app);
});

test('GET /api/orders/:orderId returns 400 for a malformed order ID', async () => {
  const res = await request.get('/api/orders/not-an-id').query({ email: 'user@example.com' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/orders/:orderId as customer requires email', async () => {
  const res = await request.get('/api/orders/NS-10492');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'EMAIL_REQUIRED');
});

test('GET /api/orders/:orderId as customer with wrong email returns 403', async () => {
  const res = await request.get('/api/orders/NS-10492').query({ email: 'wrong@example.com' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'EMAIL_MISMATCH');
});

test('GET /api/orders/:orderId as customer with correct email returns the order', async () => {
  const res = await request.get('/api/orders/NS-10492').query({ email: 'user@example.com' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.orderId, 'NS-10492');
  assert.ok(Array.isArray(res.body.data.trackingEvents));
});

test('GET /api/orders/:orderId as rep does not require email', async () => {
  const res = await request.get('/api/orders/NS-10492').set('Authorization', 'Bearer rep:agent@northstar.com');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.orderId, 'NS-10492');
});

test('GET /api/orders/:orderId for nonexistent order returns 404', async () => {
  const res = await request.get('/api/orders/NS-99999').query({ email: 'nobody@example.com' });
  assert.equal(res.status, 404);
});

after(async () => {
  const db = require('../../src/db/client');
  await db.$disconnect();
});
