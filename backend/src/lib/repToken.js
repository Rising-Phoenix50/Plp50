const crypto = require('crypto');
const config = require('../config');

/**
 * Signed rep session tokens: `<repEmail>.<expiresAtMs>.<hmacSignature>`.
 *
 * The email may contain dots, so verification parses the timestamp and
 * signature from the right-hand side rather than assuming the email contains
 * no separator characters.
 *
 * This replaces the old stub, which accepted ANY string shaped like
 * `rep:<email>` with zero verification — a full auth bypass
 * (see AUDIT_REPORT.md, C-1).
 *
 * This is still not real SSO — it's a symmetric shared-secret signature, so
 * anyone who has REP_SESSION_SECRET (i.e. your own backend config) can mint
 * tokens for any email. That's fine for internal use where the secret never
 * leaves your infrastructure, but the moment reps authenticate through a
 * real identity provider, replace signRepToken/verifyRepToken with real
 * JWT verification against that provider's keys — nothing outside this file
 * needs to change, since callers only ever see req.actor.
 */

const SEPARATOR = '.';

function sign(payload) {
  return crypto
    .createHmac('sha256', config.REP_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
}

function signRepToken(repEmail, ttlMs = 12 * 60 * 60 * 1000) {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${repEmail}${SEPARATOR}${expiresAt}`;
  const signature = sign(payload);

  return `${payload}${SEPARATOR}${signature}`;
}

/**
 * Returns the verified repEmail, or null if the token is malformed, expired,
 * or the signature doesn't match.
 *
 * The token is parsed from the right so email addresses such as
 * `agent@northstar.com` remain intact.
 *
 * Uses a constant-time comparison so token verification can't be timed
 * to leak information about the correct signature.
 */
function verifyRepToken(token) {
  const parts = typeof token === 'string' ? token.split(SEPARATOR) : [];

  // Need at least:
  //   repEmail + expiresAt + signature
  //
  // repEmail itself may contain dots, so there can be more than 3 parts.
  if (parts.length < 3) return null;

  const signature = parts.pop();
  const expiresAtStr = parts.pop();
  const repEmail = parts.join(SEPARATOR);

  const expiresAt = Number(expiresAtStr);

  if (!repEmail || !Number.isFinite(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;

  const expectedSignature = sign(
    `${repEmail}${SEPARATOR}${expiresAtStr}`
  );

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length) return null;

  if (!crypto.timingSafeEqual(provided, expected)) return null;

  return repEmail;
}

module.exports = {
  signRepToken,
  verifyRepToken,
};