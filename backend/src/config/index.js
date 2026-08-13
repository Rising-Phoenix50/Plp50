require('dotenv').config();

const { z } = require('zod');

// Validate environment variables once at startup.
// The application fails fast if required configuration is missing or malformed.
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),

  NODE_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development'),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (pooled Neon connection string)'),

  DIRECT_URL: z
    .string()
    .min(1, 'DIRECT_URL is required (direct Neon connection string, used by migrations)'),

  // Upstream carrier / order-of-record system
  CARRIER_API_KEY: z
    .string()
    .min(1, 'CARRIER_API_KEY is required'),

  CARRIER_API_BASE_URL: z
    .string()
    .url('CARRIER_API_BASE_URL must be a valid URL'),

  // Authentication
  REP_SESSION_SECRET: z
    .string()
    .min(16, 'REP_SESSION_SECRET must be at least 16 characters'),

  // CORS
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((val) =>
      val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Deliberately not using the app logger here — logger configuration
  // may itself depend on environment variables.
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = parsed.data;