// Security suite 3/4 — cashbook integrity.
//
// The cashbook is the system of record for public funds, so the interesting
// questions are: can a client dictate money it should not (debits, credits,
// balances, officer identity, station booking scope), can it drive the shared
// balance negative, and does the advisory-lock serialisation in `insertEntry()`
// actually hold under concurrent writers?

import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  bootstrap,
  CENTRAL_FINANCE,
  currentBalance,
  DEMO_ADMIN,
  DEMO_OFFICER,
  resetCashbook,
} from "./lib/harness.js"

const OPENING = 1000
const VOTE_CODE = "22002101"

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

beforeEach(async () => {
  await resetCashbook(ctx.db, OPENING)
})

after(async () => {
  await ctx?.stop()
})

const pay = (overrides = {}, token = officerToken) =>
  api.post(
    "/api/cashbook/payments",
    {
      voteCode: VOTE_CODE,
      amount: "100.00",
      payee: "Supplier Ltd",
      purpose: "Unit test payment",
      station: "Mkoani",
      ...overrides,
    },
    { token },
  )

describe("payment validation", () => {
  it("rejects amounts that are not a positive finite number", async () => {
    const rejected = [
      "abc",
      "",
      "0",
      "0.00",
      0,
      -1,
      "-0.01",
      "NaN",
      "1e999",
      1e309,
      null,
      {},
      [],
      [5],
      true,
    ]
    for (const amount of rejected) {
      const res = await pay({ amount })
      assert.equal(
        res.status,
        400,
        `amount ${JSON.stringify(amount)} → ${res.status} ${res.text.slice(0, 120)}`,
      )
    }
    const rows = await ctx.db.query(
      "SELECT count(*) AS n FROM cashbook_entries",
    )
    assert.equal(
      Number(rows.rows[0].n),
      0,
      "an invalid amount still produced a ledger entry",
    )
  })

  it("requires a payee and a purpose", async () => {
    for (const payee of ["", "   ", null, {}, []]) {
      const res = await pay({ payee })
      assert.equal(
        res.status,
        400,
        `payee ${JSON.stringify(payee)} → ${res.status}`,
      )
    }
    for (const purpose of ["", "  \t ", null, {}]) {
      const res = await pay({ purpose })
      assert.equal(
        res.status,
        400,
        `purpose ${JSON.stringify(purpose)} → ${res.status}`,
      )
    }
  })

  it("normalises primitive free-text values to strings instead of failing", async () => {
    const res = await pay({ payee: 123, purpose: 456, receiptNo: 789 })
    assert.equal(res.status, 201)
    assert.equal(res.body.entry.payee, "123")
    assert.equal(res.body.entry.purpose, "456")
    assert.equal(res.body.entry.receiptNo, "789")
  })

  it("rejects a station that is not in the station list", async () => {
    for (const station of ["", "  ", "Nowhere Police", "Central Finance"]) {
      const res = await pay({ station })
      assert.equal(
        res.status,
        400,
        `station ${JSON.stringify(station)} → ${res.status}`,
      )
    }
  })

  it("rejects a vote code that is not in the votebook master list", async () => {
    for (const voteCode of ["", "99999999", "22002101 ", null, {}]) {
      const res = await pay({ voteCode })
      assert.equal(
        res.status,
        400,
        `voteCode ${JSON.stringify(voteCode)} → ${res.status}`,
      )
    }
  })

  it("is not vulnerable to SQL injection in station or vote code", async () => {
    const injections = [
      "Mkoani'; DELETE FROM cashbook_entries; --",
      "' OR 1=1 --",
      'Mkoani" --',
      "\\'; DROP TABLE users; --",
    ]
    for (const station of injections) {
      const res = await pay({ station })
      assert.equal(res.status, 400, `station ${station} → ${res.status}`)
    }
    for (const voteCode of injections) {
      const res = await pay({ voteCode })
      assert.equal(res.status, 400, `voteCode ${voteCode} → ${res.status}`)
    }
    const entries = await ctx.db.query(
      "SELECT count(*) AS n FROM cashbook_entries",
    )
    const users = await ctx.db.query("SELECT count(*) AS n FROM users")
    assert.equal(Number(entries.rows[0].n), 0)
    assert.ok(
      Number(users.rows[0].n) > 0,
      "users table was dropped by an injection payload",
    )
  })
})

