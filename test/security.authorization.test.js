// Security suite 2/4 — authorization: who may do what.
//
// Pins the two server-side guards in server/index.js (`auth` +
// `requireCentralFinanceAdmin`), the admin-only user management surface and the
// self-protection rules that keep the last administrator from being removed.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  bootstrap,
  CENTRAL_FINANCE,
  createUser,
  DEMO_ADMIN,
  DEMO_OFFICER,
  fundStation,
  releaseVote,
  resetCashbook,
  signToken,
  uniqueUsername,
} from "./lib/harness.js"

let ctx
let api
let adminToken
let officerToken

const ADMIN_ONLY = [
  ["GET", "/api/users"],
  ["POST", "/api/users"],
  ["PUT", "/api/users/officer1"],
  ["DELETE", "/api/users/officer1"],
  ["POST", "/api/cashbook/credits"],
  ["PUT", "/api/cashbook/opening-balance"],
  ["POST", "/api/vote-allocations"],
  ["POST", "/api/accounting-periods/close"],
]

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

function assertForbidden(res, label) {
  assert.equal(
    res.status,
    403,
    `${label}: expected 403, got ${res.status} ${res.text.slice(0, 200)}`,
  )
  assert.equal(
    typeof res.body?.error,
    "string",
    `${label}: expected a JSON error body`,
  )
  assert.match(res.contentType, /application\/json/)
}

describe("officer sessions", () => {
  for (const [method, route] of ADMIN_ONLY) {
    it(`cannot call ${method} ${route}`, async () => {
      const res = await api.request(method, route, {
        token: officerToken,
        body: {},
      })
      assertForbidden(res, `${method} ${route}`)
    })
  }

  it("can still read the reference data and the cashbook", async () => {
    const bootstrapRes = await api.get("/api/bootstrap", {
      token: officerToken,
    })
    const cashbookRes = await api.get("/api/cashbook", { token: officerToken })
    assert.equal(bootstrapRes.status, 200)
    assert.equal(cashbookRes.status, 200)
    assert.ok(Array.isArray(bootstrapRes.body.stations))
    assert.ok(Array.isArray(bootstrapRes.body.voteItems))
  })

  it("can utilize and release a vote for any station (the documented shared model)", async () => {
    await resetCashbook(ctx.db, 5000)
    const utilization = await fundStation(api, adminToken, officerToken)
    assert.equal(utilization.station, "Mkoani")
    assert.equal(utilization.officer, DEMO_OFFICER.username)
    const res = await releaseVote(api, officerToken, {
      utilizationId: utilization.id,
      amount: "100.00",
    })
    assert.equal(res.expenditure.station, "Mkoani")
    assert.equal(res.entry.station, "Mkoani")
    assert.equal(res.entry.officer, DEMO_OFFICER.username)
    assert.equal(res.entry.debit, 100)
  })
})

describe("forged elevated sessions", () => {
  // The guard requires BOTH claims: role === "admin" AND station === Central Finance.
  const cases = [
    [
      "admin role without Central Finance",
      {
        username: DEMO_OFFICER.username,
        name: "X",
        role: "admin",
        station: "Wete",
      },
    ],
    [
      "Central Finance without the admin role",
      {
        username: DEMO_OFFICER.username,
        name: "X",
        role: "officer",
        station: CENTRAL_FINANCE,
      },
    ],
    [
      "neither claim",
      {
        username: DEMO_OFFICER.username,
        name: "X",
        role: "officer",
        station: "All Stations",
      },
    ],
  ]

  for (const [label, claims] of cases) {
    it(`is rejected with a signed token holding ${label}`, async () => {
      const token = signToken(claims, {
        secret: ctx.jwtSecret,
        expiresIn: "12h",
      })
      assertForbidden(await api.get("/api/users", { token }), label)
      assertForbidden(
        await api.post(
          "/api/cashbook/credits",
          { amount: "1", description: "x" },
          { token },
        ),
        label,
      )
      assertForbidden(
        await api.put("/api/cashbook/opening-balance", { amount: 1 }, {
          token,
        }),
        label,
      )
    })
  }

  it("allows a properly signed Central Finance admin session (guard sanity check)", async () => {
    const token = signToken(
      {
        username: DEMO_ADMIN.username,
        name: "Admin",
        role: "admin",
        station: CENTRAL_FINANCE,
      },
      { secret: ctx.jwtSecret, expiresIn: "12h" },
    )
    const res = await api.get("/api/users", { token })
    assert.equal(res.status, 200)
  })
})

