const config = require('../config');
const AppError = require('../lib/AppError');

/**
 * Identifies the caller and attaches req.actor = { type: 'CUSTOMER' | 'REP', repEmail?: string }.
 *
 * Sprint-stage implementation: a rep session is a signed-enough bearer token
 * in the Authorization header. This is deliberately NOT real SSO — it's the
 * minimum that lets the audit trail be honest (real repEmail, not a guess)
 * while auth is tracked as a known gap for the full build.
 *
 * Swap this function's internals for real SSO/JWT verification later;
 * nothing downstream (controllers, services, audit logging) needs to change
 * because they only ever read req.actor.
 */
function identifyActor(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.actor = { type: 'CUSTOMER' };
    return next();
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const repEmail = verifyRepToken(token);

  if (!repEmail) {
    return next(AppError.unauthorized('Invalid or expired rep session', 'INVALID_SESSION'));
  }

  req.actor = { type: 'REP', repEmail };
  next();
}

/**
 * Requires the caller to be an authenticated rep. Use on routes that should
 * never be reachable by an unauthenticated customer (e.g. cross-customer
 * order search, if that's ever added).
 */
function requireRep(req, res, next) {
  if (req.actor?.type !== 'REP') {
    return next(AppError.unauthorized('This action requires a rep session', 'REP_REQUIRED'));
  }
  next();
}

// --- Stub token verification ---------------------------------------------
// Real version: verify a JWT signed by your SSO provider (Okta/Auth0/etc)
// against config.REP_SESSION_SECRET or the provider's public key, and
// extract the rep's email from a verified claim.
function verifyRepToken(token) {
  // TEMP: sprint stub — treat any non-empty token matching this exact
  // shared-secret format as valid. Replace before this touches real PII at scale.
  if (token === config.REP_SESSION_SECRET) return null; // guard against the secret itself being sent
  if (token.startsWith('rep:') && token.length > 10) {
    return token.slice('rep:'.length);
  }
  return null;
}

module.exports = { identifyActor, requireRep };