describe("client-supplied money fields are ignored (mass assignment)", () => {
  it("derives debit, credit, balance, type, officer and vote data server-side", async () => {
    const res = await pay({
      debit: -500000,
      credit: 999999,
      balance: 0,
      type: "receipt",
      officer: DEMO_ADMIN.username,
      officerName: "Administrator",
      id: "CB-FORGED",
      entryRef: "CB-FORGED",
      voteDescription: "Fraudulent description",
      voteSubVote: "9999",
      voteItem: "HACKED",
      voteSubItem: "HACKED",
      createdAt: "2000-01-01T00:00:00.000Z",
    })
    assert.equal(res.status, 201)

    const entry = res.body.entry
    assert.equal(entry.debit, 100, "client-supplied debit was honoured")
    assert.equal(entry.credit, 0, "client-supplied credit was honoured")
    assert.equal(entry.type, "payment")
    assert.equal(
      entry.officer,
      DEMO_OFFICER.username,
      "entry was posted on behalf of another officer",
    )
    assert.equal(entry.officerName, "Sgt. M. Banda")
    assert.equal(entry.balance, OPENING - 100)
    assert.equal(entry.description, "Electricity") // from vote_items
    assert.equal(entry.voteDescription, "Electricity")
    assert.equal(entry.voteItem, "C01C01")
    assert.equal(entry.voteSubItem, "PK001")
    assert.equal(entry.voteSubVote, "2039") // from stations.sub_vote for Mkoani
    assert.match(entry.id, /^CB-/)
    assert.notEqual(entry.id, "CB-FORGED")
    assert.equal(entry.timestamp.startsWith("2000"), false)

    const stored = await ctx.db.query(
      "SELECT debit::text AS debit, credit::text AS credit, balance::text AS balance, type, officer FROM cashbook_entries",
    )
    assert.equal(stored.rows.length, 1)
    assert.deepEqual(stored.rows[0], {
      debit: "100.00",
      credit: "0.00",
      balance: "900.00",
      type: "payment",
      officer: DEMO_OFFICER.username,
    })
  })

  it("forces credits onto Central Finance and ignores a client-supplied station or debit", async () => {
    const res = await api.post(
      "/api/cashbook/credits",
      {
        amount: "250.00",
        description: "Treasury top-up",
        ref: "TR-1",
        station: "Mkoani",
        debit: 5000,
        type: "payment",
        balance: 1,
      },
      { token: adminToken },
    )
    assert.equal(res.status, 201)
    const entry = res.body.entry
    assert.equal(entry.type, "receipt")
    assert.equal(entry.station, CENTRAL_FINANCE)
    assert.equal(entry.credit, 250)
    assert.equal(entry.debit, 0)
    assert.equal(entry.officer, DEMO_ADMIN.username)
    assert.equal(entry.payee, "Government Treasury")
    assert.match(entry.id, /^CR-/)
    assert.equal(await currentBalance(ctx.db), OPENING + 250)
  })

  it("only accepts a non-negative, finite opening balance from Central Finance", async () => {
    for (const amount of [-1, "-0.01", "abc", "NaN", {}, [], null, [5], true]) {
      const res = await api.put("/api/cashbook/opening-balance", { amount }, {
        token: adminToken,
      })
      assert.equal(
        res.status,
        400,
        `opening balance ${JSON.stringify(amount)} → ${res.status}`,
      )
    }
    assert.equal(
      (
        await api.put("/api/cashbook/opening-balance", { amount: 0 }, {
          token: adminToken,
        })
      ).status,
      200,
    )
    const ok = await api.put(
      "/api/cashbook/opening-balance",
      { amount: 4321.5 },
      { token: adminToken },
    )
    assert.equal(ok.status, 200)
    assert.equal(ok.body.openingBalance, 4321.5)
    const read = await api.get("/api/cashbook", { token: officerToken })
    assert.equal(read.body.openingBalance, 4321.5)
  })
})
describe("ledger integrity", () => {
  it("keeps every entry balance equal to the recomputed running total", async () => {
    for (const amount of ["100.00", "250.50", "49.50"]) {
      assert.equal((await pay({ amount })).status, 201)
    }
    const state = (await api.get("/api/cashbook", { token: officerToken })).body
    assert.equal(state.openingBalance, OPENING)
    assert.equal(state.entries.length, 3)

    let running = OPENING
    for (const entry of state.entries) {
      running += entry.credit - entry.debit
      assert.equal(
        entry.balance,
        running,
        "stored balance does not match the recomputed running total",
      )
      assert.ok(entry.balance >= 0, "a negative balance reached the ledger")
    }
    assert.equal(running, 600)
    assert.equal(await currentBalance(ctx.db), 600)

    const ids = state.entries.map((entry) => entry.id)
    assert.equal(
      new Set(ids).size,
      ids.length,
      "entry references must be unique",
    )
  })

  it("refuses an overdraft and leaves the ledger untouched", async () => {
    const over = await pay({ amount: "1000.01" })
    assert.equal(over.status, 400)
    assert.match(String(over.body.error), /Insufficient balance/i)
    assert.equal(
      Number(
        (await ctx.db.query("SELECT count(*) AS n FROM cashbook_entries"))
          .rows[0].n,
      ),
      0,
    )

    const exact = await pay({ amount: "1000.00" })
    assert.equal(exact.status, 201)
    assert.equal(exact.body.entry.balance, 0)

    const after = await pay({ amount: "0.01" })
    assert.equal(after.status, 400)
    assert.equal(await currentBalance(ctx.db), 0)
  })

  it("only lets credits make additional spending possible", async () => {
    assert.equal((await pay({ amount: "1001.00" })).status, 400)
    const credit = await api.post(
      "/api/cashbook/credits",
      { amount: "500", description: "Top-up" },
      { token: adminToken },
    )
    assert.equal(credit.status, 201)
    assert.equal((await pay({ amount: "1400" })).status, 201)
    assert.equal(await currentBalance(ctx.db), 100)

    const totals = await ctx.db.query(
      "SELECT COALESCE(SUM(debit),0)::text AS debits, COALESCE(SUM(credit),0)::text AS credits FROM cashbook_entries",
    )
    assert.equal(totals.rows[0].debits, "1400.00")
    assert.equal(totals.rows[0].credits, "500.00")
  })
})

