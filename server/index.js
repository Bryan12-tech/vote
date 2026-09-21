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

async function getCashbookState() {
  const settings = await pool.query("SELECT opening_balance FROM cashbook_settings WHERE id = 1")
  const entries = await pool.query("SELECT * FROM cashbook_entries ORDER BY id ASC")
  return {
    openingBalance: Number(settings.rows[0]?.opening_balance ?? 0),
    entries: entries.rows.map(rowToEntry),
  }
}

// Inserts an entry with a serialized balance check. The advisory lock makes the
// read-modify-write atomic even with several stations posting at the same time.
async function insertEntry(f) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(913557)")
    const opening = Number(
      (await client.query("SELECT opening_balance FROM cashbook_settings WHERE id = 1")).rows[0].opening_balance,
    )
    const net = Number(
      (await client.query("SELECT COALESCE(SUM(credit - debit), 0) AS net FROM cashbook_entries")).rows[0].net,
    )
    const balance = opening + net + f.credit - f.debit
    if (balance < 0) {
      throw new HttpError(400, `Insufficient balance. Available: TSh ${money(opening + net)}`)
    }
    const entryRef = genRef(f.type === "payment" ? "CB" : "CR")
    const r = await client.query(
      `INSERT INTO cashbook_entries
         (entry_ref, type, description, station, officer, officer_name,
          vote_code, vote_description, vote_sub_vote, vote_item, vote_sub_item,
          payee, purpose, receipt_no, cashbook_ref, debit, credit, balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        entryRef, f.type, f.description, f.station, f.officer, f.officerName,
        f.voteCode, f.voteDescription, f.voteSubVote, f.voteItem, f.voteSubItem,
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
  try {
    const { voteCode, amount, payee, purpose, receiptNo, cashbookRef } = req.body || {}
    const amt = asNumber(amount)
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a valid amount greater than zero.")
    const payeeName = asString(payee).trim()
    if (!payeeName) throw new HttpError(400, "Payee name is required.")
    const purposeText = asString(purpose).trim()
    if (!purposeText) throw new HttpError(400, "Purpose / description is required.")
    // Officers can post for any station — the station is chosen per entry.
    const station = asString(req.body?.station).trim()
    if (!station) throw new HttpError(400, "Please select the station this payment belongs to.")
    const stationRow = (await pool.query("SELECT sub_vote FROM stations WHERE name = $1", [station])).rows[0]
    if (!stationRow) throw new HttpError(400, "Please select a valid police station.")
    const vote = (await pool.query("SELECT * FROM vote_items WHERE code = $1", [asString(voteCode)])).rows[0]
    if (!vote) throw new HttpError(400, "Please select a valid vote item.")

    const entry = await insertEntry({
      type: "payment",
      description: vote.description,
      station,
      officer: req.user.username,
      officerName: req.user.name,
      voteCode: vote.code,
      voteDescription: vote.description,
      voteSubVote: stationRow.sub_vote,
      voteItem: vote.item,
      voteSubItem: vote.sub_item,
      payee: payeeName,
      purpose: purposeText,
      receiptNo: asString(receiptNo).trim(),
      cashbookRef: asString(cashbookRef).trim(),
      debit: amt,
      credit: 0,
    })
    res.status(201).json({ ...(await getCashbookState()), entry })
  } catch (e) {
    next(e)
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
    await pool.query("UPDATE cashbook_settings SET opening_balance = $1 WHERE id = 1", [amt.toFixed(2)])
    res.json(await getCashbookState())
  } catch (e) {
    next(e)
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