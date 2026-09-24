import { useState, useEffect, useMemo } from "react"
import {
  api,
  loadSession,
  saveSession,
  clearSession,
  type SessionUser,
  type Station,
  type VoteItem,
  type CashbookEntry,
  type CashbookState,
  type VoteAllocation,
  type VoteExpenditure,
  type VoteUtilization,
  type VoteCashbookState,
  type UtilizationPayload,
  type ReleasePayload,
  type CreditPayload,
  type AllocationPayload,
  type AccountingPeriod,
} from "./api"

import UsersAdmin from "./UsersAdmin"

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}
function fmtMoney(n: number, sign = false) {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return sign && n < 0 ? `(${s})` : s
}
const CUR = "TSh"
function currentBalance(state: CashbookState) {
  if (state.entries.length === 0) return state.openingBalance
  return state.entries[state.entries.length - 1].balance
}

// ══════════════════════════════════════════════════════════════════════════
// APPLICATION BRANDING
function GovCrest({ size = 48 }: { size?: number }) {
  return (
  <img
      src="/ys-logo.svg"
      alt="YS CashBook & VoteBook System logo"
      width={size}
      height={size}
      className="rounded-full bg-white object-contain flex-shrink-0"
      style={{ width: size, height: size, padding: 2, border: "1px solid #d1d9e6" }}
    />
  )
}