describe("concurrency (advisory lock)", () => {
  it("serialises concurrent payments so the shared balance cannot be overdrawn", async () => {
    const stations = ["Mkoani", "Wete", "Chakechake", "Micheweni"]
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        pay({
          amount: "100.00",
          station: stations[i % stations.length],
          payee: `Payee ${i}`,
        }),
      ),
    )

    const created = results.filter((res) => res.status === 201)
    const rejected = results.filter((res) => res.status === 400)
    assert.equal(
      created.length,
      10,
      `expected exactly 10 accepted payments, got ${created.length}`,
    )
    assert.equal(rejected.length, 10)
    for (const res of rejected)
      assert.match(String(res.body.error), /Insufficient balance/i)
    for (const res of results)
      assert.ok(
        res.status < 500,
        `unexpected server error: ${res.status} ${res.text.slice(0, 200)}`,
      )

    const stored = await ctx.db.query(
      "SELECT balance::text AS balance FROM cashbook_entries ORDER BY id",
    )
    assert.equal(stored.rows.length, 10)
    for (const row of stored.rows)
      assert.ok(
        Number(row.balance) >= 0,
        `negative stored balance ${row.balance}`,
      )

    const totals = await ctx.db.query(
      "SELECT COALESCE(SUM(debit),0)::text AS debits FROM cashbook_entries",
    )
    assert.equal(totals.rows[0].debits, "1000.00")
    assert.equal(await currentBalance(ctx.db), 0)
  })
})

describe("documented behaviour", () => {
  it("stores amounts with two decimal places", async () => {
    const res = await pay({ amount: "10.5" })
    assert.equal(res.status, 201)
    const row = await ctx.db.query(
      "SELECT debit::text AS debit, balance::text AS balance FROM cashbook_entries WHERE entry_ref = $1",
      [res.body.entry.id],
    )
    assert.equal(row.rows[0].debit, "10.50")
    assert.equal(row.rows[0].balance, "989.50")
  })

  it("keeps one shared balance across stations, with the sub-vote taken from the station", async () => {
    assert.equal((await pay({ station: "Mkoani", amount: "100" })).status, 201)
    assert.equal((await pay({ station: "Wete", amount: "200" })).status, 201)
    const state = (await api.get("/api/cashbook", { token: officerToken })).body
    assert.equal(state.entries.length, 2)
    assert.equal(state.entries[0].voteSubVote, "2039")
    assert.equal(state.entries[1].voteSubVote, "2040")
    assert.equal(state.entries[1].balance, 700)
  })

  // Hardening backlog:
  it.todo(
    "requires an idempotency key so a retried or replayed payment cannot double-post",
  )
  it.todo("requires a second approver above a configurable amount threshold")
  it.todo(
    "hash-chains ledger entries so direct database tampering is detectable",
  )
})
