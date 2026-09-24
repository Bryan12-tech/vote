// Security suite 1/4 — authentication and session security.
//
// Covers the `auth` middleware in server/index.js, JWT forgery attempts, the
// login endpoint and the request parser. Every test runs against the real API
// process and the isolated `votebook_test` database (see test/lib/harness.js).

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  bootstrap,
  CENTRAL_FINANCE,
  DEMO_ADMIN,
  DEMO_OFFICER,
  decodeClaims,
  signToken,
  tamperTokenPayload,
  unsignedToken,
} from "./lib/harness.js"

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
})

after(async () => {
  await ctx?.stop()
})

const PROTECTED_ENDPOINTS = [
  ["GET", "/api/bootstrap"],
  ["GET", "/api/cashbook"],
  ["GET", "/api/vote-cashbook"],
  ["POST", "/api/vote-utilizations"],
  ["POST", "/api/vote-releases"],
  ["POST", "/api/cashbook/credits"],
  ["PUT", "/api/cashbook/opening-balance"],
  ["GET", "/api/users"],
  ["POST", "/api/users"],
  ["PUT", "/api/users/admin"],
  ["DELETE", "/api/users/admin"],
]

function assertRejected(res, label) {
  assert.equal(
    res.status,
    401,
    `${label}: expected 401, got ${res.status} ${res.text.slice(0, 200)}`,
  )
  assert.equal(
    typeof res.body?.error,
    "string",
    `${label}: expected a JSON error body`,
  )
  assert.match(
    res.contentType,
    /application\/json/,
    `${label}: expected a JSON content type`,
  )
}

function adminClaims(overrides = {}) {
  return {
    username: DEMO_ADMIN.username,
    name: "Forged Admin",
    role: "admin",
    station: CENTRAL_FINANCE,
    ...overrides,
  }
}

describe("unauthenticated access", () => {
  for (const [method, route] of PROTECTED_ENDPOINTS) {
    it(`rejects ${method} ${route} without a token`, async () => {
      const res = await api.request(method, route, { body: {} })
      assertRejected(res, `${method} ${route}`)
    })
  }

  it("keeps /api/health public and free of internal detail", async () => {
    const res = await api.get("/api/health")
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true })
  })

  it("accepts a real session token on protected endpoints", async () => {
    const res = await api.get("/api/cashbook", { token: officerToken })
    assert.equal(res.status, 200)
  })
})

describe("JWT verification", () => {
  it("rejects a token signed with a different secret", async () => {
    const forged = signToken(adminClaims(), {
      secret: "not-the-real-secret",
      expiresIn: "12h",
    })
    assertRejected(
      await api.get("/api/users", { token: forged }),
      "wrong secret",
    )
  })

  it("rejects a tampered payload carrying an upgraded role", async () => {
    // Officer takes their own valid token and rewrites the claims to admin.
    const forged = tamperTokenPayload(officerToken, (claims) => {
      claims.role = "admin"
      claims.station = CENTRAL_FINANCE
    })
    assertRejected(
      await api.get("/api/users", { token: forged }),
      "tampered payload",
    )
  })

  it("rejects an unsigned `alg: none` token", async () => {
    const forged = unsignedToken(adminClaims())
    assertRejected(await api.get("/api/users", { token: forged }), "alg none")
  })

  it("rejects an asymmetric-algorithm token (algorithm confusion)", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
      "utf8",
    ).toString("base64url")
    const payload = Buffer.from(JSON.stringify(adminClaims()), "utf8").toString(
      "base64url",
    )
    const forged = `${header}.${payload}.ZmFrZS1zaWduYXR1cmU`
    assertRejected(await api.get("/api/users", { token: forged }), "alg RS256")
  })

  it("rejects an expired token", async () => {
    const expired = signToken(
      { ...adminClaims(), exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: ctx.jwtSecret },
    )
    assertRejected(
      await api.get("/api/cashbook", { token: expired }),
      "expired token",
    )
  })

  it("rejects malformed tokens without crashing", async () => {
    for (const token of [
      "",
      "not-a-jwt",
      "a.b",
      "a.b.c.d",
      "....",
      "eyJhbGciOiJIUzI1NiJ9.broken",
    ]) {
      const res = await api.get("/api/cashbook", { token })
      assert.ok(
        res.status === 401 || res.status === 400,
        `token ${JSON.stringify(token)} → ${res.status}`,
      )
      assert.ok(
        res.status < 500,
        `token ${JSON.stringify(token)} produced a server error: ${res.text.slice(0, 200)}`,
      )
    }
  })

  it("requires exactly the `Bearer` scheme", async () => {
    for (const authorization of [
      officerToken,
      `bearer ${officerToken}`,
      `Token ${officerToken}`,
      `Bearer${officerToken}`,
      "Bearer ",
    ]) {
      const res = await api.get("/api/cashbook", { authorization })
      assertRejected(res, `Authorization: ${authorization.slice(0, 12)}…`)
    }
  })

  it("issues tokens with a 12h lifetime and no credential material", async () => {
    const claims = decodeClaims(adminToken)
    assert.equal(claims.username, DEMO_ADMIN.username)
    assert.equal(claims.role, "admin")
    assert.equal(claims.station, CENTRAL_FINANCE)
    assert.equal(claims.exp - claims.iat, 12 * 60 * 60)
    assert.equal(
      JSON.stringify(claims).toLowerCase().includes("password"),
      false,
    )
  })

  // Hardening backlog — these failures should become enforced assertions once fixed:
  it.todo("rate-limits repeated failed logins (currently unlimited attempts)")
  it.todo(
    "revokes outstanding tokens when a password changes, a role changes or a user is deleted",
  )
  it.todo(
    'pins jwt.verify to `algorithms: ["HS256"]` instead of relying on jsonwebtoken defaults',
  )
})

