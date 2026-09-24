import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { pool } from "./db.js"

const app = express()
app.use(express.json())

// Serve the built frontend in production (Vite outputs to ../dist).
// In local development, Vite serves the UI instead and only /api hits this server.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, "..", "dist")
if (existsSync(distDir)) {
  app.use(express.static(distDir))
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing — check server/.env")
  process.exit(1)
}
const PORT = parseInt(process.env.PORT || "4000")
const CENTRAL_FINANCE = "Central Finance"

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Request bodies are attacker-controlled JSON, so only accept primitive values.
// `String({ toString: "not-a-function" })` (and `Number(...)` on the same object)
// throws a TypeError, which surfaces as a 500 instead of a validation error.
function asString(value) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

// Accepts a JSON number or a numeric string — the UI sends amounts as strings.
function asNumber(value) {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  return Number.NaN
}

function auth(req, res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: "Not signed in." })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." })
  }
}

function requireCentralFinanceAdmin(req, res, next) {
  if (req.user.role !== "admin" || req.user.station !== CENTRAL_FINANCE) {
    return res.status(403).json({
      error: "Cashbook balance and credits are managed only by the administrator signed in at Central Finance.",
    })
  }
  next()
}

function money(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function genRef(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

function rowToEntry(r) {
  return {
    id: r.entry_ref,
    timestamp: r.created_at.toISOString(),
    type: r.type,
    description: r.description,
    station: r.station,
    officer: r.officer,
    officerName: r.officer_name,
    voteCode: r.vote_code,
    voteDescription: r.vote_description,
    voteSubVote: r.vote_sub_vote,
    voteItem: r.vote_item,
    voteSubItem: r.vote_sub_item,
    payee: r.payee,
    purpose: r.purpose,
    receiptNo: r.receipt_no,
    cashbookRef: r.cashbook_ref,
    utilizationRef: r.utilization_ref || "",
    debit: Number(r.debit),
    credit: Number(r.credit),
    balance: Number(r.balance),
  }
}

async function getCurrentPeriod(client = pool) {
  const r = await client.query("SELECT *, to_char(starts_on, 'YYYY-MM-DD') AS starts_label, to_char(ends_on, 'YYYY-MM-DD') AS ends_label FROM accounting_periods WHERE status = 'open' ORDER BY id DESC LIMIT 1")
  if (!r.rows[0]) throw new HttpError(409, "No open accounting period. Ask an administrator to open the next month.")
  return r.rows[0]
}

async function getPeriodByKey(key) {
  const r = await pool.query("SELECT *, to_char(starts_on, 'YYYY-MM-DD') AS starts_label, to_char(ends_on, 'YYYY-MM-DD') AS ends_label FROM accounting_periods WHERE period_key = $1", [key])
  if (!r.rows[0]) throw new HttpError(404, "Accounting period not found.")
  return r.rows[0]
}

async function getCashbookState(period = null) {
  period ||= await getCurrentPeriod()
  const settings = await pool.query("SELECT opening_bank_balance FROM accounting_periods WHERE id = $1", [period.id])
  const entries = await pool.query("SELECT * FROM cashbook_entries WHERE period_id = $1 ORDER BY id ASC", [period.id])
  return {
    openingBalance: Number(settings.rows[0]?.opening_bank_balance ?? 0),
    entries: entries.rows.map(rowToEntry),
    period: { key: period.period_key, startsOn: period.starts_label, endsOn: period.ends_label },
  }
}

function rowToAllocation(r, used) {
  return {
    id: r.id,
    reference: r.allocation_ref,
    timestamp: r.created_at.toISOString(),
    station: r.station,
    subVote: r.sub_vote,
    amount: Number(r.amount),
    used,
    remaining: Number(r.amount) - used,
    allocationReference: r.reference,
    description: r.description,
    officer: r.officer,
    officerName: r.officer_name,
  }
}

function rowToUtilization(r) {
  const released = Number(r.released)
  return {
    id: r.id,
    reference: r.utilization_ref,
    timestamp: r.created_at.toISOString(),
    station: r.station,
    subVote: r.sub_vote,
    voteCode: r.vote_code,
    voteDescription: r.vote_description,
    amount: Number(r.amount),
    released,
    remaining: Number(r.amount) - released,
    description: r.description,
    officer: r.officer,
    officerName: r.officer_name,
  }
}

async function getVoteCashbookState(period = null, client = pool) {
  period ||= await getCurrentPeriod(client)
  const allocations = await client.query(
    "SELECT * FROM vote_allocations WHERE period_id = $1 ORDER BY id ASC",
    [period.id],
  )
  // Stage 2: money a station holds, earmarked against a vote item.
  const utilizations = await client.query(`
    SELECT u.*, COALESCE((SELECT SUM(e.amount) FROM vote_expenditures e WHERE e.utilization_id = u.id), 0) AS released
    FROM vote_utilizations u
    WHERE u.period_id = $1
    ORDER BY u.id ASC
  `, [period.id])
  // Stage 3: the actual payments, which are what debited Cash in Bank.
  const expenditures = await client.query(`
    SELECT e.*, COALESCE(u.utilization_ref, '') AS utilization_ref
    FROM vote_expenditures e
    LEFT JOIN vote_utilizations u ON u.id = e.utilization_id
    WHERE e.period_id = $1
    ORDER BY e.id ASC
  `, [period.id])

  // A release draws on the station's pooled funds, oldest allocation first, so
  // each allocation's "used" is the slice of the station's releases that falls
  // inside its part of the pool.
  const releasedByStation = new Map()
  for (const e of expenditures.rows) {
    releasedByStation.set(e.station, (releasedByStation.get(e.station) || 0) + Number(e.amount))
  }
  const poolStart = new Map()
  const allocationRows = allocations.rows.map(a => {
    const stationReleased = releasedByStation.get(a.station) || 0
    const start = poolStart.get(a.station) || 0
    const used = Math.max(0, Math.min(Number(a.amount), stationReleased - start))
    poolStart.set(a.station, start + Number(a.amount))
    return rowToAllocation(a, used)
  })

  const utilizationRows = utilizations.rows.map(rowToUtilization)
  const allocated = allocationRows.reduce((s, a) => s + a.amount, 0)
  const utilized = utilizationRows.reduce((s, u) => s + u.amount, 0)
  const released = utilizationRows.reduce((s, u) => s + u.released, 0)

  return {
    period: { key: period.period_key, startsOn: period.starts_label, endsOn: period.ends_label },
    allocations: allocationRows,
    utilizations: utilizationRows,
    expenditures: expenditures.rows.map(r => ({
      id: r.expenditure_ref,
      timestamp: r.created_at.toISOString(),
      allocationId: r.allocation_id === null ? null : Number(r.allocation_id),
      utilizationId: r.utilization_id === null ? null : Number(r.utilization_id),
      utilizationReference: r.utilization_ref,
      station: r.station,
      subVote: r.sub_vote,
      voteCode: r.vote_code,
      voteDescription: r.vote_description,
      payee: r.payee,
      purpose: r.purpose,
      voucherNo: r.voucher_no,
      receiptNo: r.receipt_no,
      cashbookRef: r.cashbook_ref,
      amount: Number(r.amount),
      officer: r.officer,
      officerName: r.officer_name,
    })),
    totals: {
      allocated,
      utilized,
      unutilized: allocated - utilized,
      released,
      unreleased: utilized - released,
    },
  }
}

// Computes the running Cash in Bank balance and inserts the ledger row. It must
// run inside the caller's transaction — the advisory lock serialises the
// read-modify-write even with several stations posting at the same time.
async function insertEntryIn(client, f) {
  const period = await getCurrentPeriod(client)
  const opening = Number(
    (await client.query("SELECT opening_bank_balance FROM accounting_periods WHERE id = $1", [period.id])).rows[0].opening_bank_balance,
  )
  const net = Number(
    (await client.query("SELECT COALESCE(SUM(credit - debit), 0) AS net FROM cashbook_entries WHERE period_id = $1", [period.id])).rows[0].net,
  )
  const balance = opening + net + f.credit - f.debit
  if (balance < 0) {
    throw new HttpError(400, `Insufficient balance. Available: TSh ${money(opening + net)}`)
  }
  const entryRef = genRef(f.type === "payment" ? "CB" : "CR")
  const r = await client.query(
    `INSERT INTO cashbook_entries
       (entry_ref, type, description, station, officer, officer_name,
         vote_code, vote_description, vote_sub_vote, vote_item, vote_sub_item, period_id,
        payee, purpose, receipt_no, cashbook_ref, utilization_ref, debit, credit, balance)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      entryRef, f.type, f.description, f.station, f.officer, f.officerName,
      f.voteCode, f.voteDescription, f.voteSubVote, f.voteItem, f.voteSubItem, period.id,
      f.payee, f.purpose, f.receiptNo, f.cashbookRef, f.utilizationRef || "",
      f.debit.toFixed(2), f.credit.toFixed(2), balance.toFixed(2),
    ],
  )
  return rowToEntry(r.rows[0])
}

async function insertEntry(f) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const entry = await insertEntryIn(client, f)
    await client.query("COMMIT")
    return entry
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true }))

// Lets the login screen lock the station field for administrator accounts.
app.get("/api/auth/role", async (req, res, next) => {
  try {
    const username = String(req.query.username || "").trim()
    if (!username) return res.json({ role: null })
    const r = await pool.query("SELECT role FROM users WHERE username = $1", [username])
    res.json({ role: r.rows[0]?.role ?? null })
  } catch (e) {
    next(e)
  }
})

// Public: the login screen needs station names before authentication.
app.get("/api/stations", async (req, res, next) => {
  try {
    const stations = (await pool.query('SELECT name, sub_vote AS "subVote" FROM stations ORDER BY id')).rows
    res.json({ stations })
  } catch (e) {
    next(e)
  }
})

app.post("/api/login", async (req, res, next) => {
  try {
    const username = asString(req.body?.username).trim()
    const password = asString(req.body?.password)

    const u = (await pool.query("SELECT * FROM users WHERE username = $1", [username])).rows[0]
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      throw new HttpError(401, "Invalid credentials. Please check your username and password.")
    }

    // Officers can post votebook payments for any station — the station is chosen
    // per entry. The session records access scope only; admins are Central Finance.
    const sessionStation = u.role === "admin" ? CENTRAL_FINANCE : "All Stations"

    const token = jwt.sign(
      { username: u.username, name: u.name, role: u.role, station: sessionStation },
      JWT_SECRET,
      { expiresIn: "12h" },
    )
    res.json({ token, user: { username: u.username, name: u.name, role: u.role, station: sessionStation } })
  } catch (e) {
    next(e)
  }
})

app.get("/api/bootstrap", auth, async (req, res, next) => {
  try {
    const stations = (await pool.query('SELECT name, sub_vote AS "subVote" FROM stations ORDER BY id')).rows
    const voteItems = (
      await pool.query(`
        SELECT v.vote, v.item, v.sub_item AS "subItem", v.code, v.description,
               COALESCE(array_agg(s.station) FILTER (WHERE s.station IS NOT NULL), ARRAY[]::text[]) AS "allowedStations"
        FROM vote_items v
        LEFT JOIN vote_item_stations s ON s.vote_code = v.code
        GROUP BY v.id
        ORDER BY v.id
      `)
    ).rows
    res.json({ stations, voteItems })
  } catch (e) {
    next(e)
  }
})

app.get("/api/cashbook", auth, async (req, res, next) => {
  try {
    res.json(await getCashbookState())
  } catch (e) {
    next(e)
  }
})

// ── Stage 2: utilize station funds against a vote item ─────────────────────
//
// This is the "second last" step. It earmarks part of the money a station holds
// against a vote item and does NOT touch Cash in Bank — nothing leaves the bank
// until that vote is released.
app.post("/api/vote-utilizations", auth, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const station = asString(req.body?.station).trim()
    // Vote codes are identifiers, not free text: do not normalise surrounding
    // whitespace, otherwise a value absent from the master list can be accepted.
    const voteCode = asString(req.body?.voteCode)
    const amount = asNumber(req.body?.amount)
    const descriptionText = asString(req.body?.description).trim()
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter a valid amount greater than zero.")
    if (!station) throw new HttpError(400, "Please select a station.")
    if (!voteCode) throw new HttpError(400, "Please select a vote item.")

    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const period = await getCurrentPeriod(client)
    const stationRow = (await client.query("SELECT name, sub_vote FROM stations WHERE name = $1", [station])).rows[0]
    if (!stationRow) throw new HttpError(400, "Please select a valid police station.")

    // Station-specific vote items (vote_item_stations) still apply per station.
    const vote = (await client.query(`
      SELECT v.* FROM vote_items v
      WHERE v.code = $1
        AND (
          NOT EXISTS (SELECT 1 FROM vote_item_stations WHERE vote_code = v.code)
          OR EXISTS (SELECT 1 FROM vote_item_stations WHERE vote_code = v.code AND station = $2)
        )
    `, [voteCode, station])).rows[0]
    if (!vote) throw new HttpError(400, "This vote item is not available for the selected station.")

    const allocated = Number((await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM vote_allocations WHERE period_id = $1 AND station = $2",
      [period.id, station],
    )).rows[0].total)
    const utilized = Number((await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM vote_utilizations WHERE period_id = $1 AND station = $2",
      [period.id, station],
    )).rows[0].total)
    if (allocated <= 0) {
      throw new HttpError(400, `${station} has no allocated funds in ${period.period_key}. The administrator must allocate funds to it first.`)
    }
    const available = allocated - utilized
    if (amount > available) {
      throw new HttpError(400, `Insufficient station funds. ${station} has TSh ${money(available)} still unutilized.`)
    }

    const utilizationRef = genRef("VU")
    const r = await client.query(
      `INSERT INTO vote_utilizations
         (utilization_ref, period_id, station, sub_vote, vote_code, vote_description,
          amount, description, officer, officer_name)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *`,
      [utilizationRef, period.id, station, stationRow.sub_vote, vote.code, vote.description,
        amount.toFixed(2), descriptionText, req.user.username, req.user.name],
    )
    await client.query("COMMIT")
    res.status(201).json({
      ...(await getVoteCashbookState(null, client)),
      utilization: rowToUtilization({ ...r.rows[0], released: 0 }),
    })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    next(e)
  } finally {
    client.release()
  }
})

// ── Stage 3: release / spend a utilized vote ──────────────────────────────
//
// The last step, and the only votebook action that debits Cash in Bank: the
// voucher is paid, so the money actually leaves the bank. A utilization can be
// released in several payments until its utilized amount is exhausted.
app.post("/api/vote-releases", auth, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const utilizationId = Number(req.body?.utilizationId)
    const amt = asNumber(req.body?.amount)
    const { payee, purpose, voucherNo, receiptNo, cashbookRef } = req.body || {}
    if (!Number.isInteger(utilizationId) || utilizationId <= 0) throw new HttpError(400, "Please select a utilized vote to release.")
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a valid amount greater than zero.")
    const payeeName = asString(payee).trim()
    if (!payeeName) throw new HttpError(400, "Payee name is required.")
    const purposeText = asString(purpose).trim()
    if (!purposeText) throw new HttpError(400, "Purpose / description is required.")

    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    await getCurrentPeriod(client) // releases are only allowed in the open period
    const utilization = (await client.query(`
      SELECT u.* FROM vote_utilizations u
      JOIN accounting_periods p ON p.id = u.period_id
      WHERE u.id = $1 AND p.status = 'open'
      FOR UPDATE OF u
    `, [utilizationId])).rows[0]
    if (!utilization) throw new HttpError(400, "Please select a valid vote utilization from the open period.")

    const alreadyReleased = Number((await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM vote_expenditures WHERE utilization_id = $1",
      [utilization.id],
    )).rows[0].total)
    const remaining = Number(utilization.amount) - alreadyReleased
    if (amt > remaining) {
      throw new HttpError(400, `Insufficient utilized funds. Available to release: TSh ${money(remaining)}`)
    }

    const vote = (await client.query("SELECT item, sub_item FROM vote_items WHERE code = $1", [utilization.vote_code])).rows[0]

    const expenditureRef = genRef("VE")
    const r = await client.query(
      `INSERT INTO vote_expenditures
         (expenditure_ref, utilization_id, station, sub_vote, vote_code, vote_description, period_id,
          payee, purpose, voucher_no, receipt_no, cashbook_ref, amount, officer, officer_name)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *`,
      [expenditureRef, utilization.id, utilization.station, utilization.sub_vote, utilization.vote_code,
        utilization.vote_description, utilization.period_id, payeeName, purposeText, asString(voucherNo).trim(),
        asString(receiptNo).trim(), asString(cashbookRef).trim(), amt.toFixed(2), req.user.username, req.user.name],
    )
    const entry = await insertEntryIn(client, {
      type: "payment",
      description: utilization.vote_description,
      station: utilization.station,
      officer: req.user.username,
      officerName: req.user.name,
      voteCode: utilization.vote_code,
      voteDescription: utilization.vote_description,
      voteSubVote: utilization.sub_vote,
      voteItem: vote?.item || "",
      voteSubItem: vote?.sub_item || "",
      payee: payeeName,
      purpose: purposeText,
      receiptNo: asString(receiptNo).trim(),
      cashbookRef: asString(cashbookRef).trim(),
      utilizationRef: utilization.utilization_ref,
      debit: amt,
      credit: 0,
    })
    await client.query("COMMIT")
    res.status(201).json({
      ...(await getVoteCashbookState(null, client)),
      entry,
      expenditure: {
        id: r.rows[0].expenditure_ref,
        timestamp: r.rows[0].created_at.toISOString(),
        allocationId: null,
        utilizationId: utilization.id,
        utilizationReference: utilization.utilization_ref,
        station: r.rows[0].station,
        subVote: r.rows[0].sub_vote,
        voteCode: r.rows[0].vote_code,
        voteDescription: r.rows[0].vote_description,
        payee: r.rows[0].payee,
        purpose: r.rows[0].purpose,
        voucherNo: r.rows[0].voucher_no,
        receiptNo: r.rows[0].receipt_no,
        cashbookRef: r.rows[0].cashbook_ref,
        amount: Number(r.rows[0].amount),
        officer: r.rows[0].officer,
        officerName: r.rows[0].officer_name,
      },
    })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    next(e)
  } finally {
    client.release()
  }
})

app.post("/api/cashbook/credits", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  try {
    const { amount, description, ref } = req.body || {}
    const amt = asNumber(amount)
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a valid amount.")
    const descriptionText = asString(description).trim()
    if (!descriptionText) throw new HttpError(400, "Description is required.")

    const entry = await insertEntry({
      type: "receipt",
      description: descriptionText,
      station: CENTRAL_FINANCE,
      officer: req.user.username,
      officerName: req.user.name,
      voteCode: "",
      voteDescription: "",
      voteSubVote: "",
      voteItem: "",
      voteSubItem: "",
      payee: "Government Treasury",
      purpose: descriptionText,
      receiptNo: asString(ref).trim(),
      cashbookRef: asString(ref).trim(),
      debit: 0,
      credit: amt,
    })
    res.status(201).json({ ...(await getCashbookState()), entry })
  } catch (e) {
    next(e)
  }
})

app.put("/api/cashbook/opening-balance", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  try {
    const amt = asNumber(req.body?.amount)
    if (!Number.isFinite(amt) || amt < 0) throw new HttpError(400, "Enter a valid opening balance.")
    const period = await getCurrentPeriod()
    await pool.query("UPDATE accounting_periods SET opening_bank_balance = $1 WHERE id = $2", [amt.toFixed(2), period.id])
    res.json(await getCashbookState())
  } catch (e) {
    next(e)
  }
})

app.get("/api/vote-cashbook", auth, async (req, res, next) => {
  try {
    res.json(await getVoteCashbookState())
  } catch (e) {
    next(e)
  }
})

app.get("/api/accounting-periods", auth, async (req, res, next) => {
  try {
    const periods = await pool.query(`
      SELECT p.period_key AS key, to_char(p.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(p.ends_on, 'YYYY-MM-DD') AS "endsOn",
             p.status, p.opening_bank_balance AS "openingBankBalance",
             COALESCE((SELECT SUM(credit - debit) FROM cashbook_entries e WHERE e.period_id = p.id), 0) AS "bankMovement"
      FROM accounting_periods p ORDER BY p.id DESC
    `)
    res.json({ periods: periods.rows.map(p => ({ ...p, openingBankBalance: Number(p.openingBankBalance), bankMovement: Number(p.bankMovement) })) })
  } catch (e) { next(e) }
})

app.get("/api/accounting-periods/:key", auth, async (req, res, next) => {
  try {
    const period = await getPeriodByKey(req.params.key)
    res.json({ cashbook: await getCashbookState(period), voteCashbook: await getVoteCashbookState(period) })
  } catch (e) { next(e) }
})

app.post("/api/vote-allocations", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const amount = asNumber(req.body?.amount)
    const station = asString(req.body?.station).trim()
    const description = asString(req.body?.description).trim()
    const reference = asString(req.body?.reference).trim()
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter a valid allocation amount.")
    if (!station) throw new HttpError(400, "Please select a station.")
    if (!description) throw new HttpError(400, "Allocation purpose / description is required.")

    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const stationRow = (await client.query("SELECT sub_vote FROM stations WHERE name = $1", [station])).rows[0]
    if (!stationRow) throw new HttpError(400, "Please select a valid police station.")
    const period = await getCurrentPeriod(client)
    // Allocation reserves general bank funds for a station. Vote items are
    // deliberately absent from this stage; they are selected during utilization.
    // The ceiling is the current bank balance less everything already allocated.
    const bank = await client.query(`
      SELECT
        (SELECT opening_bank_balance FROM accounting_periods WHERE id = $1)
        + COALESCE((SELECT SUM(credit - debit) FROM cashbook_entries WHERE period_id = $1), 0)
        - COALESCE((SELECT SUM(amount) FROM vote_allocations WHERE period_id = $1), 0) AS available
    `, [period.id])
    const available = Number(bank.rows[0].available)
    if (amount > available) throw new HttpError(400, `Insufficient unallocated bank funds. Available: TSh ${money(available)}`)

    const allocationRef = genRef("VA")
    const r = await client.query(
      `INSERT INTO vote_allocations
        (allocation_ref, station, sub_vote, amount, reference, description, officer, officer_name, period_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [allocationRef, station, stationRow.sub_vote, amount.toFixed(2), reference, description, req.user.username, req.user.name, period.id],
    )
    await client.query("COMMIT")
    res.status(201).json({ allocation: rowToAllocation(r.rows[0], 0), ...(await getVoteCashbookState(null, client)) })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    next(e)
  } finally {
    client.release()
  }
})

app.post("/api/accounting-periods/close", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const period = await getCurrentPeriod(client)
    const bank = Number((await client.query(
      "SELECT opening_bank_balance + COALESCE((SELECT SUM(credit - debit) FROM cashbook_entries WHERE period_id = $1), 0) AS balance FROM accounting_periods WHERE id = $1",
      [period.id],
    )).rows[0].balance)
    const next = (await client.query(
      `INSERT INTO accounting_periods (period_key, starts_on, ends_on, status, opening_bank_balance)
       VALUES (to_char(($1::date + interval '1 day'), 'YYYY-MM'), $1::date + interval '1 day',
               ($1::date + interval '2 months - 1 day')::date, 'open', $2)
       RETURNING *`,
      [period.starts_on, bank.toFixed(2)],
    )).rows[0]
    const carry = await client.query(
      `SELECT a.station, MAX(a.sub_vote) AS sub_vote, SUM(a.amount) AS allocated,
              COALESCE((SELECT SUM(e.amount) FROM vote_expenditures e
                         WHERE e.period_id = $1 AND e.station = a.station), 0) AS released
       FROM vote_allocations a
       WHERE a.period_id = $1
       GROUP BY a.station`,
      [period.id],
    )
    let carriedAllocations = 0
    for (const row of carry.rows) {
      const remaining = Number(row.allocated) - Number(row.released)
      if (remaining <= 0) continue
      await client.query(
        `INSERT INTO vote_allocations
          (allocation_ref, station, sub_vote, amount, reference, description, officer, officer_name, period_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [genRef("VA"), row.station, row.sub_vote, remaining.toFixed(2),
          `Carry-forward from ${period.period_key}`, `Unspent station funds carried forward from ${period.period_key}`,
          req.user.username, req.user.name, next.id],
      )
      carriedAllocations++
    }
    // Un-released vote earmarks survive too, so a station does not lose the votes
    // it already utilized to vote items when the month rolls over.
    const openUtilizations = await client.query(
      `SELECT u.*, u.amount - COALESCE((SELECT SUM(e.amount) FROM vote_expenditures e WHERE e.utilization_id = u.id), 0) AS remaining
       FROM vote_utilizations u
       WHERE u.period_id = $1`,
      [period.id],
    )
    let carriedUtilizations = 0
    for (const u of openUtilizations.rows) {
      const remaining = Number(u.remaining)
      if (remaining <= 0) continue
      await client.query(
        `INSERT INTO vote_utilizations
          (utilization_ref, period_id, station, sub_vote, vote_code, vote_description,
           amount, description, officer, officer_name)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [genRef("VU"), next.id, u.station, u.sub_vote, u.vote_code, u.vote_description,
          remaining.toFixed(2), `Un-released balance carried forward from ${period.period_key}`,
          req.user.username, req.user.name],
      )
      carriedUtilizations++
    }
    await client.query("UPDATE accounting_periods SET status = 'closed', closed_at = now() WHERE id = $1", [period.id])
    await client.query("COMMIT")
    res.json({
      closed: { key: period.period_key, bankBalance: bank, carriedAllocations, carriedUtilizations },
      current: { key: next.period_key, openingBankBalance: Number(next.opening_bank_balance) },
    })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    next(e)
  } finally {
    client.release()
  }
})