// ══════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ══════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }: { onLogin: (s: { token: string; user: SessionUser }) => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Station access is assigned to each account by the administrator at Central
  // Finance — officers do not pick a station at sign-in anymore.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError("")
    if (!username.trim()) { setError("Please enter your username."); return }
    if (!password) { setError("Please enter your password."); return }
    setLoading(true)
    try {
      const s = await api.login(username.trim(), password)
      onLogin(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#eef1f6" }}>
      {/* Top gov banner */}
      <div style={{ background: "#1a2744", borderBottom: "3px solid #c9a227" }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="font-mono text-[11px] text-white/60 uppercase tracking-widest">
            YS CashBook & VoteBook System — Official Government Portal
          </div>
          <div className="font-mono text-[11px] text-white/40 uppercase tracking-widest">
            Restricted Access
          </div>
        </div>
      </div>

      {/* Main login area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Crest + title */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <GovCrest size={72} />
          </div>
          <h1 className="font-serif text-2xl font-bold text-[#1a2744] leading-tight">
            YS CashBook & VoteBook System
          </h1>
          <p className="font-serif text-base italic text-[#4b5d84] mt-1">
            Finance &amp; Votebook Management System
          </p>
          <div style={{ width: 80, height: 2, background: "#c9a227", margin: "12px auto 0" }} />
        </div>

        {/* Form card */}
        <div className="w-full max-w-md gov-card">
          {/* Card header */}
          <div className="px-6 py-3" style={{ background: "#1a2744", borderRadius: "3px 3px 0 0" }}>
            <h2 className="text-white font-sans font-semibold text-sm uppercase tracking-widest">
              Secure Sign In
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Username
              </label>
              <input className="gov-input" type="text" value={username}
                onChange={e => setUsername(e.target.value)} placeholder="Enter your username" autoComplete="off"/>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Password
              </label>
              <input className="gov-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Enter your password"/>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Station Access
              </label>
              <p className="font-sans text-sm text-[#4b5d84]">
                Your signing station is <strong>assigned to your account</strong> by the administrator
                at Central Finance — you do not select it here.
              </p>
            </div>

            {error && (
              <div className="px-4 py-2.5 text-sm text-[#991b1b] font-sans"
                style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "2px" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="gov-btn-primary w-full mt-1" style={{ width: "100%" }}>
              {loading ? "Authenticating..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-xs text-[#8a96af] text-center max-w-sm">
          Unauthorised access to this system is a criminal offence. All activity is monitored and logged.
        </p>
      </div>

      {/* Footer */}
      <div style={{ background: "#1a2744", borderTop: "1px solid #253568" }}>
        <div className="max-w-5xl mx-auto px-6 py-3 text-center">
          <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
            Government Financial Management System · Votebook Module · Classified Restricted
          </p>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
function Sidebar({ user, view, onView, onLogout, balance }: {
  user: SessionUser; view: string; onView: (v: string) => void; onLogout: () => void; balance: number
}) {
  // The votebook is a three-stage flow: allocate → utilize → release. Only the
  // last stage (release) moves the shared Cash in Bank.
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "⊞" },
    { id: "utilize",   label: "Utilize to Vote", icon: "✦" },
    { id: "release",   label: "Release / Pay Vote", icon: "⇧" },
    { id: "votebook",  label: "Votebook Modules", icon: "≡" },
    { id: "cashbook",  label: "Cash in Bank", icon: "⊟" },
    { id: "history",   label: "Period History", icon: "◷" },
    ...(user.role === "admin" ? [
      { id: "topup",   label: "Cash in Bank Top-Up", icon: "⊕" },
      { id: "allocate", label: "Allocate to Station", icon: "⇢" },
      { id: "users",   label: "System Users", icon: "▣" },
      { id: "summary", label: "Summary Report", icon: "◈" },
    ] : []),
  ]

  const low = balance < 10000 && balance >= 0

  return (
    <aside className="flex flex-col h-full" style={{ width: 230, background: "#f4f7fc", borderRight: "1px solid #d1d9e6", flexShrink: 0 }}>
      {/* Logo */}
      <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid #d1d9e6" }}>
        <GovCrest size={36} />
        <div>
          <div className="font-serif font-bold text-[#1a2744] text-sm leading-tight">YS CashBook &amp; VoteBook System</div>
          <div className="font-mono text-[9px] text-[#c9a227] uppercase tracking-widest mt-0.5">Votebook System</div>
        </div>
      </div>

      {/* User */}
      <div className="px-5 py-3" style={{ borderBottom: "1px solid #d1d9e6" }}>
        <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest mb-0.5">Signed in as</div>
        <div className="font-sans font-semibold text-sm text-[#1a2744]">{user.name}</div>
        <div className="font-sans text-xs text-[#4b5d84] mt-0.5">{user.station}</div>
        {user.role === "admin" && (
          <span className="chip chip-amber mt-1">ADMIN</span>
        )}
      </div>

      {/* Balance pill */}
      <div className="mx-4 my-3 px-3 py-2.5 rounded-sm"
        style={{ background: low ? "#fef3c7" : "#d1fae5", border: `1px solid ${low ? "#fde68a" : "#a7f3d0"}` }}>
        <div className="font-mono text-[9px] uppercase tracking-widest mb-0.5"
          style={{ color: low ? "#92400e" : "#065f46" }}>
          Cash in Bank Balance
        </div>
        <div className="font-mono font-semibold text-sm"
          style={{ color: low ? "#b45309" : "#047857" }}>
          {CUR} {fmtMoney(balance)}
        </div>
        {low && balance >= 0 && (
          <div className="font-sans text-[10px] text-[#b45309] mt-0.5">⚠ Low balance</div>
        )}
        {balance < 0 && (
          <div className="font-sans text-[10px] text-[#991b1b] mt-0.5">⛔ Overdrawn</div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map(item => (
          <button key={item.id} onClick={() => onView(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all cursor-pointer rounded-sm font-sans font-medium text-sm ${view === item.id ? "nav-active" : "nav-inactive"}`}>
            <span className="text-xs w-4 text-center opacity-70">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Logout */}
      <div className="p-3" style={{ borderTop: "1px solid #d1d9e6" }}>
        <button onClick={onLogout} className="gov-btn-secondary w-full text-center" style={{ width: "100%" }}>
          Sign Out
        </button>
        <p className="font-mono text-[9px] text-[#c3d0e8] text-center mt-2 uppercase tracking-widest">
          {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </p>
      </div>
    </aside>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════
function Dashboard({ cb, user, stations, voteCashbook, onAction }: {
  cb: CashbookState; user: SessionUser; stations: Station[]; voteCashbook: VoteCashbookState; onAction: (v: string) => void
}) {
  const bal = currentBalance(cb)
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayEntries = cb.entries.filter(e => e.type === "payment" && e.timestamp.startsWith(todayStr))
  const todaySpend = todayEntries.reduce((s, e) => s + e.debit, 0)
  const stationEntries = cb.entries.filter(e => e.type === "payment")
  const stationTotal = stationEntries.reduce((s, e) => s + e.debit, 0)
  const recentEntries = cb.entries.slice(-5).reverse()
  const pct = cb.openingBalance > 0 ? Math.min(100, (bal / cb.openingBalance) * 100) : 0
  // Stage totals: allocated (handed to stations) → utilized (earmarked to vote
  // items) → released (actually paid). Only a release reduces Cash in Bank.
  const totals = voteCashbook.totals || { allocated: 0, utilized: 0, unutilized: 0, released: 0, unreleased: 0 }
  const stationFundsHeld = totals.allocated - totals.released
  const unallocatedBank = bal - stationFundsHeld
  const reconciliationDifference = bal - unallocatedBank - stationFundsHeld

  const StatCard = ({ label, value, sub, color = "#1a2744" }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="gov-card p-4">
      <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-2">{label}</div>
      <div className="font-mono text-xl font-semibold" style={{ color }}>{value}</div>
      {sub && <div className="font-sans text-xs text-[#8a96af] mt-1">{sub}</div>}
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      {/* Page title */}
      <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
          {user.role === "admin" ? "Central Finance" : "All Stations"} · Vote 28 · FY 2039–2040
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Finance Dashboard</h1>
      </div>

      {/* Cashbook balance hero */}
      <div className="mb-6 p-5" style={{ background: "#1a2744", borderRadius: "3px", border: "1px solid #253568" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] text-white/50 uppercase tracking-widest mb-1">
              Cash in Bank — Available Balance
            </div>
            <div className={`font-mono text-3xl font-bold ${bal < 0 ? "text-red-400" : bal < 10000 ? "text-amber-300" : "text-emerald-400"}`}>
              {CUR} {fmtMoney(bal)}
            </div>
            <div className="font-sans text-sm text-white/50 mt-1">
              Opening Balance: TSh {fmtMoney(cb.openingBalance)}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">Balance Used</div>
            <div className="font-mono text-2xl font-semibold text-white/70">
              {cb.openingBalance > 0 ? (100 - pct).toFixed(1) : "0.0"}%
            </div>
            <button onClick={() => onAction("utilize")} className="gov-btn-gold mt-3">
              + Utilize Funds
            </button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-4 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct > 50 ? "#10b981" : pct > 20 ? "#f59e0b" : "#ef4444" }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="font-mono text-[9px] text-white/30">TSh 0</span>
          <span className="font-mono text-[9px] text-white/30">TSh {fmtMoney(cb.openingBalance)}</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Released Today" value={`${CUR} ${fmtMoney(todaySpend)}`} sub={`${todayEntries.length} release${todayEntries.length !== 1 ? "s" : ""}`} color="#1e40af"/>
        <StatCard label="Total Released" value={`${CUR} ${fmtMoney(stationTotal)}`} sub={`${stationEntries.length} payments · all stations`} color="#047857"/>
        <StatCard label="Utilized to Votes" value={`${CUR} ${fmtMoney(totals.utilized)}`} sub={`${voteCashbook.utilizations.length} earmark${voteCashbook.utilizations.length !== 1 ? "s" : ""} awaiting release`} color="#b45309"/>
        <StatCard label="Stations Active" value={[...new Set([...cb.entries.map(e => e.station), ...voteCashbook.allocations.map(a => a.station)])].length.toString()} sub={`of ${stations.length} stations`} color="#c9a227"/>
      </div>

      {user.role === "admin" && (
        <div className="gov-card mb-6">
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: "#f4f7fc", borderBottom: "1px solid #d1d9e6" }}>
            <div>
              <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest">Central Finance Reconciliation</div>
              <h2 className="font-serif font-bold text-[#1a2744] text-base mt-1">Cash in Bank vs Station Vote Funds</h2>
            </div>
            <span className={`chip ${Math.abs(reconciliationDifference) < 0.01 ? "chip-green" : "chip-amber"}`}>
              {Math.abs(reconciliationDifference) < 0.01 ? "BALANCED" : "CHECK DIFFERENCE"}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 p-5">
            {[
              ["Cash in Bank", bal, "#047857"],
              ["Unallocated Bank Funds", unallocatedBank, unallocatedBank < 0 ? "#991b1b" : "#1a2744"],
              ["Held by Stations", stationFundsHeld, "#1e40af"],
              ["Not Yet Utilized", totals.unutilized, "#b45309"],
              ["Utilized, Not Released", totals.unreleased, "#92400e"],
              ["Released / Paid", totals.released, "#991b1b"],
            ].map(([label, value, color]) => (
              <div key={label}>
                <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">{label}</div>
                <div className="font-mono text-sm font-semibold mt-1" style={{ color: String(color) }}>TSh {fmtMoney(Number(value))}</div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-4 font-sans text-xs text-[#4b5d84]">
            Allocating and utilizing only reserve funds — the bank is debited when a vote is released.
            Check: Cash in Bank = Unallocated Bank Funds + Held by Stations. Unaccounted difference: <strong className={Math.abs(reconciliationDifference) < 0.01 ? "text-emerald-700" : "text-red-700"}>TSh {fmtMoney(reconciliationDifference)}</strong>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="gov-card">
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #d1d9e6" }}>
          <h2 className="font-serif font-bold text-[#1a2744] text-base">Recent Transactions</h2>
          <button onClick={() => onAction("cashbook")} className="font-sans text-xs text-[#1a2744] underline underline-offset-2 cursor-pointer">View all</button>
        </div>
        {recentEntries.length === 0 ? (
          <div className="p-8 text-center font-sans text-sm text-[#8a96af]">No transactions yet. Post the first entry to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed min-w-[900px]">
              <colgroup>
                <col style={{ width: "11%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "30%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "15%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f4f7fc" }}>
                  {["Date", "Station", "Vote Code", "Description", "Debit (TSh)", "Balance (TSh)"].map((h, index) => (
                    <th key={h} className={`font-mono text-[10px] text-[#8a96af] uppercase tracking-widest px-4 py-2.5 doc-line whitespace-nowrap ${index >= 4 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentEntries.map(e => (
                  <tr key={e.id} className="ledger-row">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#4b5d84] doc-line">{fmtDate(e.timestamp)}</td>
                    <td className="px-4 py-2.5 font-sans text-xs text-[#1a2744] doc-line">{e.station}</td>
                    <td className="px-4 py-2.5 doc-line">
                      {e.type === "payment"
                        ? <span className="chip chip-blue">{e.voteCode}</span>
                        : <span className="chip chip-green">RECEIPT</span>}
                    </td>
                    <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line break-words">{e.description}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-right doc-line" style={{ color: e.type === "payment" ? "#991b1b" : "#047857" }}>
                      {e.type === "payment" ? fmtMoney(e.debit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-right doc-line" style={{ color: "#1a2744" }}>
                      {fmtMoney(e.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// ALLOCATE GENERAL BANK FUNDS TO A STATION (admin only)
// ══════════════════════════════════════════════════════════════════════════
function AllocationForm({ stations, onSave }: {
  stations: Station[]; onSave: (p: AllocationPayload) => Promise<VoteAllocation>
}) {
  const [station, setStation] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [reference, setReference] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setMessage("")
    if (!station || !amount || Number(amount) <= 0 || !description.trim()) {
      setError("Select a station, then enter a positive amount and purpose.")
      return
    }
    setSaving(true)
    try {
      const allocation = await onSave({ amount, station, description: description.trim(), reference: reference.trim() })
      setMessage(`${CUR} ${fmtMoney(allocation.amount)} allocated to ${allocation.station}.`)
      setStation(""); setAmount(""); setDescription(""); setReference("")
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Failed to allocate funds.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-2xl">
        <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Central Finance · Station Funds</div>
          <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Allocate Funds to a Station</h1>
          <p className="font-sans text-xs text-[#8a96af] mt-1">
            Assigns part of the general funds in the bank to a station. The station chooses specific vote items later using Utilize to Vote.
          </p>
        </div>
        {message && <div className="mb-4 px-4 py-3 text-sm text-emerald-800" style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 3 }}>{message}</div>}
        {error && <div className="mb-4 px-4 py-3 text-sm text-red-800" style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 3 }}>{error}</div>}
        <form onSubmit={handleSubmit} className="gov-card p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Station</label>
            <select className="gov-input" value={station} onChange={e => setStation(e.target.value)}>
              <option value="">— Select Station —</option>
              {stations.map(s => <option key={s.name} value={s.name}>{s.name} (Sub-Vote {s.subVote})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Amount to Allocate (TSh)</label>
            <input type="number" min="0.01" step="0.01" className="gov-input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Purpose</label>
            <input className="gov-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Fuel for patrol boats — Q3" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Allocation Reference (optional)</label>
            <input className="gov-input" value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional treasury or internal reference" />
          </div>
          <div className="flex justify-end pt-2" style={{ borderTop: "1px solid #d1d9e6" }}>
            <button type="submit" className="gov-btn-gold" disabled={saving}>{saving ? "Allocating…" : "Allocate Funds"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 2 — UTILIZE STATION FUNDS AGAINST A VOTE ITEM (the second-last step)
// Earmarks money the station holds to a vote item. Nothing is paid and Cash in
// Bank does not move — that only happens when the vote is released.
// ══════════════════════════════════════════════════════════════════════════
function UtilizeForm({ user, voteItems, stations, voteCashbook, onSave }: {
  user: SessionUser; voteItems: VoteItem[]; stations: Station[]; voteCashbook: VoteCashbookState
  onSave: (p: UtilizationPayload) => Promise<VoteUtilization>
}) {
  const [station, setStation] = useState("")
  const [selectedVote, setSelectedVote] = useState<VoteItem | null>(null)
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [success, setSuccess] = useState<VoteUtilization | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Allocations form a general fund for each station. Utilizations then assign
  // that pooled station money to whichever vote items the station selects.
  const stationFunds = useMemo(() => {
    const map = new Map<string, { station: string; subVote: string; allocated: number; utilized: number }>()
    for (const allocation of voteCashbook.allocations) {
      const entry = map.get(allocation.station) || { station: allocation.station, subVote: allocation.subVote, allocated: 0, utilized: 0 }
      entry.allocated += allocation.amount
      map.set(allocation.station, entry)
    }
    for (const utilization of voteCashbook.utilizations) {
      const entry = map.get(utilization.station)
      if (entry) entry.utilized += utilization.amount
    }
    return [...map.values()].map(funds => ({ ...funds, available: funds.allocated - funds.utilized }))
  }, [voteCashbook])

  const selected = stationFunds.find(funds => funds.station === station)
  const available = selected?.available ?? 0
  const amt = Number(amount) || 0

  function validate() {
    const e: Record<string, string> = {}
    if (!station) e.station = "Please select a station"
    if (!selectedVote) e.vote = "Please select a vote item"
    if (!amount || isNaN(amt) || amt <= 0) e.amount = "Enter a valid amount greater than zero"
    if (amt > available) e.amount = `Insufficient station funds. Unutilized: TSh ${fmtMoney(available)}`
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !selectedVote) return
    setSaving(true)
    try {
      const utilization = await onSave({
        station,
        voteCode: selectedVote.code,
        amount,
        description: note.trim(),
      })
      setSuccess(utilization)
      setAmount(""); setNote("")
      setTimeout(() => setSuccess(null), 6000)
    } catch (err) {
      setErrors(p => ({ ...p, amount: err instanceof Error ? err.message : "Failed to utilize funds. Please try again." }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-2xl">
        <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
            Step 2 of 3 · {station || "All Stations"} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
          <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Utilize Funds to a Vote Item</h1>
          <p className="font-sans text-xs text-[#8a96af] mt-1">
            Earmarks money the station holds against a vote item. Cash in Bank is not touched — the vote is paid when you release it.
          </p>
        </div>

        {/* Station funds notice */}
        <div className="mb-5 px-4 py-3 flex items-center justify-between gov-card">
          <div>
            <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">
              {station && selectedVote ? `${station} · ${selectedVote.description} — Unutilized` : station ? `${station} — Unutilized (all votes)` : "Station Funds Unutilized"}
            </div>
            <div className={`font-mono text-lg font-bold ${available < 0 ? "text-red-600" : "text-emerald-700"}`}>
              {CUR} {fmtMoney(station && !selectedVote ? stationFunds.filter(f => f.station === station).reduce((s, f) => s + f.available, 0) : available)}
            </div>
          </div>
          {amt > 0 && (
            <div className="text-right">
              <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Left After Utilizing</div>
              <div className={`font-mono text-lg font-bold ${available - amt < 0 ? "text-red-600" : "text-[#1a2744]"}`}>
                {CUR} {fmtMoney(available - amt)}
              </div>
            </div>
          )}
        </div>

        {success && (
          <div className="mb-5 px-4 py-3" style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: "3px" }}>
            <div className="font-sans font-semibold text-sm text-emerald-800 mb-0.5">
              ✓ Utilized Successfully — {success.reference}
            </div>
            <div className="font-mono text-xs text-emerald-700">
              {CUR} {fmtMoney(success.amount)} earmarked to {success.voteDescription} for {success.station}. Cash in Bank unchanged — release the vote to pay it.
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="gov-card p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Station Funds <span className="text-red-500">*</span>
            </label>
            <select className={`gov-input ${errors.station ? "gov-input-error" : ""}`} value={station}
              onChange={e => {
                setStation(e.target.value)
                setSelectedVote(null)
                setErrors(p => ({ ...p, station: "", vote: "" }))
              }}>
              <option value="">— Select a station with allocated funds —</option>
              {stationFunds.filter(funds => funds.available > 0).map(funds => (
                <option key={funds.station} value={funds.station}>{funds.station} (Sub-Vote {funds.subVote}) · Unutilized TSh {fmtMoney(funds.available)}</option>
              ))}
            </select>
            {errors.station && <p className="font-sans text-xs text-red-600 mt-1">{errors.station}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Vote Item <span className="text-red-500">*</span>
            </label>
            <select className={`gov-input ${errors.vote ? "gov-input-error" : ""}`} value={selectedVote?.code || ""}
              onChange={e => {
                setSelectedVote(voteItems.find(v => v.code === e.target.value) || null)
                setErrors(p => ({ ...p, vote: "" }))
              }}>
              <option value="">— Select a vote item —</option>
              {voteItems
                .filter(v => !station || v.allowedStations.length === 0 || v.allowedStations.includes(station))
                .map(v => <option key={v.code} value={v.code}>{v.code} · {v.description}</option>)}
            </select>
            {errors.vote && <p className="font-sans text-xs text-red-600 mt-1">{errors.vote}</p>}
            {selectedVote && (
              <div className="mt-2 grid grid-cols-4 gap-2 px-3 py-2"
                style={{ background: "#f4f7fc", border: "1px solid #d1d9e6", borderRadius: "2px" }}>
                {[["Vote", selectedVote.vote], ["Sub-Vote", selected?.subVote ?? stations.find(s => s.name === station)?.subVote ?? "—"], ["Item", selectedVote.item], ["Sub-Item", selectedVote.subItem]].map(([l, v]) => (
                  <div key={l}>
                    <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">{l}</div>
                    <div className="font-mono text-xs font-semibold text-[#1a2744]">{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Amount to Utilize (TSh) <span className="text-red-500">*</span>
            </label>
            <input type="number" min="0.01" step="0.01" className={`gov-input ${errors.amount ? "gov-input-error" : ""}`}
              value={amount} onChange={e => { setAmount(e.target.value); setErrors(p => ({ ...p, amount: "" })) }}
              placeholder="0.00" />
            {errors.amount && <p className="font-sans text-xs text-red-600 mt-1">{errors.amount}</p>}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Note (optional)
            </label>
            <textarea rows={3} className="gov-input resize-none"
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Fuel for operations — to be released on voucher"/>
          </div>

          <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #d1d9e6" }}>
            <div>
              <p className="font-sans text-xs text-[#8a96af]">
                Utilizing as <strong className="text-[#1a2744]">{user.name}</strong>
                {station ? <> for <strong className="text-[#1a2744]">{station}</strong></> : null}
              </p>
              <p className="font-sans text-xs text-[#8a96af]">Reserves only — Cash in Bank is unchanged until release</p>
            </div>
            <button type="submit" className="gov-btn-primary" disabled={saving}>{saving ? "Utilizing…" : "Utilize Funds"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 3 — RELEASE / PAY A UTILIZED VOTE (the final step)
// Shows the votes a station has already utilized and posts the actual payment.
// This is the only votebook action that debits Cash in Bank.
// ══════════════════════════════════════════════════════════════════════════
function ReleaseForm({ user, voteCashbook, onSave }: {
  user: SessionUser; voteCashbook: VoteCashbookState
  onSave: (p: ReleasePayload) => Promise<{ expenditure: VoteExpenditure; entry: CashbookEntry }>
}) {
  const [filterStation, setFilterStation] = useState("all")
  const [utilizationId, setUtilizationId] = useState<number | null>(null)
  const [payee, setPayee] = useState("")
  const [purpose, setPurpose] = useState("")
  const [voucherNo, setVoucherNo] = useState("")
  const [receiptNo, setReceiptNo] = useState("")
  const [cashbookRef, setCashbookRef] = useState("")
  const [success, setSuccess] = useState<{ id: string; amount: number; bankBalance: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [releasing, setReleasing] = useState(false)

  const open = voteCashbook.utilizations.filter(u => u.remaining > 0)
  const visible = filterStation === "all" ? open : open.filter(u => u.station === filterStation)
  const selected = open.find(u => u.id === utilizationId)
  const fixedPrice = selected?.amount ?? 0
  const stationsWithVotes = [...new Set(open.map(u => u.station))]

  function pick(u: VoteUtilization) {
    setUtilizationId(u.id)
    setErrors({})
    setSuccess(null)
  }

  function validate() {
    const e: Record<string, string> = {}
    if (!selected) e.utilization = "Please select a utilized vote to release"
    if (!payee.trim()) e.payee = "Payee name is required"
    if (!purpose.trim()) e.purpose = "Purpose / description is required"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !selected) return
    setReleasing(true)
    try {
      const res = await onSave({
        utilizationId: selected.id,
        payee: payee.trim(),
        purpose: purpose.trim(),
        voucherNo: voucherNo.trim(),
        receiptNo: receiptNo.trim(),
        cashbookRef: cashbookRef.trim(),
      })
      setSuccess({ id: res.expenditure.id, amount: res.expenditure.amount, bankBalance: res.entry.balance })
      setUtilizationId(null); setPayee(""); setPurpose(""); setVoucherNo(""); setReceiptNo(""); setCashbookRef("")
    } catch (err) {
      setErrors(p => ({ ...p, form: err instanceof Error ? err.message : "Failed to release the vote." }))
    } finally {
      setReleasing(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
          Step 3 of 3 · {user.station}
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Release / Pay a Utilized Vote</h1>
        <p className="font-sans text-xs text-[#8a96af] mt-1">
          Pick a vote a station has already utilized, pay it, and Cash in Bank is debited here.
        </p>
      </div>

      {success && (
        <div className="mb-5 px-4 py-3" style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: "3px" }}>
          <div className="font-sans font-semibold text-sm text-emerald-800 mb-0.5">✓ Released — {success.id}</div>
          <div className="font-mono text-xs text-emerald-700">
            TSh {fmtMoney(success.amount)} paid. Cash in Bank is now {CUR} {fmtMoney(success.bankBalance)}.
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Utilized votes waiting to be released */}
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-serif font-bold text-[#1a2744]">Utilized Votes Awaiting Release</h2>
            <select className="gov-input" style={{ width: "auto" }} value={filterStation} onChange={e => setFilterStation(e.target.value)}>
              <option value="all">All Stations</option>
              {stationsWithVotes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {visible.length === 0 ? (
            <div className="gov-card p-6 font-sans text-sm text-[#8a96af]">
              Nothing to release yet. Use <strong>Utilize to Vote</strong> to earmark station funds against a vote item first.
            </div>
          ) : (
            <div className="gov-card divide-y divide-[#d1d9e6] overflow-hidden">
              {visible.map(u => (
                <button key={u.id} type="button" onClick={() => pick(u)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer ${utilizationId === u.id ? "bg-[#eef3fb]" : "hover:bg-[#f8f9fc]"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-sans text-sm font-semibold text-[#1a2744]">{u.station} · {u.voteDescription}</div>
                    <div className="font-mono text-[10px] text-[#8a96af] mt-0.5">
                      {u.reference} · {u.voteCode} · Sub-Vote {u.subVote}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Available</div>
                    <div className="font-mono text-sm font-semibold text-emerald-700">TSh {fmtMoney(u.remaining)}</div>
                    <div className="font-mono text-[10px] text-[#c3d0e8]">of {fmtMoney(u.amount)} utilized</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Release form */}
        <div>
          <h2 className="font-serif font-bold text-[#1a2744] mb-3">Post the Payment</h2>
          <form onSubmit={handleSubmit} className="gov-card p-6 space-y-5">
            <div>
              <label htmlFor="fixed-release-price" className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Fixed Utilized Price / Pay Amount
              </label>
              <input
                id="fixed-release-price"
                type="text"
                value={selected ? `${CUR} ${fmtMoney(fixedPrice)}` : ""}
                readOnly
                disabled
                aria-describedby="fixed-release-price-help"
                className="gov-input bg-[#f4f7fc] text-[#1a2744] font-mono font-semibold cursor-not-allowed"
                placeholder="Select a utilized vote to display its fixed price"
              />
              <p id="fixed-release-price-help" className="font-sans text-[11px] text-[#8a96af] mt-1">
                This amount is fixed during Utilize to Vote and cannot be changed here.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Payee / Supplier <span className="text-red-500">*</span>
              </label>
              <input type="text" className={`gov-input ${errors.payee ? "gov-input-error" : ""}`}
                value={payee} onChange={e => { setPayee(e.target.value); setErrors(p => ({ ...p, payee: "" })) }}
                placeholder="Full name of payee or supplier" />
              {errors.payee && <p className="font-sans text-xs text-red-600 mt-1">{errors.payee}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Purpose / Description <span className="text-red-500">*</span>
              </label>
              <textarea rows={3} className={`gov-input resize-none ${errors.purpose ? "gov-input-error" : ""}`}
                value={purpose} onChange={e => { setPurpose(e.target.value); setErrors(p => ({ ...p, purpose: "" })) }}
                placeholder="Describe what is being paid for..."/>
              {errors.purpose && <p className="font-sans text-xs text-red-600 mt-1">{errors.purpose}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Voucher No.</label>
                <input type="text" className="gov-input" value={voucherNo}
                  onChange={e => setVoucherNo(e.target.value)} placeholder="e.g. VOU-00123" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Receipt No.</label>
                <input type="text" className="gov-input" value={receiptNo}
                  onChange={e => setReceiptNo(e.target.value)} placeholder="e.g. REC-00123"/>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Cashbook Ref.</label>
                <input type="text" className="gov-input" value={cashbookRef}
                  onChange={e => setCashbookRef(e.target.value)} placeholder="e.g. CB-2039-001"/>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #d1d9e6" }}>
              <div>
                <p className="font-sans text-xs text-[#8a96af]">
                  Releasing as <strong className="text-[#1a2744]">{user.name}</strong>
                </p>
                <p className="font-sans text-xs text-[#8a96af]">Debits Cash in Bank using the fixed utilized price</p>
              </div>
              <button type="submit" className="gov-btn-gold" disabled={releasing}>{releasing ? "Releasing / Paying…" : "Release / Pay"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// CASHBOOK LEDGER
// ══════════════════════════════════════════════════════════════════════════
function CashbookLedger({ cb, stations }: { cb: CashbookState; stations: Station[] }) {
  const [filterStation, setFilterStation] = useState("all")
  const [filterDate, setFilterDate] = useState("")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    return [...cb.entries].reverse().filter(e => {
      if (filterStation !== "all" && e.station !== filterStation) return false
      if (filterDate && !e.timestamp.startsWith(filterDate)) return false
      if (search) {
        const q = search.toLowerCase()
        if (![e.description, e.payee, e.voteCode, e.id, e.station].some(f => f.toLowerCase().includes(q))) return false
      }
      return true
    })
  }, [cb, filterStation, filterDate, search])

  const totalDebit = filtered.filter(e => e.type === "payment").reduce((s, e) => s + e.debit, 0)
  const totalCredit = filtered.filter(e => e.type === "receipt").reduce((s, e) => s + e.credit, 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6 lg:p-8">
      <div className="mb-5 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
          Cash in Bank · All Stations
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Cash in Bank Ledger</h1>
      </div>

      {/* Opening balance row */}
      <div className="mb-4 px-4 py-2.5 flex items-center justify-between"
        style={{ background: "#f4f7fc", border: "1px solid #d1d9e6", borderRadius: "3px" }}>
        <div className="font-sans text-sm text-[#4b5d84]">
          <span className="font-semibold text-[#1a2744]">Opening Balance</span>
        </div>
        <div className="font-mono font-semibold text-[#1a2744]">TSh {fmtMoney(cb.openingBalance)}</div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select className="gov-input" style={{ width: "auto" }} value={filterStation} onChange={e => setFilterStation(e.target.value)}>
          <option value="all">All Stations</option>
          {stations.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <input type="date" className="gov-input" style={{ width: "auto" }} value={filterDate} onChange={e => setFilterDate(e.target.value)} />
        <input type="text" className="gov-input flex-1" style={{ minWidth: 160 }} placeholder="Search by description, code, payee..." value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      {/* Totals bar */}
      <div className="flex gap-4 mb-3 flex-wrap">
        <div className="font-mono text-xs text-[#8a96af]">
          {filtered.length} records shown
        </div>
        <div className="font-mono text-xs" style={{ color: "#991b1b" }}>
          Debit: {CUR} {fmtMoney(totalDebit)}
        </div>
        <div className="font-mono text-xs" style={{ color: "#047857" }}>
          Credit: {CUR} {fmtMoney(totalCredit)}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto gov-card" style={{ borderRadius: "3px" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="font-serif text-4xl text-[#d1d9e6] mb-3">◻</div>
            <div className="font-serif text-[#8a96af]">No transactions found</div>
            <div className="font-sans text-xs text-[#c3d0e8] mt-1">Adjust your filters or post a new entry</div>
          </div>
        ) : (
          <table className="w-full table-fixed min-w-[1320px]">
            <colgroup>
              <col style={{ width: 105 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 135 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 145 }} />
            </colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr style={{ background: "#1a2744" }}>
                {["Date", "Ref / ID", "Station", "Description", "Vote Code", "Payee", "Debit (TSh)", "Credit (TSh)", "Balance (TSh)"].map((h, index) => (
                  <th key={h} className={`font-mono text-[10px] text-white/60 uppercase tracking-widest px-4 py-3 whitespace-nowrap ${index >= 6 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={e.id} className="ledger-row" style={{ cursor: "default" }}>
                  <td className="px-4 py-2.5 doc-line">
                    <div className="font-mono text-[11px] text-[#4b5d84]">{fmtDate(e.timestamp)}</div>
                    <div className="font-mono text-[10px] text-[#c3d0e8]">{fmtTime(e.timestamp)}</div>
                  </td>
                  <td className="px-4 py-2.5 doc-line">
                    <div className="font-mono text-[11px] font-medium" style={{ color: "#1e40af" }}>{e.id}</div>
                    {e.cashbookRef && <div className="font-mono text-[10px] text-[#c3d0e8]">{e.cashbookRef}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-sans text-xs text-[#1a2744] doc-line">{e.station}</td>
                  <td className="px-4 py-2.5 doc-line">
                    <div className="font-sans text-sm text-[#1a2744] font-medium break-words">{e.description}</div>
                    {e.purpose && <div className="font-sans text-[11px] text-[#8a96af] mt-0.5 break-words">{e.purpose}</div>}
                  </td>
                  <td className="px-4 py-2.5 doc-line">
                    {e.type === "payment"
                      ? <span className="chip chip-blue">{e.voteCode}</span>
                      : <span className="chip chip-green">RECEIPT</span>}
                    {e.type === "payment" && (
                      <div className="font-mono text-[9px] text-[#c3d0e8] mt-0.5">{e.voteItem} · {e.voteSubItem}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line">
                    {e.payee || "—"}
                    {e.receiptNo && <div className="font-mono text-[10px] text-[#8a96af]">{e.receiptNo}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm text-right doc-line" style={{ color: e.debit > 0 ? "#991b1b" : "#c3d0e8" }}>
                    {e.debit > 0 ? fmtMoney(e.debit) : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm text-right doc-line" style={{ color: e.credit > 0 ? "#047857" : "#c3d0e8" }}>
                    {e.credit > 0 ? fmtMoney(e.credit) : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold text-right doc-line"
                    style={{ color: e.balance < 0 ? "#991b1b" : "#1a2744" }}>
                    {fmtMoney(e.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// VOTEBOOK CASH — what each station holds, utilized and released
// ══════════════════════════════════════════════════════════════════════════
function VotebookRecords({ voteCashbook, stations, voteItems }: { voteCashbook: VoteCashbookState; stations: Station[]; voteItems: VoteItem[] }) {
  const [filterStation, setFilterStation] = useState("all")
  const [filterVote, setFilterVote] = useState("all")
  const [search, setSearch] = useState("")

  const payments = voteCashbook.expenditures
  const filtered = useMemo(() =>
    [...payments].reverse().filter(e => {
      if (filterStation !== "all" && e.station !== filterStation) return false
      if (filterVote !== "all" && e.voteCode !== filterVote) return false
      if (search) {
        const q = search.toLowerCase()
        if (![e.voteDescription, e.payee, e.voteCode, e.id, e.officerName, e.purpose].some(f => f.toLowerCase().includes(q))) return false
      }
      return true
    }),
  [payments, filterStation, filterVote, search])

  const uniqueCodes = [...new Set(payments.map(e => e.voteCode))]
  const total = filtered.reduce((s, e) => s + e.amount, 0)
  const totals = voteCashbook.totals || { allocated: 0, utilized: 0, unutilized: 0, released: 0, unreleased: 0 }
  const utilizations = voteCashbook.utilizations

  // Per-station view of the three stages: allocated → utilized → released.
  // The station "available" amount is money that can still be earmarked; it is
  // intentionally separate from the amount awaiting payment after utilization.
  const stationRows = useMemo(() => {
    const map = new Map<string, { station: string; subVote: string; allocated: number; utilized: number; released: number }>()
    for (const a of voteCashbook.allocations) {
      const r = map.get(a.station) || { station: a.station, subVote: a.subVote, allocated: 0, utilized: 0, released: 0 }
      r.allocated += a.amount
      map.set(a.station, r)
    }
    for (const u of voteCashbook.utilizations) {
      const r = map.get(u.station)
      if (r) { r.utilized += u.amount; r.released += u.released }
    }
    return [...map.values()].sort((x, y) => y.allocated - x.allocated)
  }, [voteCashbook])

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-5 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
          Votebook Module · {voteCashbook.period?.key || "current period"}
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Votebook Modules</h1>
        <p className="font-sans text-xs text-[#8a96af] mt-1">
          Money held by each station, what has been utilized to vote items, and what has been released (paid out of Cash in Bank).
        </p>
      </div>

      {/* Stage totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          ["Allocated", totals.allocated, "#1e40af"],
          ["Utilized to Votes", totals.utilized, "#b45309"],
          ["Unutilized (Available to Earmark)", totals.unutilized, "#0f766e"],
          ["Released / Paid", totals.released, "#991b1b"],
          ["Utilized, Not Released", totals.unreleased, "#92400e"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="gov-card p-4">
            <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">{label}</div>
            <div className="font-mono text-lg font-semibold mt-1" style={{ color: String(color) }}>TSh {fmtMoney(Number(value))}</div>
          </div>
        ))}
      </div>

      {/* Per-station funds */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {stationRows.map(s => {
          const unutilized = s.allocated - s.utilized
          return (
            <div key={s.station} className="gov-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest">{s.station} · Sub-Vote {s.subVote}</div>
                  <div className="font-sans font-semibold text-sm text-[#1a2744] mt-1">Station funds</div>
                </div>
                <span className={`chip ${unutilized > 0 ? "chip-green" : "chip-blue"}`}>
                  {unutilized > 0 ? `TSh ${fmtMoney(unutilized)} FREE` : "FULLY UTILIZED"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {[["Allocated", s.allocated], ["Utilized", s.utilized], ["Released", s.released], ["Unutilized", unutilized]].map(([label, value]) => (
                  <div key={String(label)}>
                    <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">{label}</div>
                    <div className="font-mono text-xs font-semibold text-[#1a2744] mt-1">TSh {fmtMoney(Number(value))}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {stationRows.length === 0 && (
          <div className="gov-card p-6 font-sans text-sm text-[#8a96af] md:col-span-2 xl:col-span-3">
            No station has been allocated funds in this period yet.
          </div>
        )}
      </div>
      {/* Utilized votes awaiting release */}
      <div className="gov-card overflow-hidden mb-6">
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: "#1a2744" }}>
          <h2 className="font-mono text-xs text-white/80 uppercase tracking-widest">Utilized Votes</h2>
          <span className="font-mono text-[10px] text-white/50">{utilizations.length} earmark{utilizations.length !== 1 ? "s" : ""}</span>
        </div>
        {utilizations.length === 0 ? (
          <div className="p-5 font-sans text-sm text-[#8a96af]">No station funds have been utilized to a vote item yet.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full table-fixed min-w-[1480px]">
              <colgroup>
                <col style={{ width: 135 }} />
                <col style={{ width: 210 }} />
                <col style={{ width: 190 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 260 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 185 }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f4f7fc" }}>
                  {["Utilized", "Ref", "Station", "Vote Code", "Vote Item", "Utilized (TSh)", "Released (TSh)", "Available (TSh)"].map((h, index) => (
                    <th key={h} className={`font-mono text-[10px] text-[#8a96af] uppercase tracking-widest px-4 py-2.5 doc-line whitespace-nowrap ${index >= 5 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...utilizations].reverse().map(u => (
                  <tr key={u.id} className="ledger-row">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[#4b5d84] doc-line">{fmtDate(u.timestamp)}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] doc-line" style={{ color: "#1e40af" }}>{u.reference}</td>
                    <td className="px-4 py-2.5 font-sans text-xs text-[#1a2744] doc-line">{u.station}</td>
                    <td className="px-4 py-2.5 doc-line"><span className="chip chip-blue">{u.voteCode}</span></td>
                    <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line">{u.voteDescription}</td>
                    <td className="px-4 py-2.5 font-mono text-sm text-right doc-line">{fmtMoney(u.amount)}</td>
                    <td className="px-4 py-2.5 font-mono text-sm text-right doc-line" style={{ color: "#991b1b" }}>{fmtMoney(u.released)}</td>
                    <td className="px-4 py-2.5 font-mono text-sm font-semibold text-right doc-line" style={{ color: u.remaining > 0 ? "#047857" : "#8a96af" }}>{fmtMoney(u.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-3">
        <h2 className="font-serif font-bold text-[#1a2744]">Released Payments</h2>
        <p className="font-sans text-xs text-[#8a96af]">Payments already made — these are the entries that reduced Cash in Bank.</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select className="gov-input" style={{ width: "auto" }} value={filterStation} onChange={e => setFilterStation(e.target.value)}>
          <option value="all">All Stations</option>
          {stations.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <select className="gov-input" style={{ width: "auto" }} value={filterVote} onChange={e => setFilterVote(e.target.value)}>
          <option value="all">All Vote Codes</option>
          {uniqueCodes.map(c => {
            const item = voteItems.find(v => v.code === c)
            return <option key={c} value={c}>{c} — {item?.description}</option>
          })}
        </select>
        <input type="text" className="gov-input flex-1" style={{ minWidth: 140 }}
          placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-xs text-[#8a96af]">{filtered.length} entries</div>
        <div className="font-mono text-sm font-semibold text-[#1a2744]">Total: {CUR} {fmtMoney(total)}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto gov-card">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="font-serif text-4xl text-[#d1d9e6] mb-3">◻</div>
            <div className="font-serif text-[#8a96af]">No entries found</div>
          </div>
        ) : (
          <table className="w-full table-fixed min-w-[1280px]">
            <colgroup>
              <col style={{ width: 105 }} />
              <col style={{ width: 145 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 120 }} />
            </colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr style={{ background: "#1a2744" }}>
                {["Date / Time", "Entry ID", "Station", "Vote Code", "Description", "Payee", "Purpose", "Amount (TSh)", "Officer"].map((h, index) => (
                  <th key={h} className={`font-mono text-[10px] text-white/60 uppercase tracking-widest px-4 py-3 whitespace-nowrap ${index === 7 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="ledger-row">
                  <td className="px-4 py-2.5 doc-line">
                    <div className="font-mono text-[11px] text-[#4b5d84]">{fmtDate(e.timestamp)}</div>
                    <div className="font-mono text-[10px] text-[#c3d0e8]">{fmtTime(e.timestamp)}</div>
                  </td>
                  <td className="px-4 py-2.5 doc-line">
                    <span className="font-mono text-[11px] font-medium" style={{ color: "#1e40af" }}>{e.id}</span>
                  </td>
                  <td className="px-4 py-2.5 font-sans text-xs text-[#1a2744] doc-line">{e.station}</td>
                  <td className="px-4 py-2.5 doc-line">
                    <span className="chip chip-blue">{e.voteCode}</span>
                    <div className="font-mono text-[9px] text-[#c3d0e8] mt-0.5">Sub-Vote {e.subVote} · {e.utilizationReference || "pre-existing entry"}</div>
                  </td>
                  <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line font-medium break-words">{e.voteDescription}</td>
                  <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line">
                    {e.payee}
                    {e.voucherNo && <div className="font-mono text-[10px] text-[#8a96af]">Voucher: {e.voucherNo}</div>}
                    {e.receiptNo && <div className="font-mono text-[10px] text-[#8a96af]">{e.receiptNo}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-sans text-xs text-[#4b5d84] doc-line">
                    <div className="break-words">{e.purpose}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold text-right doc-line" style={{ color: "#991b1b" }}>
                    {fmtMoney(e.amount)}
                  </td>
                  <td className="px-4 py-2.5 font-sans text-xs text-[#4b5d84] doc-line">{e.officerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// CASHBOOK TOP-UP (admin only)
// ══════════════════════════════════════════════════════════════════════════
function TopUpForm({ cb, user, onTopUp, onSetOpening, onClosePeriod }: {
  cb: CashbookState; user: SessionUser
  onTopUp: (p: CreditPayload) => Promise<CashbookEntry>
  onSetOpening: (amount: number) => Promise<void>
  onClosePeriod: () => Promise<string>
}) {
  const [mode, setMode] = useState<"topup" | "opening">("topup")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [ref, setRef] = useState("")
  const [openAmt, setOpenAmt] = useState(cb.openingBalance.toString())
  const [success, setSuccess] = useState("")
  const [err, setErr] = useState("")
  const [closing, setClosing] = useState(false)

  const bal = currentBalance(cb)

  // Hard guard: the shared cashbook balance and credits may only be managed by
  // the administrator signed in at Central Finance. Stations make payments only.
  if (user.role !== "admin" || user.station !== "Central Finance") {
    return (
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-lg gov-card p-6">
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Access Restricted</div>
          <h1 className="font-serif text-xl font-bold text-[#1a2744] mb-2">Cashbook Management Locked</h1>
          <p className="font-sans text-sm text-[#4b5d84]">
            All stations share one Cash in Bank. Station officers utilize station funds and release votes,
            while crediting funds, setting the opening balance, allocating to stations and closing the month
            are reserved for the administrator signed in at <strong>Central Finance</strong>.
          </p>
        </div>
      </div>
    )
  }

  async function handleTopUp(e: React.FormEvent) {
    e.preventDefault(); setErr("")
    const amt = Number(amount)
    if (!amt || amt <= 0) { setErr("Enter a valid amount."); return }
    if (!description.trim()) { setErr("Description is required."); return }
    try {
      const entry = await onTopUp({ amount, description: description.trim(), ref: ref.trim() })
      setSuccess(`${CUR} ${fmtMoney(entry.credit)} credited. New balance: ${CUR} ${fmtMoney(entry.balance)}`)
      setAmount(""); setDescription(""); setRef("")
      setTimeout(() => setSuccess(""), 5000)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to credit the cashbook.")
    }
  }

  async function handleSetOpening(e: React.FormEvent) {
    e.preventDefault(); setErr("")
    const amt = Number(openAmt)
    if (isNaN(amt) || amt < 0) { setErr("Enter a valid opening balance."); return }
    try {
      await onSetOpening(amt)
      setSuccess(`Opening balance set to ${CUR} ${fmtMoney(amt)}`)
      setTimeout(() => setSuccess(""), 5000)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to set the opening balance.")
    }
  }

  async function handleClosePeriod() {
    if (!window.confirm(`Close accounting period ${cb.period?.key || "current month"}? New entries will be recorded in the next period.`)) return
    setErr(""); setClosing(true)
    try {
      setSuccess(await onClosePeriod())
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to close the accounting period.")
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-lg">
        <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Administrator · Finance</div>
          <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Cash in Bank Management</h1>
          <p className="font-sans text-xs text-[#8a96af] mt-1">
            Credits and the opening balance are the money the bank holds. Allocating and utilizing only reserve it — the balance falls when a vote is released.
          </p>
        </div>

        <div className="mb-5 px-4 py-3 gov-card flex items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Open Accounting Period</div>
            <div className="font-mono font-semibold text-[#1a2744]">{cb.period?.key || "Current month"}</div>
          </div>
          <button type="button" onClick={handleClosePeriod} disabled={closing} className="gov-btn-secondary">
            {closing ? "Closing…" : "Close Month & Carry Forward"}
          </button>
        </div>

        {/* Current balance */}
        <div className="mb-6 gov-card p-4 flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Current Balance</div>
            <div className={`font-mono text-2xl font-bold ${bal < 0 ? "text-red-600" : "text-emerald-700"}`}>TSh {fmtMoney(bal)}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Opening Balance</div>
            <div className="font-mono text-lg font-semibold text-[#1a2744]">TSh {fmtMoney(cb.openingBalance)}</div>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex mb-5" style={{ borderBottom: "2px solid #d1d9e6" }}>
          {[["topup", "Add Funds (Credit)"], ["opening", "Set Opening Balance"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m as "topup" | "opening"); setErr(""); setSuccess("") }}
              className="px-5 py-2.5 font-sans font-semibold text-sm cursor-pointer transition-all"
              style={{
                borderBottom: mode === m ? "2px solid #c9a227" : "2px solid transparent",
                color: mode === m ? "#1a2744" : "#8a96af",
                background: "transparent", border: "none",
                marginBottom: -2
              }}>
              {label}
            </button>
          ))}
        </div>

        {success && (
          <div className="mb-4 px-4 py-3 font-sans text-sm text-emerald-800 font-medium"
            style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: "3px" }}>
            ✓ {success}
          </div>
        )}
        {err && (
          <div className="mb-4 px-4 py-3 font-sans text-sm text-red-800"
            style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "3px" }}>
            {err}
          </div>
        )}

        {mode === "topup" && (
          <form onSubmit={handleTopUp} className="gov-card p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Amount to Credit (TSh)</label>
              <input type="number" min="0.01" step="0.01" className="gov-input" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00"/>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Description</label>
              <input type="text" className="gov-input" value={description}
                onChange={e => setDescription(e.target.value)} placeholder="e.g. Treasury Release — Q3 2039"/>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Treasury Reference</label>
              <input type="text" className="gov-input" value={ref}
                onChange={e => setRef(e.target.value)} placeholder="e.g. TREAS-2039-0045"/>
            </div>
            <div className="flex justify-end pt-1">
              <button type="submit" className="gov-btn-gold">Credit Cashbook</button>
            </div>
          </form>
        )}

        {mode === "opening" && (
          <form onSubmit={handleSetOpening} className="gov-card p-5 space-y-4">
            <p className="font-sans text-sm text-[#4b5d84]">
              Set the cashbook opening balance. This resets the reference point for the balance gauge.
              Existing transactions are preserved.
            </p>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Opening Balance (TSh)</label>
              <input type="number" min="0" step="0.01" className="gov-input" value={openAmt}
                onChange={e => setOpenAmt(e.target.value)}/>
            </div>
            <div className="flex justify-end pt-1">
              <button type="submit" className="gov-btn-primary">Save Opening Balance</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// SUMMARY REPORT
// ══════════════════════════════════════════════════════════════════════════
function SummaryReport({ cb, voteCashbook }: { cb: CashbookState; voteCashbook: VoteCashbookState }) {
  const payments = cb.entries.filter(e => e.type === "payment")
  const byStation = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {}
    for (const e of payments) {
      if (!map[e.station]) map[e.station] = { count: 0, total: 0 }
      map[e.station].count++; map[e.station].total += e.debit
    }
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total)
  }, [payments])

  const byVote = useMemo(() => {
    const map: Record<string, { count: number; total: number; desc: string }> = {}
    for (const e of payments) {
      if (!map[e.voteCode]) map[e.voteCode] = { count: 0, total: 0, desc: e.voteDescription }
      map[e.voteCode].count++; map[e.voteCode].total += e.debit
    }
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total)
  }, [payments])

  const grandTotal = payments.reduce((s, e) => s + e.debit, 0)
  const bal = currentBalance(cb)

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Administrator · Finance Report</div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Summary Report — Vote 28 · FY 2039–2040</h1>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          ["Total Released", `${CUR} ${fmtMoney(grandTotal)}`, "#991b1b"],
          ["Utilized to Votes", `${CUR} ${fmtMoney(voteCashbook.totals?.utilized ?? 0)}`, "#b45309"],
          ["Available Balance", `${CUR} ${fmtMoney(bal)}`, bal >= 0 ? "#047857" : "#991b1b"],
          ["Total Payments", payments.length.toString(), "#1e40af"],
        ].map(([label, val, color]) => (
          <div key={label} className="gov-card p-4">
            <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-2">{label}</div>
            <div className="font-mono text-xl font-bold" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By station */}
        <div className="gov-card">
          <div className="px-5 py-3" style={{ background: "#1a2744", borderRadius: "3px 3px 0 0" }}>
            <h2 className="font-sans font-semibold text-sm text-white uppercase tracking-widest">Released by Station</h2>
          </div>
          <div className="p-5 space-y-4">
            {byStation.length === 0 && <p className="font-sans text-sm text-[#8a96af]">No data.</p>}
            {byStation.map(([station, data]) => {
              const pct = grandTotal > 0 ? (data.total / grandTotal) * 100 : 0
              return (
                <div key={station}>
                  <div className="flex justify-between mb-1">
                    <span className="font-sans text-sm text-[#1a2744]">{station}</span>
                    <span className="font-mono text-sm font-semibold" style={{ color: "#991b1b" }}>TSh {fmtMoney(data.total)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full" style={{ background: "#e5e9f0" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#1a2744" }} />
                    </div>
                    <span className="font-mono text-[10px] text-[#8a96af] w-9 text-right">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="font-mono text-[10px] text-[#c3d0e8] mt-0.5">{data.count} entries</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* By vote code */}
        <div className="gov-card">
          <div className="px-5 py-3" style={{ background: "#1a2744", borderRadius: "3px 3px 0 0" }}>
            <h2 className="font-sans font-semibold text-sm text-white uppercase tracking-widest">Released by Vote Code</h2>
          </div>
          <div className="divide-y divide-[#d1d9e6]">
            {byVote.length === 0 && <p className="font-sans text-sm text-[#8a96af] p-5">No data.</p>}
            {byVote.map(([code, data]) => (
              <div key={code} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="chip chip-blue shrink-0">{code}</span>
                  <span className="font-sans text-sm text-[#1a2744] truncate">{data.desc}</span>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold" style={{ color: "#991b1b" }}>TSh {fmtMoney(data.total)}</div>
                  <div className="font-mono text-[10px] text-[#8a96af]">{data.count} entries</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PeriodHistory({ token }: { token: string }) {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [selected, setSelected] = useState<AccountingPeriod | null>(null)
  const [cashbook, setCashbook] = useState<CashbookState | null>(null)
  const [votes, setVotes] = useState<VoteCashbookState | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    api.accountingPeriods(token).then(r => {
      setPeriods(r.periods)
      if (r.periods[0]) setSelected(r.periods[0])
    }).catch(e => setError(e instanceof Error ? e.message : "Failed to load periods."))
  }, [token])

  useEffect(() => {
    if (!selected) return
    api.accountingPeriod(token, selected.key).then(r => {
      setCashbook(r.cashbook); setVotes(r.voteCashbook); setError("")
    }).catch(e => setError(e instanceof Error ? e.message : "Failed to load period history."))
  }, [token, selected])

  const bankClosing = cashbook ? cashbook.openingBalance + cashbook.entries.reduce((sum, e) => sum + e.credit - e.debit, 0) : 0
  const used = votes?.allocations.reduce((sum, a) => sum + a.used, 0) || 0
  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Read-only historical records</div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Accounting Period History</h1>
      </div>
      {error && <div className="mb-4 px-4 py-3 text-sm text-red-800" style={{ background: "#fee2e2", border: "1px solid #fca5a5" }}>{error}</div>}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select className="gov-input" value={selected?.key || ""} onChange={e => setSelected(periods.find(p => p.key === e.target.value) || null)}>
          {periods.map(p => <option key={p.key} value={p.key}>{p.key} · {p.status.toUpperCase()}</option>)}
        </select>
        {selected && <span className="font-mono text-xs text-[#8a96af]">{selected.startsOn.slice(0, 10)} to {selected.endsOn.slice(0, 10)}</span>}
      </div>
      {selected && cashbook && votes && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            {[
              ["Opening Bank", cashbook.openingBalance],
              ["Closing Bank", bankClosing],
              ["Allocated", votes.allocations.reduce((s, a) => s + a.amount, 0)],
              ["Utilized", votes.utilizations.reduce((s, u) => s + u.amount, 0)],
              ["Un-released", votes.utilizations.reduce((s, u) => s + u.remaining, 0)],
              ["Released / Paid", used],
            ].map(([label, value]) => (
              <div key={label} className="gov-card p-4"><div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-2">{label}</div><div className="font-mono text-lg font-semibold text-[#1a2744]">TSh {fmtMoney(Number(value))}</div></div>
            ))}
          </div>
          <div className="gov-card overflow-hidden mb-6">
            <div className="px-5 py-3" style={{ background: "#1a2744" }}><h2 className="font-semibold text-sm text-white uppercase tracking-widest">Bank Transactions</h2></div>
            {cashbook.entries.length === 0 ? <div className="p-5 text-sm text-[#8a96af]">No bank transactions in this period.</div> : <div className="divide-y divide-[#d1d9e6]">{cashbook.entries.map(e => <div key={e.id} className="px-5 py-3 flex justify-between gap-4 text-sm"><span>{e.description}</span><span className="font-mono">{e.credit ? `+TSh ${fmtMoney(e.credit)}` : `-TSh ${fmtMoney(e.debit)}`}</span></div>)}</div>}
          </div>
          <div className="gov-card overflow-hidden mb-6">
            <div className="px-5 py-3" style={{ background: "#1a2744" }}><h2 className="font-semibold text-sm text-white uppercase tracking-widest">Utilized Votes</h2></div>
            {votes.utilizations.length === 0 ? <div className="p-5 text-sm text-[#8a96af]">No vote utilizations in this period.</div> : <div className="divide-y divide-[#d1d9e6]">{votes.utilizations.map(u => <div key={u.id} className="px-5 py-3 flex justify-between gap-4 text-sm"><span>{u.station} · {u.voteCode} · {u.voteDescription}</span><span className="font-mono">TSh {fmtMoney(u.amount)} <span className="text-[#8a96af]">({fmtMoney(u.remaining)} unreleased)</span></span></div>)}</div>}
          </div>
          <div className="gov-card overflow-hidden">
            <div className="px-5 py-3" style={{ background: "#1a2744" }}><h2 className="font-semibold text-sm text-white uppercase tracking-widest">Released Payments</h2></div>
            {votes.expenditures.length === 0 ? <div className="p-5 text-sm text-[#8a96af]">No released payments in this period.</div> : <div className="divide-y divide-[#d1d9e6]">{votes.expenditures.map(e => <div key={e.id} className="px-5 py-3 flex justify-between gap-4 text-sm"><span>{e.station} · {e.voteCode} · {e.payee}</span><span className="font-mono">TSh {fmtMoney(e.amount)}</span></div>)}</div>}
          </div>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(loadSession)
  const user = session?.user ?? null
  const token = session?.token ?? null
  const [view, setView] = useState("dashboard")
  const [cb, setCb] = useState<CashbookState>({ openingBalance: 0, entries: [] })
  const [voteCashbook, setVoteCashbook] = useState<VoteCashbookState>({ allocations: [], utilizations: [], expenditures: [] })
  const [stations, setStations] = useState<Station[]>([])
  const [voteItems, setVoteItems] = useState<VoteItem[]>([])
  const [dataErr, setDataErr] = useState("")
  const [dataTick, setDataTick] = useState(0)
  const [mobileNav, setMobileNav] = useState(false)

  // Load reference data + the cashbook from the API whenever a session is present
  useEffect(() => {
    if (!token) return
    setDataErr("")
    Promise.all([api.bootstrap(token), api.cashbook(token), api.voteCashbook(token)])
      .then(([b, c, v]) => {
        setStations(b.stations)
        setVoteItems(b.voteItems)
        setCb(c)
        setVoteCashbook(v)
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : "Failed to load data."
        if (/expired|not signed in/i.test(msg)) {
          clearSession()
          setSession(null)
        } else {
          setDataErr(msg)
        }
      })
  }, [token, dataTick])

  function handleLogin(s: { token: string; user: SessionUser }) {
    saveSession(s.token, s.user)
    setSession(s)
    setView("dashboard")
  }

  function handleLogout() {
    clearSession()
    setSession(null)
    setView("dashboard")
  }

  // Stage 2 — utilize: earmarks station funds to a vote item. No bank movement.
  async function addUtilization(p: UtilizationPayload): Promise<VoteUtilization> {
    const res = await api.addUtilization(token!, p)
    setVoteCashbook({ allocations: res.allocations, utilizations: res.utilizations, expenditures: res.expenditures, totals: res.totals })
    return res.utilization
  }

  // Stage 3 — release: pays a utilized vote and debits Cash in Bank.
  async function addRelease(p: ReleasePayload): Promise<{ expenditure: VoteExpenditure; entry: CashbookEntry }> {
    const res = await api.addRelease(token!, p)
    setVoteCashbook({ allocations: res.allocations, utilizations: res.utilizations, expenditures: res.expenditures, totals: res.totals })
    setCb(prev => {
      const entries = prev.entries.filter(e => e.id !== res.entry.id)
      return { ...prev, entries: [...entries, res.entry] }
    })
    return { expenditure: res.expenditure, entry: res.entry }
  }

  async function addAllocation(p: AllocationPayload): Promise<VoteAllocation> {
    const res = await api.addAllocation(token!, p)
    setVoteCashbook({ allocations: res.allocations, utilizations: res.utilizations, expenditures: res.expenditures, totals: res.totals })
    return res.allocation
  }

  async function addCredit(p: CreditPayload): Promise<CashbookEntry> {
    const res = await api.addCredit(token!, p)
    setCb({ openingBalance: res.openingBalance, entries: res.entries })
    return res.entry
  }

  async function setOpening(amount: number): Promise<void> {
    setCb(await api.setOpeningBalance(token!, amount))
  }

  async function closePeriod(): Promise<string> {
    const result = await api.closeAccountingPeriod(token!)
    setDataTick(t => t + 1)
    return `${result.closed.key} closed. ${result.closed.carriedAllocations} station fund(s) and ${result.closed.carriedUtilizations} un-released vote(s) carried into ${result.current.key} (opening ${CUR} ${fmtMoney(result.current.openingBankBalance)}).`
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />

  const bal = currentBalance(cb)

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#eef1f6" }}>
      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar user={user} view={view} onView={setView} onLogout={handleLogout} balance={bal} />
      </div>

      {/* Mobile sidebar */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNav(false)} />
          <div className="relative z-10 flex h-full">
            <Sidebar user={user} view={view} onView={v => { setView(v); setMobileNav(false) }} onLogout={handleLogout} balance={bal} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mobile topbar */}
        <div className="flex md:hidden items-center justify-between px-4 py-3"
          style={{ background: "#1a2744", borderBottom: "3px solid #c9a227" }}>
          <button
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation menu"
            className="text-white text-xl cursor-pointer font-bold"
          >
            ☰
          </button>
          <div className="font-serif font-bold text-white text-sm">YS CashBook &amp; VoteBook System</div>
          <div className="font-mono text-xs" style={{ color: "#c9a227" }}>TSh {fmtMoney(bal)}</div>
        </div>

        {dataErr && (
          <div className="px-4 py-2.5 font-sans text-sm flex items-center justify-between"
            style={{ background: "#fee2e2", borderBottom: "1px solid #fca5a5", color: "#991b1b" }}>
            <span>{dataErr}</span>
            <button onClick={() => setDataTick(t => t + 1)} className="font-semibold underline underline-offset-2 cursor-pointer">Retry</button>
          </div>
        )}

        {view === "dashboard" && <Dashboard cb={cb} user={user} stations={stations} voteCashbook={voteCashbook} onAction={setView} />}
        {view === "utilize"   && <UtilizeForm user={user} voteItems={voteItems} stations={stations} voteCashbook={voteCashbook} onSave={addUtilization} />}
        {view === "release"   && <ReleaseForm user={user} voteCashbook={voteCashbook} onSave={addRelease} />}
        {view === "cashbook"  && <CashbookLedger cb={cb} stations={stations} />}
        {view === "votebook"  && <VotebookRecords voteCashbook={voteCashbook} stations={stations} voteItems={voteItems} />}
        {view === "allocate"  && user.role === "admin" && <AllocationForm stations={stations} onSave={addAllocation} />}
        {view === "topup"     && user.role === "admin" && (
          <TopUpForm cb={cb} user={user} onTopUp={addCredit} onSetOpening={setOpening} onClosePeriod={closePeriod} />
        )}
        {view === "users"     && user.role === "admin" && (
          <UsersAdmin token={token!} user={user} />
        )}
        {view === "summary"   && user.role === "admin" && <SummaryReport cb={cb} voteCashbook={voteCashbook} />}
        {view === "history"   && <PeriodHistory token={token!} />}
      </div>
    </div>
  )
}
