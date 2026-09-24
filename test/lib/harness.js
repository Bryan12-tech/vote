// Shared bootstrap for the Votebook security test suite.
//
// Every test file that imports this gets, fully isolated:
//   * a dedicated PostgreSQL test database (`votebook_test` by default) created
//     and seeded by `server/seed.js` — the development database is never written
//     to, so `pnpm seed` data stays intact,
//   * the real API entry point (`server/index.js`) spawned as a child process on
//     a free port with a freshly generated random JWT_SECRET (never the value
//     from server/.env),
//   * API + database clients that `stop()` tears down together.
//
// Requires the local Postgres container:  docker start votebook-db
//
// Run the suite with:  pnpm test

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import pg from "pg"

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
)
const TEST_DB_NAME = process.env.TEST_DB_NAME || "votebook_test"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export const CENTRAL_FINANCE = "Central Finance"
export const DEMO_ADMIN = { username: "admin", password: "admin123" }
export const DEMO_OFFICER = { username: "officer1", password: "pass1234" }

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Connection strings ─────────────────────────────────────────────────────

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
  return env
}

function devDatabaseUrl() {
  const url =
    process.env.DATABASE_URL ||
    readEnvFile(path.join(ROOT, "server", ".env")).DATABASE_URL
  if (!url) {
    throw new Error(
      "No DATABASE_URL found. Put it in server/.env or export DATABASE_URL before running the security tests.",
    )
  }
  return url
}

// Same host/credentials, different database name.
export function databaseUrlFor(dbName) {
  const url = new URL(devDatabaseUrl())
  url.pathname = `/${dbName}`
  return url.toString()
}

// Mirrors server/db.js: managed providers need TLS, a local Docker database does not.
function sslFor(connectionString) {
  const { hostname } = new URL(connectionString)
  return LOCAL_HOSTS.has(hostname) ? false : { rejectUnauthorized: false }
}
// ── Test database + API process ────────────────────────────────────────────

// Rebuilds a *fresh* test database from the current schema on every suite run,
// so security tests never inherit columns or data from an older migration.
async function ensureTestDatabase() {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(TEST_DB_NAME)) {
    throw new Error(
      `TEST_DB_NAME "${TEST_DB_NAME}" must be a plain lowercase identifier (^[a-z_][a-z0-9_]*$).`,
    )
  }
  const adminUrl = databaseUrlFor("postgres")
  const client = new pg.Client({
    connectionString: adminUrl,
    ssl: sslFor(adminUrl),
  })
  try {
    await client.connect()
  } catch (err) {
    const detail = err?.message || err?.errors?.[0]?.code || err?.code || "connection failed"
    throw new Error(
      `Cannot reach PostgreSQL at ${new URL(adminUrl).host} (${detail}).\n` +
        "Start the local database first:  docker start votebook-db",
    )
  }
  try {
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`)
    await client.query(`CREATE DATABASE "${TEST_DB_NAME}"`)
    console.log(`[harness] rebuilt fresh test database "${TEST_DB_NAME}"`)
  } finally {
    await client.end()
  }
}

// Runs the production seed script against the test database (idempotent).
function runSeed(dbUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/seed.js"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk))
    child.stderr.on("data", (chunk) => (output += chunk))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve(output)
      else
        reject(new Error(`server/seed.js exited with code ${code}\n${output}`))
    })
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer()
    socket.unref()
    socket.on("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address()
      socket.close(() => resolve(port))
    })
  })
}

async function startApi({ dbUrl, jwtSecret }) {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      JWT_SECRET: jwtSecret,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let log = ""
  child.stdout.on("data", (chunk) => (log += chunk))
  child.stderr.on("data", (chunk) => (log += chunk))

  let exited = false
  child.on("exit", () => (exited = true))

  const deadline = Date.now() + 25_000
  for (;;) {
    if (exited)
      throw new Error(`server/index.js exited during startup:\n${log}`)
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) return { child, baseUrl, log: () => log }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${baseUrl}/api/health:\n${log}`)
    await sleep(150)
  }
}

function stopApi(server) {
  return new Promise((resolve) => {
    if (server.child.exitCode !== null || server.child.signalCode !== null)
      return resolve()
    server.child.once("exit", resolve)
    server.child.kill("SIGTERM")
    setTimeout(() => server.child.kill("SIGKILL"), 4000).unref()
  })
}

export async function bootstrap() {
  const dbUrl = databaseUrlFor(TEST_DB_NAME)
  await ensureTestDatabase()
  await runSeed(dbUrl)

  const jwtSecret = randomBytes(32).toString("hex")
  const server = await startApi({ dbUrl, jwtSecret })
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: sslFor(dbUrl),
    max: 4,
  })

  const handle = {
    baseUrl: server.baseUrl,
    dbUrl,
    jwtSecret,
    log: server.log,
    db: { query: (text, params) => pool.query(text, params) },
    stop: async () => {
      await pool.end().catch(() => {})
      await stopApi(server)
    },
  }
  handle.api = apiClient(server.baseUrl)
  return handle
}
// ── HTTP client ────────────────────────────────────────────────────────────