// ── System user management (admin · Central Finance only) ──────────────────
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/

function rowToUser(r) {
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    role: r.role,
    station: r.station,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  }
}

function validateUserFields(body) {
  const errors = []
  const data = {}
  if ("username" in body) {
    const username = asString(body.username).trim()
    if (!USERNAME_RE.test(username)) {
      errors.push("Username must be 3–32 characters using letters, numbers, dot, dash or underscore.")
    } else {
      data.username = username
    }
  }
  if ("password" in body) {
    const password = asString(body.password)
    if (password.length && password.length < 6) {
      errors.push("Password must be at least 6 characters.")
    } else {
      data.password = password
    }
  }
  if ("name" in body) {
    const name = asString(body.name).trim()
    if (!name) errors.push("Full name is required.")
    else data.name = name
  }
  if ("role" in body) {
    const role = asString(body.role).trim()
    if (role !== "admin" && role !== "officer") errors.push("Role must be 'admin' or 'officer'.")
    else data.role = role
  }
  if ("station" in body) data.station = asString(body.station).trim()
  return { data, errors }
}

app.get("/api/users", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  try {
    const r = await pool.query("SELECT id, username, name, role, station, created_at FROM users ORDER BY id ASC")
    res.json({ users: r.rows.map(rowToUser) })
  } catch (e) {
    next(e)
  }
})

