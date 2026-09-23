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

function rowToAllocation(r) {
  return {
    id: r.id,
    reference: r.allocation_ref,
    timestamp: r.created_at.toISOString(),
    station: r.station,
    subVote: r.sub_vote,
    amount: Number(r.amount),
    used: Number(r.used),
    remaining: Number(r.amount) - Number(r.used),
    allocationReference: r.reference,
    description: r.description,
    officer: r.officer,
    officerName: r.officer_name,
  }
}

async function getVoteCashbookState(period = null) {
  period ||= await getCurrentPeriod()
  const allocations = await pool.query(`
    SELECT a.*, COALESCE(SUM(e.amount), 0) AS used
    FROM vote_allocations a
    LEFT JOIN vote_expenditures e ON e.allocation_id = a.id
    WHERE a.period_id = $1
    GROUP BY a.id
    ORDER BY a.id ASC
  `, [period.id])
  const expenditures = await pool.query(`
    SELECT e.*, a.allocation_ref
    FROM vote_expenditures e
    JOIN vote_allocations a ON a.id = e.allocation_id
    WHERE e.period_id = $1
    ORDER BY e.id ASC
  `, [period.id])
  return {
    period: { key: period.period_key, startsOn: period.starts_label, endsOn: period.ends_label },
    allocations: allocations.rows.map(rowToAllocation),
    expenditures: expenditures.rows.map(r => ({
      id: r.expenditure_ref,
      timestamp: r.created_at.toISOString(),
      allocationId: r.allocation_id,
      allocationReference: r.allocation_ref,
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
  }
}

// Inserts an entry with a serialized balance check. The advisory lock makes the
// read-modify-write atomic even with several stations posting at the same time.
async function insertEntry(f) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
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
          payee, purpose, receipt_no, cashbook_ref, debit, credit, balance)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        entryRef, f.type, f.description, f.station, f.officer, f.officerName,
        f.voteCode, f.voteDescription, f.voteSubVote, f.voteItem, f.voteSubItem, period.id,
        f.payee, f.purpose, f.receiptNo, f.cashbookRef,
        f.debit.toFixed(2), f.credit.toFixed(2), balance.toFixed(2),
      ],
    )
    await client.query("COMMIT")
    return rowToEntry(r.rows[0])
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
      await pool.query('SELECT vote, item, sub_item AS "subItem", code, description FROM vote_items ORDER BY id')
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

app.post("/api/cashbook/payments", auth, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { amount, payee, purpose, voucherNo, receiptNo, cashbookRef } = req.body || {}
    const amt = asNumber(amount)
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a valid amount greater than zero.")
    const payeeName = asString(payee).trim()
    if (!payeeName) throw new HttpError(400, "Payee name is required.")
    const purposeText = asString(purpose).trim()
    if (!purposeText) throw new HttpError(400, "Purpose / description is required.")
    const allocationId = Number(req.body?.allocationId)
    if (!Number.isInteger(allocationId) || allocationId <= 0) throw new HttpError(400, "Please select a vote allocation.")
    const voteCode = asString(req.body?.voteCode).trim()
    const vote = (await pool.query("SELECT * FROM vote_items WHERE code = $1", [voteCode])).rows[0]
    if (!vote) throw new HttpError(400, "Please select a valid vote item.")

    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const allocation = (await client.query(
      "SELECT a.* FROM vote_allocations a JOIN accounting_periods p ON p.id = a.period_id WHERE a.id = $1 AND p.status = 'open' FOR UPDATE",
      [allocationId],
    )).rows[0]
    if (!allocation) throw new HttpError(400, "Please select a valid vote allocation.")
    const used = Number((await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS used FROM vote_expenditures WHERE allocation_id = $1",
      [allocationId],
    )).rows[0].used)
    const remaining = Number(allocation.amount) - used
    if (amt > remaining) throw new HttpError(400, `Insufficient vote allocation. Available: TSh ${money(remaining)}`)

    const expenditureRef = genRef("VE")
    const r = await client.query(
      `INSERT INTO vote_expenditures
        (expenditure_ref, allocation_id, station, sub_vote, vote_code, vote_description, period_id,
        payee, purpose, voucher_no, receipt_no, cashbook_ref, amount, officer, officer_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [expenditureRef, allocation.id, allocation.station, allocation.sub_vote, vote.code,
        vote.description, allocation.period_id, payeeName, purposeText, asString(voucherNo).trim(), asString(receiptNo).trim(),
        asString(cashbookRef).trim(), amt.toFixed(2), req.user.username, req.user.name],
    )
    await client.query("COMMIT")
    res.status(201).json({ ...(await getVoteCashbookState()), expenditure: {
      id: r.rows[0].expenditure_ref,
      timestamp: r.rows[0].created_at.toISOString(),
      allocationId: r.rows[0].allocation_id,
      allocationReference: allocation.allocation_ref,
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
    } })
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
    if (!description) throw new HttpError(400, "Allocation description is required.")

    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const stationRow = (await client.query("SELECT sub_vote FROM stations WHERE name = $1", [station])).rows[0]
    if (!stationRow) throw new HttpError(400, "Please select a valid police station.")
    const period = await getCurrentPeriod(client)
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
       RETURNING *, 0::numeric AS used`,
      [allocationRef, station, stationRow.sub_vote, amount.toFixed(2), reference, description, req.user.username, req.user.name, period.id],
    )
    await client.query("COMMIT")
    res.status(201).json({ allocation: rowToAllocation(r.rows[0]), ...(await getVoteCashbookState()) })
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
      `SELECT a.*, a.amount - COALESCE(SUM(e.amount), 0) AS remaining
       FROM vote_allocations a
       LEFT JOIN vote_expenditures e ON e.allocation_id = a.id
       WHERE a.period_id = $1
       GROUP BY a.id
       HAVING a.amount - COALESCE(SUM(e.amount), 0) > 0`,
      [period.id],
    )
    for (const allocation of carry.rows) {
      await client.query(
        `INSERT INTO vote_allocations
          (allocation_ref, station, sub_vote, amount, reference, description, officer, officer_name, period_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [genRef("VA"), allocation.station, allocation.sub_vote, Number(allocation.remaining).toFixed(2),
          `Carry-forward from ${period.period_key}`, `Unused balance carried forward from ${period.period_key}`,
          req.user.username, req.user.name, next.id],
      )
    }
    await client.query("UPDATE accounting_periods SET status = 'closed', closed_at = now() WHERE id = $1", [period.id])
    await client.query("COMMIT")
    res.json({ closed: { key: period.period_key, bankBalance: bank, carriedAllocations: carry.rowCount }, current: { key: next.period_key, openingBankBalance: Number(next.opening_bank_balance) } })
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