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
    voteSubvote: r.vote_subvote,
    votePk: r.vote_pk,
    voteYear: r.vote_year,
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
          vote_code, vote_description, vote_subvote, vote_pk, vote_year,
          payee, purpose, receipt_no, cashbook_ref, debit, credit, balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        entryRef, f.type, f.description, f.station, f.officer, f.officerName,
        f.voteCode, f.voteDescription, f.voteSubvote, f.votePk, f.voteYear,
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
    const stations = (await pool.query("SELECT name FROM stations ORDER BY id")).rows.map(r => r.name)
    res.json({ stations })
  } catch (e) {
    next(e)
  }
})

app.post("/api/login", async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim()
    const password = String(req.body?.password || "")
    const station = String(req.body?.station || "").trim()

    const u = (await pool.query("SELECT * FROM users WHERE username = $1", [username])).rows[0]
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      throw new HttpError(401, "Invalid credentials. Please check your username and password.")
    }

    let sessionStation
    if (u.role === "admin") {
      if (station && station !== CENTRAL_FINANCE) {
        throw new HttpError(403, "The administrator signs in at Central Finance.")
      }
      sessionStation = CENTRAL_FINANCE
    } else {
      if (station === CENTRAL_FINANCE) {
        throw new HttpError(403, "Only the administrator signs in at Central Finance.")
      }
      const s = await pool.query("SELECT 1 FROM stations WHERE name = $1", [station])
      if (!s.rows.length) throw new HttpError(400, "Please select your police station.")
      sessionStation = station
    }

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
    const stations = (await pool.query("SELECT name FROM stations ORDER BY id")).rows.map(r => r.name)
    const voteItems = (
      await pool.query("SELECT vote, year, subvote, pk, code, description FROM vote_items ORDER BY id")
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
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a valid amount greater than zero.")
    if (!String(payee || "").trim()) throw new HttpError(400, "Payee name is required.")
    if (!String(purpose || "").trim()) throw new HttpError(400, "Purpose / description is required.")
    const vote = (await pool.query("SELECT * FROM vote_items WHERE code = $1", [String(voteCode || "")])).rows[0]
    if (!vote) throw new HttpError(400, "Please select a valid vote item.")

    const entry = await insertEntry({
      type: "payment",
      description: vote.description,
      station: req.user.station,
      officer: req.user.username,
      officerName: req.user.name,
      voteCode: vote.code,
      voteDescription: vote.description,
      voteSubvote: vote.subvote,
      votePk: vote.pk,
      voteYear: vote.year,
      payee: String(payee).trim(),
      purpose: String(purpose).trim(),
      receiptNo: String(receiptNo || "").trim(),
      cashbookRef: String(cashbookRef || "").trim(),
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
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a valid amount.")
    if (!String(description || "").trim()) throw new HttpError(400, "Description is required.")

    const entry = await insertEntry({
      type: "receipt",
      description: String(description).trim(),
      station: CENTRAL_FINANCE,
      officer: req.user.username,
      officerName: req.user.name,
      voteCode: "",
      voteDescription: "",
      voteSubvote: "",
      votePk: "",
      voteYear: "",
      payee: "Government Treasury",
      purpose: String(description).trim(),
      receiptNo: String(ref || "").trim(),
      cashbookRef: String(ref || "").trim(),
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
    const amt = Number(req.body?.amount)
    if (!Number.isFinite(amt) || amt < 0) throw new HttpError(400, "Enter a valid opening balance.")
    await pool.query("UPDATE cashbook_settings SET opening_balance = $1 WHERE id = 1", [amt.toFixed(2)])
    res.json(await getCashbookState())
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