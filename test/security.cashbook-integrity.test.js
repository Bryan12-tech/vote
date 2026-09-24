// Security suite 3/4 — votebook integrity (allocate → utilize → release).
//
// The votebook is the system of record for public funds, so the interesting
// questions are: can a client dictate money it should not (debits, credits,
// balances, officer identity, station or vote booking), can it reserve more than
// a station holds or release more than was utilized, is Cash in Bank untouched by
// the two reservation steps, and does the advisory-lock serialisation in
// `insertEntryIn()` hold under concurrent writers?

import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  allocateToStation,
  bootstrap,
  CENTRAL_FINANCE,
  currentBalance,
  DEMO_ADMIN,
  DEMO_OFFICER,
  fundStation,
  releaseVote,
  resetCashbook,
  utilizeFunds,
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

// Stage 2 — earmark station funds against a vote item.
const utilize = (overrides = {}, token = officerToken) =>
  api.post(
    "/api/vote-utilizations",
    {
      station: "Mkoani",
      voteCode: VOTE_CODE,
      amount: "100.00",
      description: "Unit test utilization",
      ...overrides,
    },
    { token },
  )

// Stage 3 — pay a utilized vote, optionally in part; the only step that
// debits Cash in Bank. A missing amount keeps full-remaining release compatibility.
const release = (overrides = {}, token = officerToken) =>
  api.post(
    "/api/vote-releases",
    {
      payee: "Supplier Ltd",
      purpose: "Unit test payment",
      ...overrides,
    },
    { token },
  )

const countRows = async (table) =>
  Number((await ctx.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)

describe("utilization validation (stage 2)", () => {
  it("rejects amounts that are not a positive finite number", async () => {
    await allocateToStation(api, adminToken, { amount: "500.00" })
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
      const res = await utilize({ amount })
      assert.equal(
        res.status,
        400,
        `amount ${JSON.stringify(amount)} → ${res.status} ${res.text.slice(0, 120)}`,
      )
    }
    assert.equal(
      await countRows("vote_utilizations"),
      0,
      "an invalid amount still produced a utilization",
    )
  })

  it("rejects a station that is not in the station list", async () => {
    for (const station of ["", "   ", "Nowhere Police", "Central Finance", null, {}]) {
      const res = await utilize({ station })
      assert.equal(
        res.status,
        400,
        `station ${JSON.stringify(station)} → ${res.status}`,
      )
    }
  })

  it("rejects a vote code that is not in the votebook master list", async () => {
    await allocateToStation(api, adminToken, { amount: "500.00" })
    for (const voteCode of ["", "99999999", "22002101 ", null, {}]) {
      const res = await utilize({ voteCode })
      assert.equal(
        res.status,
        400,
        `voteCode ${JSON.stringify(voteCode)} → ${res.status}`,
      )
    }
  })

  it("refuses to utilize a station that has not been allocated funds", async () => {
    const res = await utilize({ station: "Wete", amount: "10" })
    assert.equal(res.status, 400)
    assert.match(String(res.body.error), /no allocated funds/i)
  })

  it("refuses to utilize more than the station still holds unutilized", async () => {
    await allocateToStation(api, adminToken, { amount: "150.00" })
    assert.equal((await utilize({ amount: "150.00" })).status, 201)
    const over = await utilize({ amount: "0.01" })
    assert.equal(over.status, 400)
    assert.match(String(over.body.error), /Insufficient station funds/i)
    assert.equal(await countRows("vote_utilizations"), 1)
  })

  it("is not vulnerable to SQL injection in station or vote code", async () => {
    await allocateToStation(api, adminToken, { amount: "500.00" })
    const injections = [
      "Mkoani'; DELETE FROM vote_utilizations; --",
      "' OR 1=1 --",
      'Mkoani" --',
      "\\'; DROP TABLE users; --",
    ]
    for (const value of injections) {
      assert.equal(
        (await utilize({ station: value })).status,
        400,
        `station ${value}`,
      )
      assert.equal(
        (await utilize({ voteCode: value })).status,
        400,
        `voteCode ${value}`,
      )
    }
    assert.equal(await countRows("vote_utilizations"), 0)
    assert.ok(
      (await countRows("users")) > 0,
      "users table was dropped by an injection payload",
    )
  })
})

