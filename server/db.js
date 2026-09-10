import pg from "pg"

// Managed Postgres providers (e.g. Render) require TLS; the local Docker
// database does not. Enable SSL automatically for non-localhost hosts.
const connectionString = process.env.DATABASE_URL
const needsSsl =
  !!connectionString && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString)

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
})