describe("privilege escalation through the user API", () => {
  it("an officer cannot reset an administrator's password", async () => {
    const res = await api.put(
      `/api/users/${DEMO_ADMIN.username}`,
      { password: "hacked12345" },
      { token: officerToken },
    )
    assertForbidden(res, "officer password reset")

    const hacked = await api.login(DEMO_ADMIN.username, "hacked12345")
    const genuine = await api.login(DEMO_ADMIN.username, DEMO_ADMIN.password)
    assert.equal(hacked.status, 401)
    assert.equal(genuine.status, 200)
  })

  it("an officer cannot mint an administrator account", async () => {
    const username = uniqueUsername("sec2mint")
    const res = await api.post(
      "/api/users",
      { username, password: "pass1234", name: "Minted Admin", role: "admin" },
      { token: officerToken },
    )
    assertForbidden(res, "officer mint admin")
    const row = await ctx.db.query("SELECT 1 FROM users WHERE username = $1", [
      username,
    ])
    assert.equal(row.rowCount, 0, "the account was created despite the 403")
  })

  it("an officer cannot delete accounts", async () => {
    const res = await api.del(`/api/users/${DEMO_OFFICER.username}`, {
      token: officerToken,
    })
    assertForbidden(res, "officer delete user")
    const row = await ctx.db.query("SELECT 1 FROM users WHERE username = $1", [
      DEMO_OFFICER.username,
    ])
    assert.equal(row.rowCount, 1)
  })
})

describe("administrator account protection", () => {
  it("an administrator cannot change their own role", async () => {
    const res = await api.put(
      `/api/users/${DEMO_ADMIN.username}`,
      { role: "officer" },
      { token: adminToken },
    )
    assert.equal(res.status, 400)
    assert.match(String(res.body.error), /cannot change your own role/i)
    const row = await ctx.db.query(
      "SELECT role FROM users WHERE username = $1",
      [DEMO_ADMIN.username],
    )
    assert.equal(row.rows[0].role, "admin")
  })

  it("an administrator cannot delete their own account", async () => {
    const res = await api.del(`/api/users/${DEMO_ADMIN.username}`, {
      token: adminToken,
    })
    assert.equal(res.status, 400)
    assert.match(String(res.body.error), /cannot delete your own account/i)
    const row = await ctx.db.query("SELECT 1 FROM users WHERE username = $1", [
      DEMO_ADMIN.username,
    ])
    assert.equal(row.rowCount, 1)
  })

  it("the last administrator cannot be removed, even by a stale elevated token", async () => {
    // Reduce the database to a single administrator so the guard is reachable,
    // then drive it with a signed token whose admin claim outlives the role.
    const admins = (
      await ctx.db.query(
        "SELECT username FROM users WHERE role = 'admin' ORDER BY id",
      )
    ).rows
    const demoted = []
    try {
      for (const { username } of admins) {
        if (username === DEMO_ADMIN.username) continue
        await ctx.db.query(
          "UPDATE users SET role = 'officer' WHERE username = $1",
          [username],
        )
        demoted.push(username)
      }
      const stale = signToken(
        {
          username: "sec2stale",
          name: "Stale Admin",
          role: "admin",
          station: CENTRAL_FINANCE,
        },
        { secret: ctx.jwtSecret, expiresIn: "12h" },
      )
      const deleted = await api.del(`/api/users/${DEMO_ADMIN.username}`, {
        token: stale,
      })
      const demote = await api.put(
        `/api/users/${DEMO_ADMIN.username}`,
        { role: "officer" },
        { token: stale },
      )
      assert.equal(deleted.status, 400)
      assert.match(
        String(deleted.body.error),
        /At least one administrator must remain/,
      )
      assert.equal(demote.status, 400)
      const row = await ctx.db.query(
        "SELECT role FROM users WHERE username = $1",
        [DEMO_ADMIN.username],
      )
      assert.equal(row.rows[0].role, "admin")
    } finally {
      for (const username of demoted) {
        await ctx.db.query(
          "UPDATE users SET role = 'admin' WHERE username = $1",
          [username],
        )
      }
    }
  })
})