describe("release validation (stage 3)", () => {
  it("requires a utilized vote from the open period", async () => {
    for (const utilizationId of [0, -1, "abc", null, undefined, {}, 999999]) {
      const res = await release({ utilizationId })
      assert.equal(
        res.status,
        400,
        `utilizationId ${JSON.stringify(utilizationId)} → ${res.status}`,
      )
    }
  })

  it("requires a payee and a purpose", async () => {
    const u = await fundStation(api, adminToken, officerToken)
    for (const payee of ["", "   ", null, {}, []]) {
      const res = await release({ utilizationId: u.id, payee })
      assert.equal(res.status, 400, `payee ${JSON.stringify(payee)} → ${res.status}`)
    }
    for (const purpose of ["", "  \t ", null, {}]) {
      const res = await release({ utilizationId: u.id, purpose })
      assert.equal(
        res.status,
        400,
        `purpose ${JSON.stringify(purpose)} → ${res.status}`,
      )
    }
  })

  it("normalises primitive free-text values to strings instead of failing", async () => {
    const u = await fundStation(api, adminToken, officerToken)
    const res = await release({
      utilizationId: u.id,
      payee: 123,
      purpose: 456,
      receiptNo: 789,
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.entry.payee, "123")
    assert.equal(res.body.entry.purpose, "456")
    assert.equal(res.body.entry.receiptNo, "789")
  })

  it("accepts a partial release amount and prevents releasing more than the remaining balance", async () => {
    const u = await fundStation(api, adminToken, officerToken, {
      utilized: "100.00",
    })
    const partial = await release({ utilizationId: u.id, amount: "40.00" })
    assert.equal(partial.status, 201)
    assert.equal(partial.body.expenditure.amount, 40)
    assert.equal(partial.body.entry.debit, 40)
    assert.equal(await currentBalance(ctx.db), OPENING - 40)

    const over = await release({ utilizationId: u.id, amount: "60.01" })
    assert.equal(over.status, 400)
    assert.match(String(over.body.error), /exceeds the remaining utilization balance/i)

    const remainder = await release({ utilizationId: u.id, amount: "60.00" })
    assert.equal(remainder.status, 201)
    assert.equal(remainder.body.expenditure.amount, 60)
    assert.equal(await currentBalance(ctx.db), OPENING - 100)

    const repeat = await release({ utilizationId: u.id, amount: "0.01" })
    assert.equal(repeat.status, 400)
    assert.match(String(repeat.body.error), /already been released and paid in full/i)

    const state = (await api.get("/api/vote-cashbook", { token: officerToken })).body
    assert.equal(state.utilizations[0].released, 100)
    assert.equal(state.utilizations[0].remaining, 0)
  })

  it("is not vulnerable to SQL injection in the free-text fields", async () => {
    await allocateToStation(api, adminToken, { amount: "1000.00" })
    for (const value of ["'; DROP TABLE users; --", "' OR 1=1 --"]) {
      const utilization = await utilizeFunds(api, officerToken, {
        amount: "100.00",
        description: `Petrol ${value}`,
      })
      const res = await release({
        utilizationId: utilization.id,
        payee: value,
        purpose: value,
      })
      assert.equal(res.status, 201, `payload ${value} → ${res.status}`)
    }
    assert.ok(
      (await countRows("users")) > 0,
      "users table was dropped by an injection payload",
    )
    assert.equal(await countRows("vote_expenditures"), 2)
  })
})



describe("client-supplied money fields are ignored (mass assignment)", () => {
  it("derives debit, credit, balance, type, officer and vote data server-side", async () => {
    const u = await fundStation(api, adminToken, officerToken, {
      utilized: "100.00",
    })
    const res = await release({
      utilizationId: u.id,
      debit: -500000,
      credit: 999999,
      balance: 0,
      type: "receipt",
      officer: DEMO_ADMIN.username,
      officerName: "Administrator",
      id: "CB-FORGED",
      entryRef: "CB-FORGED",
      station: "Wete",
      voteCode: "33181109",
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
    assert.equal(entry.station, "Mkoani", "client-supplied station was honoured")
    assert.equal(entry.voteCode, VOTE_CODE, "client-supplied vote code was honoured")
    assert.equal(entry.description, "Electricity") // from vote_items
    assert.equal(entry.voteDescription, "Electricity")
    assert.equal(entry.voteItem, "C01C01")
    assert.equal(entry.voteSubItem, "PK001")
    assert.equal(entry.voteSubVote, "2039") // from stations.sub_vote for Mkoani
    assert.equal(entry.utilizationRef, u.reference)
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


describe("stage separation (only a release moves Cash in Bank)", () => {
  it("does not touch Cash in Bank when allocating or utilizing", async () => {
    assert.equal(await currentBalance(ctx.db), OPENING)
    await allocateToStation(api, adminToken, { amount: "400.00" })
    assert.equal(await currentBalance(ctx.db), OPENING, "allocation debited the bank")
    const u = await utilizeFunds(api, officerToken, { amount: "250.00" })
    assert.equal(await currentBalance(ctx.db), OPENING, "utilization debited the bank")
    assert.equal(await countRows("cashbook_entries"), 0)

    const state = (await api.get("/api/vote-cashbook", { token: officerToken })).body
    assert.deepEqual(state.totals, {
      allocated: 400,
      utilized: 250,
      unutilized: 150,
      released: 0,
      unreleased: 250,
    })

    await releaseVote(api, officerToken, { utilizationId: u.id })
    assert.equal(
      await currentBalance(ctx.db),
      OPENING - 250,
      "the release did not debit the bank",
    )
    assert.equal(await countRows("cashbook_entries"), 1)

    const releasedState = (await api.get("/api/vote-cashbook", { token: officerToken })).body
    assert.equal(releasedState.utilizations[0].remaining, 0, "the released utilization is no longer available")
    assert.equal(releasedState.totals.unreleased, 0, "the release is reflected in the vote totals")
    assert.deepEqual(releasedState.totals, {
      allocated: 400,
      utilized: 250,
      unutilized: 150,
      released: 250,
      unreleased: 0,
    })
  })

  it("refuses to allocate more than the money ever paid into the bank", async () => {
    const res = await api.post(
      "/api/vote-allocations",
      { station: "Mkoani", amount: "1000.01", description: "Too much" },
      { token: adminToken },
    )
    assert.equal(res.status, 400)
    assert.match(String(res.body.error), /Insufficient unallocated bank funds/i)
    assert.equal(await countRows("vote_allocations"), 0)
  })

  it("keeps allocation capacity intact after a release (released money stays allocated)", async () => {
    await allocateToStation(api, adminToken, { amount: "1000.00" })
    const u = await utilizeFunds(api, officerToken, { amount: "1000.00" })
    await releaseVote(api, officerToken, { utilizationId: u.id })
    // 1000 paid into the bank − 1000 already allocated = nothing left to allocate.
    const res = await api.post(
      "/api/vote-allocations",
      { station: "Wete", amount: "0.01", description: "One cent too many" },
      { token: adminToken },
    )
    assert.equal(res.status, 400)
  })
})

describe("ledger integrity", () => {
  it("keeps every entry balance equal to the recomputed running total", async () => {
    await allocateToStation(api, adminToken, { amount: "1000.00" })
    for (const amount of ["100.00", "250.50", "49.50"]) {
      const u = await utilizeFunds(api, officerToken, {
        amount,
        description: `Utilization ${amount}`,
      })
      assert.equal((await release({ utilizationId: u.id })).status, 201)
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

  it("refuses to release the same utilization twice and leaves the ledger untouched", async () => {
    const u = await fundStation(api, adminToken, officerToken, {
      utilized: "100.00",
    })
    assert.equal((await release({ utilizationId: u.id })).status, 201)
    const repeat = await release({ utilizationId: u.id })
    assert.equal(repeat.status, 400)
    assert.match(String(repeat.body.error), /already been released and paid in full/i)
    assert.equal(await countRows("cashbook_entries"), 1)
    assert.equal(await countRows("vote_expenditures"), 1)
    assert.equal(await currentBalance(ctx.db), OPENING - 100)
  })

  it("only lets credits make additional spending possible", async () => {
    await allocateToStation(api, adminToken, { amount: "1000.00" })
    const u = await utilizeFunds(api, officerToken, { amount: "1000.00" })
    assert.equal((await release({ utilizationId: u.id })).status, 201)
    assert.equal(await currentBalance(ctx.db), 0)
    assert.equal((await release({ utilizationId: u.id })).status, 400)

    assert.equal(
      (
        await api.post(
          "/api/cashbook/credits",
          { amount: "500", description: "Top-up" },
          { token: adminToken },
        )
      ).status,
      201,
    )
    assert.equal(await currentBalance(ctx.db), 500)
    // The exhausted utilization stays exhausted; the station was fully utilized.
    assert.equal((await release({ utilizationId: u.id })).status, 400)
    assert.equal((await utilize({ amount: "500.00" })).status, 400)

    const totals = await ctx.db.query(
      "SELECT COALESCE(SUM(debit),0)::text AS debits, COALESCE(SUM(credit),0)::text AS credits FROM cashbook_entries",
    )
    assert.equal(totals.rows[0].debits, "1000.00")
    assert.equal(totals.rows[0].credits, "500.00")
  })
})

describe("concurrency (advisory lock)", () => {
  it("serialises concurrent releases so only one bounded payment is created", async () => {
    const u = await fundStation(api, adminToken, officerToken, {
      utilized: "1000.00",
    })
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        release({ utilizationId: u.id, payee: `Payee ${i}` }),
      ),
    )

    const created = results.filter((res) => res.status === 201)
    const rejected = results.filter((res) => res.status === 400)
    assert.equal(created.length, 1, `expected exactly one accepted release, got ${created.length}`)
    assert.equal(rejected.length, 19)
    for (const res of rejected)
      assert.match(String(res.body.error), /already been released and paid in full/i)
    for (const res of results)
      assert.ok(
        res.status < 500,
        `unexpected server error: ${res.status} ${res.text.slice(0, 200)}`,
      )

    const stored = await ctx.db.query(
      "SELECT balance::text AS balance, debit::text AS debit FROM cashbook_entries ORDER BY id",
    )
    assert.equal(stored.rows.length, 1)
    assert.equal(stored.rows[0].debit, "1000.00")
    assert.equal(Number(stored.rows[0].balance), 0)

    const totals = await ctx.db.query(
      "SELECT COALESCE(SUM(debit),0)::text AS debits FROM cashbook_entries",
    )
    assert.equal(totals.rows[0].debits, "1000.00")
    assert.equal(await currentBalance(ctx.db), 0)
  })

  it("serialises concurrent utilizations so station funds cannot be over-utilized", async () => {
    await allocateToStation(api, adminToken, { amount: "1000.00" })
    const results = await Promise.all(
      Array.from({ length: 20 }, () => utilize({ amount: "100.00" })),
    )
    const accepted = results.filter((res) => res.status === 201 || res.status === 200)
    assert.equal(
      accepted.length,
      10,
      `expected exactly 10 accepted utilizations, got ${accepted.length}`,
    )
    for (const res of results.filter((r) => r.status === 400))
      assert.match(String(res.body.error), /Insufficient station funds/i)

    const totals = await ctx.db.query(
      "SELECT COALESCE(SUM(amount),0)::text AS utilized FROM vote_utilizations",
    )
    assert.equal(totals.rows[0].utilized, "1000.00")
    assert.equal(
      await currentBalance(ctx.db),
      OPENING,
      "utilizing moved the bank balance",
    )
  })
})

describe("documented behaviour", () => {
  it("adds repeated utilization for the same station, vote and purpose to one balance", async () => {
    await allocateToStation(api, adminToken, { amount: "1000.00" })
    const first = await utilizeFunds(api, officerToken, {
      amount: "600.00",
      description: "Petrol for boat",
    })
    const second = await utilizeFunds(api, officerToken, {
      amount: "200.00",
      description: "Petrol for boat",
    })
    const otherPurpose = await utilizeFunds(api, officerToken, {
      amount: "100.00",
      description: "Maintenance for boat",
    })

    assert.equal(second.id, first.id)
    assert.equal(second.amount, 800)
    assert.notEqual(otherPurpose.id, first.id)

    const state = (await api.get("/api/vote-cashbook", { token: officerToken })).body
    assert.equal(state.utilizations.length, 2)
    assert.equal(state.utilizations[0].remaining, 800)
    assert.equal(state.utilizations[1].remaining, 100)
  })


  it("carries unutilized station funds and keeps the original purpose for the next period", async () => {
    await allocateToStation(api, adminToken, { amount: "100.00" })
    const first = await utilizeFunds(api, officerToken, {
      amount: "20.00",
      description: "Petrol for boat",
    })
    const paid = await release({ utilizationId: first.id, amount: "10.00" })
    assert.equal(paid.status, 201)
    const today = (await ctx.db.query("SELECT CURRENT_DATE::text AS today")).rows[0].today
    const closed = await api.post("/api/accounting-periods/close", { closeDate: today }, { token: adminToken })
    assert.equal(closed.status, 200)

    const carried = await utilizeFunds(api, officerToken, {
      amount: "10.00",
      description: "Petrol for boat",
    })
    assert.equal(carried.id, (await ctx.db.query(
      "SELECT id FROM vote_utilizations WHERE period_id = (SELECT id FROM accounting_periods WHERE status = 'open') AND description = 'Petrol for boat'",
    )).rows[0].id)
    assert.equal(carried.amount, 20)
    assert.equal(carried.released, 0)
    assert.equal(carried.remaining, 20)
  })

  it("stores amounts with two decimal places", async () => {
    const u = await fundStation(api, adminToken, officerToken, {
      utilized: "10.50",
    })
    const res = await release({ utilizationId: u.id })
    assert.equal(res.status, 201)
    const row = await ctx.db.query(
      "SELECT debit::text AS debit, balance::text AS balance FROM cashbook_entries WHERE entry_ref = $1",
      [res.body.entry.id],
    )
    assert.equal(row.rows[0].debit, "10.50")
    assert.equal(row.rows[0].balance, "989.50")
  })

  it("keeps one shared Cash in Bank, with the sub-vote taken from the station", async () => {
    await allocateToStation(api, adminToken, { station: "Mkoani", amount: "300.00" })
    await allocateToStation(api, adminToken, { station: "Wete", amount: "300.00" })
    const mkoani = await utilizeFunds(api, officerToken, {
      station: "Mkoani",
      amount: "100",
    })
    const wete = await utilizeFunds(api, officerToken, {
      station: "Wete",
      amount: "200",
    })
    assert.equal((await release({ utilizationId: mkoani.id })).status, 201)
    assert.equal((await release({ utilizationId: wete.id })).status, 201)

    const state = (await api.get("/api/cashbook", { token: officerToken })).body
    assert.equal(state.entries.length, 2)
    assert.equal(state.entries[0].voteSubVote, "2039")
    assert.equal(state.entries[1].voteSubVote, "2040")
    assert.equal(state.entries[1].balance, 700)
  })

  it("keeps station-restricted vote items unavailable to other stations", async () => {
    await allocateToStation(api, adminToken, { station: "Mkoani", amount: "100.00" })
    // 33181109 (Deposit general) is restricted to the two Makao stations.
    const res = await utilize({
      station: "Mkoani",
      voteCode: "33181109",
      amount: "10.00",
    })
    assert.equal(res.status, 400)
    assert.match(String(res.body.error), /not available for the selected station/i)
  })

  // Hardening backlog:
  it.todo(
    "requires an idempotency key so a retried or replayed release cannot double-post",
  )
  it.todo("requires a second approver above a configurable amount threshold")
  it.todo(
    "hash-chains ledger entries so direct database tampering is detectable",
  )
})