describe("login endpoint", () => {
  it("returns a session for valid credentials without exposing secrets", async () => {
    const res = await api.login(DEMO_ADMIN.username, DEMO_ADMIN.password)
    assert.equal(res.status, 200)
    assert.equal(typeof res.body.token, "string")
    assert.deepEqual(Object.keys(res.body).sort(), ["token", "user"])
    assert.deepEqual(Object.keys(res.body.user).sort(), [
      "name",
      "role",
      "station",
      "username",
    ])
    assert.equal(res.body.user.role, "admin")
    assert.equal(res.body.user.station, CENTRAL_FINANCE)
    assert.equal(res.text.toLowerCase().includes("password"), false)
  })

  it("gives officers an all-stations session scope", async () => {
    const res = await api.login(DEMO_OFFICER.username, DEMO_OFFICER.password)
    assert.equal(res.status, 200)
    assert.equal(res.body.user.role, "officer")
    assert.equal(res.body.user.station, "All Stations")
  })

  it("does not reveal whether a username exists", async () => {
    const unknown = await api.login("no_such_user_9911", "whatever")
    const wrongPassword = await api.login(
      DEMO_ADMIN.username,
      "definitely-wrong",
    )
    assert.equal(unknown.status, 401)
    assert.equal(wrongPassword.status, 401)
    assert.equal(unknown.body.error, wrongPassword.body.error)
  })

  it("is not vulnerable to SQL injection in the username", async () => {
    const before = Number(
      (await ctx.db.query("SELECT count(*) AS n FROM users")).rows[0].n,
    )
    for (const username of [
      "admin' OR '1'='1",
      "admin'--",
      "'; DROP TABLE users; --",
      `admin" OR "1"="1`,
      "\\' OR 1=1",
    ]) {
      const res = await api.login(username, "anything")
      assert.equal(res.status, 401, `${username} → ${res.status}`)
    }
    const after = Number(
      (await ctx.db.query("SELECT count(*) AS n FROM users")).rows[0].n,
    )
    assert.equal(after, before, "users table changed after injection attempts")
  })

  it("tolerates non-string credentials without a server error", async () => {
    for (const password of [
      {},
      [],
      123,
      true,
      null,
      { toString: "admin123" },
    ]) {
      const res = await api.post("/api/login", {
        username: DEMO_ADMIN.username,
        password,
      })
      assert.equal(
        res.status,
        401,
        `password ${JSON.stringify(password)} → ${res.status}`,
      )
    }
    for (const username of [{}, [], 0, true, null]) {
      const res = await api.post("/api/login", {
        username,
        password: DEMO_ADMIN.password,
      })
      assert.ok(
        res.status === 401 || res.status === 400,
        `username ${JSON.stringify(username)} → ${res.status}`,
      )
    }
  })

  it("is not vulnerable to prototype pollution in the request body", async () => {
    const res = await api.post(
      "/api/login",
      '{"username":"admin","__proto__":{"polluted":true},"password":"x"}',
    )
    assert.equal(res.status, 401)
    assert.equal({}.polluted, undefined)
    assert.equal(Object.prototype.polluted, undefined)
  })

  it("rejects malformed JSON with a 400 and no stack trace", async () => {
    const res = await api.post("/api/login", '{"username": "admin", ')
    assert.equal(res.status, 400)
    assert.equal(res.contentType.includes("application/json"), true)
    assert.equal(
      res.text.includes("    at "),
      false,
      "response leaked a stack trace",
    )
    assert.equal(
      res.text.includes("node_modules"),
      false,
      "response leaked internal paths",
    )
  })

  it("caps request body size instead of buffering unbounded input", async () => {
    const res = await api.post("/api/login", {
      username: "admin",
      password: "x".repeat(200_000),
    })
    assert.equal(res.status, 413)
  })
})

// Known information-disclosure trade-off: the login screen calls this to lock the
// station field for administrator accounts, so it answers whether a username
// exists and which role it holds, without any credentials. It leaks no password
// material, but it is a user-enumeration oracle — see the suite README.
describe("documented behaviour: /api/auth/role is a public username oracle", () => {
  it("reports the role of an existing username and null otherwise", async () => {
    const known = await api.get(
      `/api/auth/role?username=${DEMO_ADMIN.username}`,
    )
    const unknown = await api.get("/api/auth/role?username=nobody_here_1234")
    assert.equal(known.status, 200)
    assert.equal(known.body.role, "admin")
    assert.deepEqual(unknown.body, { role: null })
  })
})