export function apiClient(baseUrl) {
  async function request(method, route, options = {}) {
    const headers = { ...(options.headers || {}) }
    const init = { method, headers }
    const canHaveBody = method !== "GET" && method !== "HEAD"
    if (options.body !== undefined && canHaveBody) {
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json"
      init.body =
        typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body)
    }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    if (options.authorization !== undefined)
      headers.Authorization = options.authorization

    const res = await fetch(`${baseUrl}${route}`, init)
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return {
      status: res.status,
      body,
      text,
      contentType: res.headers.get("content-type") || "",
    }
  }

  return {
    request,
    get: (route, options) => request("GET", route, options),
    post: (route, body, options = {}) =>
      request("POST", route, { ...options, body }),
    put: (route, body, options = {}) =>
      request("PUT", route, { ...options, body }),
    del: (route, options) => request("DELETE", route, options),
    login: (username, password) =>
      request("POST", "/api/login", { body: { username, password } }),
    async loginToken(username, password) {
      const res = await request("POST", "/api/login", {
        body: { username, password },
      })
      if (res.status !== 200 || !res.body?.token) {
        throw new Error(
          `Login failed for "${username}": HTTP ${res.status} ${JSON.stringify(res.body)}`,
        )
      }
      return res.body.token
    },
  }
}

// ── Token helpers (test-side forging attempts) ─────────────────────────────

export function signToken(payload, { secret, expiresIn } = {}) {
  return jwt.sign(payload, secret, expiresIn ? { expiresIn } : {})
}

// Re-encodes the payload of a real token while keeping its original signature:
// the classic privilege-escalation attempt (`role: "admin"` with a stolen token).
export function tamperTokenPayload(token, mutate) {
  const [header, payload, signature] = token.split(".")
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  mutate(claims)
  const forged = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  )
  return `${header}.${forged}.${signature}`
}

// `alg: "none"` forgery: unsigned token with attacker-chosen claims.
export function unsignedToken(claims) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
    "utf8",
  ).toString("base64url")
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  )
  return `${header}.${payload}.`
}

export function decodeClaims(token) {
  return JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  )
}

// ── Fixtures ───────────────────────────────────────────────────────────────

export async function createUser(api, adminToken, fields) {
  const res = await api.post("/api/users", fields, { token: adminToken })
  if (res.status !== 201) {
    throw new Error(
      `Fixture createUser failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.user
}

// Bypasses the API on purpose: used for states the API intentionally refuses to
// create (for example an admin row left at a non-Central-Finance station) and
// for inspecting stored password hashes.
export async function insertUserDirect(
  db,
  { username, password, name, role, station },
) {
  const hash = await bcrypt.hash(password, 10)
  const result = await db.query(
    `INSERT INTO users (username, password_hash, name, role, station)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name,
           role = EXCLUDED.role, station = EXCLUDED.station
     RETURNING id, username, name, role, station`,
    [username, hash, name, role, station],
  )
  return result.rows[0]
}

// Resets the open accounting period to a clean slate: no bank entries, no
// station allocations, no utilizations and no releases. The opening balance now
// lives on the open period (`cashbook_settings` is legacy and unused).
export async function resetCashbook(db, openingBalance = 0) {
  await db.query(
    "TRUNCATE vote_expenditures, vote_utilizations, vote_allocations, cashbook_entries RESTART IDENTITY",
  )
  await db.query(
    "UPDATE accounting_periods SET opening_bank_balance = $1 WHERE status = 'open'",
    [openingBalance.toFixed(2)],
  )
}

// Cash in Bank = the open period's opening balance + every credit − every release.
export async function currentBalance(db) {
  const result = await db.query(
    `SELECT COALESCE((SELECT opening_bank_balance FROM accounting_periods WHERE status = 'open' ORDER BY id DESC LIMIT 1), 0)
          + COALESCE((SELECT SUM(credit - debit) FROM cashbook_entries), 0) AS balance`,
  )
  return Number(result.rows[0].balance)
}

// ── Votebook flow fixtures: allocate → utilize → release ───────────────────

export async function allocateToStation(api, adminToken, fields = {}) {
  const res = await api.post(
    "/api/vote-allocations",
    {
      station: "Mkoani",
      amount: "1000.00",
      description: "Test allocation",
      ...fields,
    },
    { token: adminToken },
  )
  if (res.status !== 201) {
    throw new Error(
      `Fixture allocateToStation failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.allocation
}

export async function utilizeFunds(api, token, fields = {}) {
  const res = await api.post(
    "/api/vote-utilizations",
    {
      station: "Mkoani",
      voteCode: "22002101",
      amount: "100.00",
      description: "Test utilization",
      ...fields,
    },
    { token },
  )
  if (res.status !== 201) {
    throw new Error(
      `Fixture utilizeFunds failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.utilization
}

export async function releaseVote(api, token, fields = {}) {
  const res = await api.post(
    "/api/vote-releases",
    {
      payee: "Supplier Ltd",
      purpose: "Unit test payment",
      ...fields,
    },
    { token },
  )
  if (res.status !== 201) {
    throw new Error(
      `Fixture releaseVote failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body
}

// Convenience chain: funds a station and earmarks part of it to a vote item, so
// a test can go straight to the release step.
export async function fundStation(
  api,
  adminToken,
  officerToken,
  {
    station = "Mkoani",
    voteCode = "22002101",
    allocated = "1000.00",
    utilized = "100.00",
  } = {},
) {
  await allocateToStation(api, adminToken, { station, amount: allocated })
  return utilizeFunds(api, officerToken, { station, voteCode, amount: utilized })
}

export function uniqueUsername(prefix) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return `${prefix}_${suffix}`.slice(0, 32)
}