app.post("/api/users", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  try {
    const { data, errors } = validateUserFields(req.body || {})
    if (errors.length) throw new HttpError(400, errors.join(" "))
    if (!data.username) throw new HttpError(400, "Username is required.")
    if (!data.password) throw new HttpError(400, "Password is required.")
    if (!data.name) throw new HttpError(400, "Full name is required.")

    const role = data.role || "officer"
    // Officers can post votebook payments for ANY station, so no station is
    // assigned to an officer account. Admins are always Central Finance.
    const station = role === "admin" ? CENTRAL_FINANCE : ""

    const hash = await bcrypt.hash(data.password, 10)
    const r = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, station)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, name, role, station, created_at`,
      [data.username, hash, data.name, role, station],
    )
    if (r.rows.length === 0) {
      throw new HttpError(409, `The username "${data.username}" is already taken.`)
    }
    res.status(201).json({ user: rowToUser(r.rows[0]) })
  } catch (e) {
    next(e)
  }
})

app.put("/api/users/:username", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  try {
    const username = String(req.params.username)
    const current = (await pool.query("SELECT * FROM users WHERE username = $1", [username])).rows[0]
    if (!current) throw new HttpError(404, "User not found.")

    const { data, errors } = validateUserFields(req.body || {})
    if (errors.length) throw new HttpError(400, errors.join(" "))

    const name = data.name ?? current.name
    const role = data.role ?? current.role
    // Officers can post for any station; admins are always Central Finance.
    const station = role === "admin" ? CENTRAL_FINANCE : ""

    // Guards: an admin cannot change their own role, and at least one admin must remain.
    if (current.username === req.user.username && role !== "admin") {
      throw new HttpError(400, "You cannot change your own role.")
    }
    if (current.role === "admin" && role !== "admin") {
      const n = Number((await pool.query("SELECT count(*) AS n FROM users WHERE role = 'admin'")).rows[0].n)
      if (n <= 1) throw new HttpError(400, "At least one administrator must remain. Promote another user first.")
    }

    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : current.password_hash
    const r = await pool.query(
      `UPDATE users SET name = $2, role = $3, station = $4, password_hash = $5
       WHERE username = $1
       RETURNING id, username, name, role, station, created_at`,
      [username, name, role, station, passwordHash],
    )
    res.json({ user: rowToUser(r.rows[0]) })
  } catch (e) {
    next(e)
  }
})

app.delete("/api/users/:username", auth, requireCentralFinanceAdmin, async (req, res, next) => {
  try {
    const username = String(req.params.username)
    if (username === req.user.username) {
      throw new HttpError(400, "You cannot delete your own account.")
    }
    const current = (await pool.query("SELECT role FROM users WHERE username = $1", [username])).rows[0]
    if (!current) throw new HttpError(404, "User not found.")
    if (current.role === "admin") {
      const n = Number((await pool.query("SELECT count(*) AS n FROM users WHERE role = 'admin'")).rows[0].n)
      if (n <= 1) throw new HttpError(400, "At least one administrator must remain. Promote another user first.")
    }
    await pool.query("DELETE FROM users WHERE username = $1", [username])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// Unknown API routes answer as JSON, not the SPA fallback
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }))

// SPA fallback: client-side routes get index.html
app.use((req, res, next) => {
  if (req.method !== "GET") return next()
  const indexPath = path.join(distDir, "index.html")
  if (!existsSync(indexPath)) return next()
  res.sendFile(indexPath)
})

app.use((err, req, res, next) => {
  const status = err.status || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message || "Unexpected server error." })
})

app.listen(PORT, () => {
  console.log(`Votebook API listening on http://localhost:${PORT}`)
})