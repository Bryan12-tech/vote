// Security suite 4/4 — data exposure and response hygiene.
//
// Verifies that no endpoint ever returns credential material, that every API
// response is JSON (so nothing falls through to the SPA/HTML path), that
// injection and traversal payloads in route parameters are inert, and that
// error responses never leak stack traces, filesystem paths or the JWT secret.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  bootstrap,
  createUser,
  DEMO_ADMIN,
  DEMO_OFFICER,
  resetCashbook,
  uniqueUsername,
} from "./lib/harness.js"

// Fingerprints of files that must never be reachable over HTTP.
const FILE_CONTENT = /root:x:|\[extensions\]|"devDependencies"|"private": true/

let ctx
let api
let adminToken
let officerToken

before(async () => {
  ctx = await bootstrap()
  api = ctx.api
  adminToken = await api.loginToken(DEMO_ADMIN.username, DEMO_ADMIN.password)
  officerToken = await api.loginToken(
    DEMO_OFFICER.username,
    DEMO_OFFICER.password,
  )
  await resetCashbook(ctx.db, 1000)
})

after(async () => {
  await ctx?.stop()
})

function assertNoSecretLeak(res, label) {
  const body = res.text
  assert.equal(
    body.toLowerCase().includes("password_hash"),
    false,
    `${label}: leaked password_hash`,
  )
  assert.equal(
    body.toLowerCase().includes("$2b$"),
    false,
    `${label}: leaked a bcrypt hash`,
  )
  assert.equal(
    body.includes(ctx.jwtSecret),
    false,
    `${label}: leaked the JWT secret`,
  )
  assert.equal(
    body.includes("/home/"),
    false,
    `${label}: leaked a filesystem path`,
  )
  assert.equal(
    body.includes("node_modules"),
    false,
    `${label}: leaked a dependency path`,
  )
}

describe("credential material", () => {
  it("never returns passwords or hashes from any user-facing endpoint", async () => {
    const username = uniqueUsername("sec4leak")
    const created = await createUser(api, adminToken, {
      username,
      password: "leaktest123",
      name: "Leak Test",
      role: "officer",
    })
    try {
      const responses = [
        ["login", await api.login(DEMO_ADMIN.username, DEMO_ADMIN.password)],
        ["users list", await api.get("/api/users", { token: adminToken })],
        ["bootstrap", await api.get("/api/bootstrap", { token: officerToken })],
        ["cashbook", await api.get("/api/cashbook", { token: officerToken })],
        [
          "create user",
          await api.post(
            "/api/users",
            {
              username: uniqueUsername("sec4leak2"),
              password: "x9".repeat(4),
              name: "N",
              role: "officer",
            },
            { token: adminToken },
          ),
        ],
        [
          "update user",
          await api.put(`/api/users/${username}`, { name: "Renamed" }, {
            token: adminToken,
          }),
        ],
        ["health", await api.get("/api/health")],
      ]
      for (const [label, res] of responses) {
        assertNoSecretLeak(res, label)
        assert.ok(res.status < 500, `${label} → ${res.status}`)
      }
      assert.equal(JSON.stringify(created).includes("leaktest123"), false)
    } finally {
      await ctx.db.query("DELETE FROM users WHERE username LIKE 'sec4leak%'")
    }
  })

  it("stores only a bcrypt hash at the documented cost, never the plaintext", async () => {
    const username = uniqueUsername("sec4hash")
    try {
      await createUser(api, adminToken, {
        username,
        password: "hashcheck123",
        name: "Hash Check",
        role: "officer",
      })
      const row = await ctx.db.query(
        "SELECT password_hash::text AS hash FROM users WHERE username = $1",
        [username],
      )
      const hash = row.rows[0].hash
      assert.match(
        hash,
        /^\$2[aby]\$10\$/,
        `unexpected hash format: ${hash.slice(0, 7)}`,
      )
      assert.equal(hash.includes("hashcheck123"), false)

      const plaintextRows = await ctx.db.query(
        "SELECT count(*) AS n FROM users WHERE password_hash = $1",
        ["hashcheck123"],
      )
      assert.equal(Number(plaintextRows.rows[0].n), 0)

      const bcrypt = (await import("bcryptjs")).default
      assert.equal(await bcrypt.compare("hashcheck123", hash), true)
      assert.equal(await bcrypt.compare("wrongpassword", hash), false)
    } finally {
      await ctx.db.query("DELETE FROM users WHERE username LIKE 'sec4hash%'")
    }
  })
})