describe("user lifecycle (positive controls)", () => {
  it("lets an administrator create, credential, and delete an officer account", async () => {
    const username = uniqueUsername("sec2life")
    const created = await createUser(api, adminToken, {
      username,
      password: "startpass1",
      name: "Lifecycle Officer",
      role: "officer",
      station: "Wete", // client-supplied: must be ignored server-side
    })
    assert.equal(created.role, "officer")
    assert.equal(
      created.station,
      "",
      "an officer account must not carry a station scope",
    )
    assert.equal("password" in created, false)
    assert.equal("password_hash" in created, false)

    const firstLogin = await api.login(username, "startpass1")
    assert.equal(firstLogin.status, 200)

    const listed = await api.get("/api/users", { token: adminToken })
    const record = listed.body.users.find((u) => u.username === username)
    assert.ok(record, "created user missing from the admin list")
    assert.deepEqual(Object.keys(record).sort(), [
      "createdAt",
      "id",
      "name",
      "role",
      "station",
      "username",
    ])

    const updated = await api.put(
      `/api/users/${username}`,
      { password: "rotatedpass2" },
      { token: adminToken },
    )
    assert.equal(updated.status, 200)
    assert.equal((await api.login(username, "startpass1")).status, 401)
    assert.equal((await api.login(username, "rotatedpass2")).status, 200)

    const removed = await api.del(`/api/users/${username}`, {
      token: adminToken,
    })
    assert.equal(removed.status, 200)
    assert.equal((await api.login(username, "rotatedpass2")).status, 401)
    const gone = await api.put(`/api/users/${username}`, { name: "Ghost" }, {
      token: adminToken,
    })
    assert.equal(gone.status, 404)
  })
})

describe("user input validation", () => {
  const write = (fields) =>
    api.post("/api/users", fields, { token: adminToken })

  it("rejects usernames outside the documented pattern", async () => {
    for (const username of [
      "ab",
      "a".repeat(33),
      "has space",
      "semi;colon",
      "quote'name",
      "sla/sh",
      "hash#tag",
      "ünicode",
    ]) {
      const res = await write({
        username,
        password: "pass1234",
        name: "N",
        role: "officer",
      })
      assert.equal(
        res.status,
        400,
        `username ${JSON.stringify(username)} → ${res.status}`,
      )
    }
  })

  it("rejects weak or missing passwords", async () => {
    const short = await write({
      username: uniqueUsername("sec2weak"),
      password: "12345",
      name: "N",
      role: "officer",
    })
    const missing = await write({
      username: uniqueUsername("sec2miss"),
      name: "N",
      role: "officer",
    })
    assert.equal(short.status, 400)
    assert.equal(missing.status, 400)
  })

  it("rejects roles and names outside the allowed values", async () => {
    for (const role of ["superadmin", "ADMIN", "root", ""]) {
      const res = await write({
        username: uniqueUsername("sec2role"),
        password: "pass1234",
        name: "N",
        role,
      })
      assert.equal(
        res.status,
        400,
        `role ${JSON.stringify(role)} → ${res.status}`,
      )
    }
    const blankName = await write({
      username: uniqueUsername("sec2name"),
      password: "pass1234",
      name: "   ",
      role: "officer",
    })
    assert.equal(blankName.status, 400)
  })

  it("refuses to overwrite an existing username", async () => {
    const res = await write({
      username: DEMO_ADMIN.username,
      password: "pass1234",
      name: "Impostor",
      role: "admin",
    })
    assert.equal(res.status, 409)
    assert.equal(
      (await api.login(DEMO_ADMIN.username, DEMO_ADMIN.password)).status,
      200,
    )
  })

  it("ignores non-string field types instead of failing", async () => {
    const res = await write({
      username: { toString: "x" },
      password: {},
      name: [],
      role: "officer",
    })
    assert.ok(
      res.status === 400,
      `expected a validation error, got ${res.status} ${res.text.slice(0, 200)}`,
    )
  })
})

describe("documented behaviour", () => {
  it("derives the admin session station from the role, not from the stored row", async () => {
    const username = uniqueUsername("sec2legacy")
    try {
      await ctx.db.query(
        `INSERT INTO users (username, password_hash, name, role, station)
         VALUES ($1, (SELECT password_hash FROM users WHERE username = $2), 'Legacy Admin', 'admin', 'Wete')
         ON CONFLICT (username) DO UPDATE SET role = 'admin', station = 'Wete'`,
        [username, DEMO_ADMIN.username],
      )
      const res = await api.login(username, DEMO_ADMIN.password)
      assert.equal(res.status, 200)
      assert.equal(res.body.user.station, CENTRAL_FINANCE)
    } finally {
      await ctx.db.query("DELETE FROM users WHERE username = $1", [username])
    }
  })

  it("publishes the station list needed by the login screen, with no extra columns", async () => {
    const res = await api.get("/api/stations")
    assert.equal(res.status, 200)
    assert.equal(res.body.stations.length, 6)
    for (const station of res.body.stations) {
      assert.deepEqual(Object.keys(station).sort(), ["name", "subVote"])
    }
  })

  // Hardening backlog:
  it.todo(
    "records an immutable audit trail for admin actions (user create/update/delete are not logged)",
  )
  it.todo(
    "requires step-up or multi-factor authentication for administrator actions",
  )
  it.todo("locks out or delays an account after repeated failed logins")
})
