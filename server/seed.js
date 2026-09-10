import { readFileSync } from "node:fs"
import bcrypt from "bcryptjs"
import { pool } from "./db.js"

const STATIONS = [
  "Mkoani",
  "Chakechake",
  "Makao Kusini Pemba",
  "Wete",
  "Micheweni",
  "Makao Kaskazini Pemba",
]

const USERS = [
  { username: "admin",    password: "admin123", role: "admin",   name: "Chief Finance Officer" },
  { username: "officer1", password: "pass1234", role: "officer", name: "Sgt. M. Banda" },
  { username: "officer2", password: "pass1234", role: "officer", name: "Cpl. T. Phiri" },
  { username: "officer3", password: "pass1234", role: "officer", name: "Insp. J. Moyo" },
]

async function waitForDb(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1")
      return
    } catch (e) {
      console.log(`Database not ready (attempt ${attempt}/${retries}): ${e.message}`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw new Error("Database did not become ready in time")
}

async function main() {
  await waitForDb()

  // 1. Schema (idempotent)
  await pool.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"))

  // 2. Reference data (idempotent)
  await pool.query(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"))

  // 3. Users with bcrypt-hashed passwords (idempotent)
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10)
    const station = u.role === "admin" ? "Central Finance" : ""
    await pool.query(
      `INSERT INTO users (username, password_hash, name, role, station)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      [u.username, hash, u.name, u.role, station],
    )
    // Keep the access model consistent across re-seeds and older databases:
    // officers can post for ANY station (station = ''), admins are Central Finance.
    await pool.query(
      "UPDATE users SET station = $2 WHERE username = $1 AND role = $3",
      [u.username, station, u.role],
    )
  }

  const counts = await pool.query(
    `SELECT (SELECT count(*) FROM stations) AS stations,
            (SELECT count(*) FROM vote_items) AS vote_items,
            (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM cashbook_entries) AS entries`,
  )
  console.log("Seed complete:", counts.rows[0])
  await pool.end()
}

main().catch(err => {
  console.error("Seed failed:", err)
  process.exit(1)
})