describe("response format", () => {
  it("answers every API route — including 404s — as JSON, never HTML", async () => {
    const probes = [
      ["GET", "/api/does-not-exist"],
      ["POST", "/api/does-not-exist"],
      ["PUT", "/api/users/unknown/nested"],
      ["DELETE", "/api/unknown"],
      ["GET", "/api/users/extra/segments"],
      ["GET", "/api/cashbook/unknown"],
    ]
    for (const [method, route] of probes) {
      const res = await api.request(method, route, { body: {} })
      assert.equal(res.status, 404, `${method} ${route} → ${res.status}`)
      assert.match(
        res.contentType,
        /application\/json/,
        `${method} ${route} served ${res.contentType}`,
      )
      assert.equal(
        res.text.includes("<html"),
        false,
        `${method} ${route} served HTML`,
      )
    }
  })

  it("distinguishes `no session` (401) from `not allowed` (403)", async () => {
    const anonymous = await api.get("/api/users")
    const officer = await api.get("/api/users", { token: officerToken })
    assert.equal(anonymous.status, 401)
    assert.equal(officer.status, 403)
  })

  it("does not set cookies, so there is no ambient-authority CSRF vector", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: DEMO_ADMIN.username,
        password: DEMO_ADMIN.password,
      }),
    })
    assert.equal(res.status, 200)
    assert.equal(
      res.headers.get("set-cookie"),
      null,
      "login issued a cookie-based session",
    )

    // A browser-style cookie without the Authorization header must not authenticate.
    const noHeader = await api.get("/api/cashbook", {
      headers: { Cookie: "vbm_token=" + adminToken },
    })
    assert.equal(noHeader.status, 401)
  })
})
describe("route parameters and injected payloads", () => {
  it("treats user route parameters as data, never as SQL", async () => {
    const before = Number(
      (await ctx.db.query("SELECT count(*) AS n FROM users")).rows[0].n,
    )
    const payloads = [
      "' OR '1'='1",
      "admin'; DROP TABLE users; --",
      "admin--",
      "%' UNION SELECT password_hash FROM users --",
      'admin" --',
      "a".repeat(5000),
    ]
    for (const payload of payloads) {
      const route = `/api/users/${encodeURIComponent(payload)}`
      const removed = await api.del(route, { token: adminToken })
      const renamed = await api.put(route, { name: "Renamed" }, {
        token: adminToken,
      })
      for (const res of [removed, renamed]) {
        assert.ok(
          res.status === 404 || res.status === 400,
          `payload ${payload.slice(0, 24)} → ${res.status}`,
        )
        assert.ok(
          res.status < 500,
          `payload ${payload.slice(0, 24)} produced a server error`,
        )
      }
    }
    const after = Number(
      (await ctx.db.query("SELECT count(*) AS n FROM users")).rows[0].n,
    )
    assert.equal(
      after,
      before,
      "the users table changed after injection attempts",
    )
    const admin = await ctx.db.query(
      "SELECT role FROM users WHERE username = $1",
      [DEMO_ADMIN.username],
    )
    assert.equal(
      admin.rows[0].role,
      "admin",
      "the administrator row was modified",
    )
  })

  it("rejects encoded traversal sequences without touching the filesystem", async () => {
    const probes = [
      "/api/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/api/users/..%2F..%2Fetc%2Fpasswd",
      "/api/users/%2e%2e%5C%2e%2e%5Cwindows%5Cwin.ini",
      "/api/users/%00admin",
      "/api/users/..",
      "/api/%2e%2e%2fpackage.json",
    ]
    for (const route of probes) {
      const res = await api.get(route, { token: adminToken })
      assert.ok(
        res.status === 404 || res.status === 400,
        `${route} → ${res.status} ${res.text.slice(0, 120)}`,
      )
      assert.equal(
        FILE_CONTENT.test(res.text),
        false,
        `${route} leaked file contents`,
      )
    }
  })

  it("serves the SPA shell for unknown GETs instead of repository files", async () => {
    // The Express static layer must only ever expose dist/, never server/.env,
    // the git metadata or the source tree.
    for (const route of [
      "/package.json",
      "/server/.env",
      "/server/index.js",
      "/.git/config",
      "/tsconfig.json",
    ]) {
      const res = await api.get(route)
      assert.equal(
        FILE_CONTENT.test(res.text),
        false,
        `${route} exposed file contents`,
      )
      assert.equal(
        /JWT_SECRET|DATABASE_URL/.test(res.text),
        false,
        `${route} exposed environment values`,
      )
    }
  })
})

describe("error hygiene", () => {
  it("returns validation errors without stacks, SQL fragments or paths", async () => {
    const res = await api.post(
      "/api/cashbook/payments",
      {
        voteCode: "nope",
        amount: "-1",
        station: "Nope",
        payee: "",
        purpose: "",
      },
      { token: officerToken },
    )
    assert.equal(res.status, 400)
    assertNoSecretLeak(res, "validation error")
    assert.doesNotMatch(
      res.text,
      /\n\s+at\s/,
      "response contains a stack trace",
    )
    assert.doesNotMatch(
      res.text,
      /\.js:\d+/,
      "response contains a source reference",
    )
    assert.equal(res.text.includes("SELECT"), false, "response contains SQL")
    assert.equal(
      res.text.includes("pg_"),
      false,
      "response contains a database object name",
    )
  })

  it("stores free text verbatim and returns it as JSON, leaving escaping to the renderer", async () => {
    const payload = "<script>alert('xss')</script>"
    const res = await api.post(
      "/api/cashbook/payments",
      {
        voteCode: "22002101",
        amount: "1.00",
        payee: payload,
        purpose: payload,
        station: "Mkoani",
      },
      { token: officerToken },
    )
    assert.equal(res.status, 201)
    assert.match(res.contentType, /application\/json/)
    assert.equal(res.body.entry.payee, payload)
    // JSON is not an HTML context, so the raw characters are expected here; the
    // React client escapes them on render. Asserting it keeps the contract explicit.
    assert.equal(res.text.includes("<script>"), true)
    assert.equal(res.text.includes("&lt;script&gt;"), false)
  })
})

describe("documented behaviour and remaining gaps", () => {
  it("exposes only the health probe on public routes", async () => {
    const res = await api.get("/api/health")
    assert.equal(Object.keys(res.body).length, 1)
  })

  // Hardening backlog:
  it.todo("returns a generic message for 500s instead of the raw err.message")
  it.todo(
    "sets hardening headers (X-Content-Type-Options, X-Frame-Options, CSP) on served HTML and JSON",
  )
  it.todo(
    "rejects NUL and control characters in path parameters before they reach the driver",
  )
  it.todo(
    "writes security events (failed logins, admin actions) to an append-only log",
  )
})
