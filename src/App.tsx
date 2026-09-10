import { useState, useEffect, useMemo } from "react"
import POLISI_LOGO from "./assets/tanzania-police-logo.jpg"
import {
  api,
  loadSession,
  saveSession,
  clearSession,
  type SessionUser,
  type VoteItem,
  type CashbookEntry,
  type CashbookState,
  type PaymentPayload,
  type CreditPayload,
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
// TANZANIA POLICE FORCE EMBLEM
// ══════════════════════════════════════════════════════════════════════════
function GovCrest({ size = 48 }: { size?: number }) {
  return (
    <img
      src={POLISI_LOGO}
      alt="Tanzania Police Force emblem"
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
            Tanzania Police Force — Official Government Portal
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
            Tanzania Police Force
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
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "⊞" },
    { id: "new",       label: "New Votebook Entry", icon: "✦" },
    { id: "cashbook",  label: "Cashbook Ledger", icon: "⊟" },
    { id: "votebook",  label: "Votebook Records", icon: "≡" },
    ...(user.role === "admin" ? [
      { id: "topup",   label: "Cashbook Top-Up", icon: "⊕" },
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
          <div className="font-serif font-bold text-[#1a2744] text-sm leading-tight">Tanzania Police Force</div>
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
          Cashbook Balance
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
function Dashboard({ cb, user, stations, onAction }: {
  cb: CashbookState; user: SessionUser; stations: string[]; onAction: (v: string) => void
}) {
  const bal = currentBalance(cb)
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayEntries = cb.entries.filter(e => e.type === "payment" && e.timestamp.startsWith(todayStr))
  const todaySpend = todayEntries.reduce((s, e) => s + e.debit, 0)
  const stationEntries = cb.entries.filter(e => e.type === "payment")
  const stationTotal = stationEntries.reduce((s, e) => s + e.debit, 0)
  const recentEntries = cb.entries.slice(-5).reverse()
  const pct = cb.openingBalance > 0 ? Math.min(100, (bal / cb.openingBalance) * 100) : 0

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
          {user.role === "admin" ? "Central Finance" : "All Stations"} · Fiscal Year 2039
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Finance Dashboard</h1>
      </div>

      {/* Cashbook balance hero */}
      <div className="mb-6 p-5" style={{ background: "#1a2744", borderRadius: "3px", border: "1px solid #253568" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] text-white/50 uppercase tracking-widest mb-1">
              Shared Cashbook — Available Balance
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
            <button onClick={() => onAction("new")} className="gov-btn-gold mt-3">
              + New Entry
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
        <StatCard label="Today's Expenditure" value={`${CUR} ${fmtMoney(todaySpend)}`} sub={`${todayEntries.length} transaction${todayEntries.length !== 1 ? "s" : ""}`} color="#1e40af"/>
        <StatCard label="Total Expenditure" value={`${CUR} ${fmtMoney(stationTotal)}`} sub={`${stationEntries.length} entries · all stations`} color="#047857"/>
        <StatCard label="Total Entries" value={cb.entries.filter(e => e.type === "payment").length.toString()} sub="All stations" />
        <StatCard label="Stations Active" value={[...new Set(cb.entries.map(e => e.station))].length.toString()} sub={`of ${stations.length} stations`} color="#c9a227"/>
      </div>

      {/* Recent activity */}
      <div className="gov-card">
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #d1d9e6" }}>
          <h2 className="font-serif font-bold text-[#1a2744] text-base">Recent Transactions</h2>
          <button onClick={() => onAction("cashbook")} className="font-sans text-xs text-[#1a2744] underline underline-offset-2 cursor-pointer">View all</button>
        </div>
        {recentEntries.length === 0 ? (
          <div className="p-8 text-center font-sans text-sm text-[#8a96af]">No transactions yet. Post the first entry to get started.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ background: "#f4f7fc" }}>
                {["Date", "Station", "Vote Code", "Description", "Debit (TSh)", "Balance (TSh)"].map(h => (
                  <th key={h} className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest text-left px-4 py-2.5 doc-line">{h}</th>
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
                  <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line">{e.description}</td>
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
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// NEW VOTEBOOK ENTRY
// ══════════════════════════════════════════════════════════════════════════
function NewEntryForm({ user, cb, voteItems, stations, onSave }: {
  user: SessionUser; cb: CashbookState; voteItems: VoteItem[]; stations: string[]; onSave: (p: PaymentPayload) => Promise<CashbookEntry>
}) {
  const [selectedVote, setSelectedVote] = useState<VoteItem | null>(null)
  const [stationName, setStationName] = useState("")
  const [amount, setAmount] = useState("")
  const [payee, setPayee] = useState("")
  const [purpose, setPurpose] = useState("")
  const [receiptNo, setReceiptNo] = useState("")
  const [cashbookRef, setCashbookRef] = useState("")
  const [success, setSuccess] = useState<CashbookEntry | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [posting, setPosting] = useState(false)

  const bal = currentBalance(cb)
  const amt = Number(amount) || 0

  function validate() {
    const e: Record<string, string> = {}
    if (!stationName) e.station = "Please select the station this payment belongs to"
    if (!selectedVote) e.vote = "Please select a vote item"
    if (!amount || isNaN(amt) || amt <= 0) e.amount = "Enter a valid amount greater than zero"
    if (amt > bal) e.amount = `Insufficient balance. Available: TSh ${fmtMoney(bal)}`
    if (!payee.trim()) e.payee = "Payee name is required"
    if (!purpose.trim()) e.purpose = "Purpose / description is required"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !selectedVote) return
    setPosting(true)
    try {
      const entry = await onSave({
        voteCode: selectedVote.code,
        amount: amount,
        payee: payee.trim(),
        purpose: purpose.trim(),
        receiptNo: receiptNo.trim(),
        cashbookRef: cashbookRef.trim(),
        station: stationName,
      })
      setSuccess(entry)
      setStationName(""); setSelectedVote(null); setAmount(""); setPayee(""); setPurpose(""); setReceiptNo(""); setCashbookRef("")
      setTimeout(() => setSuccess(null), 6000)
    } catch (err) {
      setErrors(p => ({ ...p, amount: err instanceof Error ? err.message : "Failed to post entry. Please try again." }))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-2xl">
        <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
            {stationName || "All Stations"} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
          <h1 className="font-serif text-2xl font-bold text-[#1a2744]">New Votebook Entry</h1>
        </div>

        {/* Balance notice */}
        <div className="mb-5 px-4 py-3 flex items-center justify-between gov-card">
          <div>
            <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Available Balance</div>
            <div className={`font-mono text-lg font-bold ${bal < 0 ? "text-red-600" : "text-emerald-700"}`}>
              {CUR} {fmtMoney(bal)}
            </div>
          </div>
          {amt > 0 && (
            <div className="text-right">
              <div className="font-mono text-[9px] text-[#8a96af] uppercase tracking-widest">Remaining After Entry</div>
              <div className={`font-mono text-lg font-bold ${bal - amt < 0 ? "text-red-600" : "text-[#1a2744]"}`}>
                {CUR} {fmtMoney(bal - amt)}
              </div>
            </div>
          )}
        </div>

        {success && (
          <div className="mb-5 px-4 py-3" style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: "3px" }}>
            <div className="font-sans font-semibold text-sm text-emerald-800 mb-0.5">
              ✓ Entry Posted Successfully — {success.id}
            </div>
            <div className="font-mono text-xs text-emerald-700">
              {CUR} {fmtMoney(success.debit)} debited · New balance: {CUR} {fmtMoney(success.balance)}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="gov-card p-6 space-y-5">
          {/* Station */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Station <span className="text-red-500">*</span>
            </label>
            <select
              className={`gov-input ${errors.station ? "gov-input-error" : ""}`}
              value={stationName}
              onChange={e => { setStationName(e.target.value); setErrors(p => ({ ...p, station: "" })) }}>
              <option value="">— Select Station —</option>
              {stations.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.station && <p className="font-sans text-xs text-red-600 mt-1">{errors.station}</p>}
          </div>

          {/* Vote selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Vote Item / Code <span className="text-red-500">*</span>
            </label>
            <select
              className={`gov-input ${errors.vote ? "gov-input-error" : ""}`}
              value={selectedVote ? `${selectedVote.code}|${selectedVote.description}` : ""}
              onChange={e => {
                const val = e.target.value
                setSelectedVote(voteItems.find(v => `${v.code}|${v.description}` === val) || null)
                setErrors(p => ({ ...p, vote: "" }))
              }}>
              <option value="">— Select Vote Item —</option>
              {voteItems.map(v => (
                <option key={v.code + v.description} value={`${v.code}|${v.description}`}>
                  {v.code}  ·  {v.description}
                </option>
              ))}
            </select>
            {errors.vote && <p className="font-sans text-xs text-red-600 mt-1">{errors.vote}</p>}

            {selectedVote && (
              <div className="mt-2 grid grid-cols-4 gap-2 px-3 py-2"
                style={{ background: "#f4f7fc", border: "1px solid #d1d9e6", borderRadius: "2px" }}>
                {[["Vote", selectedVote.vote], ["Sub-Vote", selectedVote.subVote], ["Item", selectedVote.item], ["Sub-Item", selectedVote.subItem]].map(([l, v]) => (
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
              Amount (TSh) <span className="text-red-500">*</span>
            </label>
            <input type="number" min="0.01" step="0.01" className={`gov-input ${errors.amount ? "gov-input-error" : ""}`}
              value={amount} onChange={e => { setAmount(e.target.value); setErrors(p => ({ ...p, amount: "" })) }}
              placeholder="0.00" />
            {errors.amount && <p className="font-sans text-xs text-red-600 mt-1">{errors.amount}</p>}
          </div>

          {/* Payee */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Payee / Supplier <span className="text-red-500">*</span>
            </label>
            <input type="text" className={`gov-input ${errors.payee ? "gov-input-error" : ""}`}
              value={payee} onChange={e => { setPayee(e.target.value); setErrors(p => ({ ...p, payee: "" })) }}
              placeholder="Full name of payee or supplier" />
            {errors.payee && <p className="font-sans text-xs text-red-600 mt-1">{errors.payee}</p>}
          </div>

          {/* Purpose */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Purpose / Description <span className="text-red-500">*</span>
            </label>
            <textarea rows={3} className={`gov-input resize-none ${errors.purpose ? "gov-input-error" : ""}`}
              value={purpose} onChange={e => { setPurpose(e.target.value); setErrors(p => ({ ...p, purpose: "" })) }}
              placeholder="Describe the purpose of this expenditure in detail..."/>
            {errors.purpose && <p className="font-sans text-xs text-red-600 mt-1">{errors.purpose}</p>}
          </div>

          {/* Receipt + Cashbook ref */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Receipt No.
              </label>
              <input type="text" className="gov-input" value={receiptNo}
                onChange={e => setReceiptNo(e.target.value)} placeholder="e.g. REC-00123"/>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
                Cashbook Ref.
              </label>
              <input type="text" className="gov-input" value={cashbookRef}
                onChange={e => setCashbookRef(e.target.value)} placeholder="e.g. CB-2039-001"/>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #d1d9e6" }}>
            <div>
              <p className="font-sans text-xs text-[#8a96af]">
                Posting as <strong className="text-[#1a2744]">{user.name}</strong>
                {stationName ? <> for <strong className="text-[#1a2744]">{stationName}</strong></> : null}
              </p>
              <p className="font-sans text-xs text-[#8a96af]">Shared cashbook · all stations</p>
            </div>
            <button type="submit" className="gov-btn-primary" disabled={posting}>{posting ? "Posting…" : "Post Entry"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// CASHBOOK LEDGER
// ══════════════════════════════════════════════════════════════════════════
function CashbookLedger({ cb, stations }: { cb: CashbookState; stations: string[] }) {
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
          Shared Cashbook · All Stations
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Cashbook Ledger</h1>
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
          {stations.map(s => <option key={s} value={s}>{s}</option>)}
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
          <table className="w-full min-w-[900px]">
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr style={{ background: "#1a2744" }}>
                {["Date", "Ref / ID", "Station", "Description", "Vote Code", "Payee", "Debit (TSh)", "Credit (TSh)", "Balance (TSh)"].map(h => (
                  <th key={h} className="font-mono text-[10px] text-white/60 uppercase tracking-widest text-left px-4 py-3">{h}</th>
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
                    <div className="font-sans text-sm text-[#1a2744] font-medium">{e.description}</div>
                    {e.purpose && <div className="font-sans text-[11px] text-[#8a96af] mt-0.5 max-w-[180px] truncate">{e.purpose}</div>}
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
// VOTEBOOK RECORDS (votebook entries only, by station)
// ══════════════════════════════════════════════════════════════════════════
function VotebookRecords({ cb, stations, voteItems }: { cb: CashbookState; stations: string[]; voteItems: VoteItem[] }) {
  const [filterStation, setFilterStation] = useState("all")
  const [filterVote, setFilterVote] = useState("all")
  const [search, setSearch] = useState("")

  const payments = cb.entries.filter(e => e.type === "payment")
  const filtered = useMemo(() =>
    [...payments].reverse().filter(e => {
      if (filterStation !== "all" && e.station !== filterStation) return false
      if (filterVote !== "all" && e.voteCode !== filterVote) return false
      if (search) {
        const q = search.toLowerCase()
        if (![e.description, e.payee, e.voteCode, e.id, e.officerName, e.purpose].some(f => f.toLowerCase().includes(q))) return false
      }
      return true
    }),
  [payments, filterStation, filterVote, search])

  const uniqueCodes = [...new Set(payments.map(e => e.voteCode))]
  const total = filtered.reduce((s, e) => s + e.debit, 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6 lg:p-8">
      <div className="mb-5 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Votebook Module</div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Votebook Records</h1>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select className="gov-input" style={{ width: "auto" }} value={filterStation} onChange={e => setFilterStation(e.target.value)}>
          <option value="all">All Stations</option>
          {stations.map(s => <option key={s} value={s}>{s}</option>)}
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
          <table className="w-full min-w-[800px]">
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr style={{ background: "#1a2744" }}>
                {["Date / Time", "Entry ID", "Station", "Vote Code", "Description", "Payee", "Purpose", "Amount (TSh)", "Officer"].map(h => (
                  <th key={h} className="font-mono text-[10px] text-white/60 uppercase tracking-widest text-left px-4 py-3">{h}</th>
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
                    <div className="font-mono text-[9px] text-[#c3d0e8] mt-0.5">{e.voteItem} · {e.voteSubItem}</div>
                  </td>
                  <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line font-medium">{e.voteDescription}</td>
                  <td className="px-4 py-2.5 font-sans text-sm text-[#1a2744] doc-line">
                    {e.payee}
                    {e.receiptNo && <div className="font-mono text-[10px] text-[#8a96af]">{e.receiptNo}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-sans text-xs text-[#4b5d84] doc-line max-w-[160px]">
                    <div className="truncate">{e.purpose}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold text-right doc-line" style={{ color: "#991b1b" }}>
                    {fmtMoney(e.debit)}
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
function TopUpForm({ cb, user, onTopUp, onSetOpening }: {
  cb: CashbookState; user: SessionUser
  onTopUp: (p: CreditPayload) => Promise<CashbookEntry>
  onSetOpening: (amount: number) => Promise<void>
}) {
  const [mode, setMode] = useState<"topup" | "opening">("topup")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [ref, setRef] = useState("")
  const [openAmt, setOpenAmt] = useState(cb.openingBalance.toString())
  const [success, setSuccess] = useState("")
  const [err, setErr] = useState("")

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
            All stations share one cashbook. Station officers may make votebook payments (debits) only —
            crediting funds and setting the opening balance are reserved for the administrator
            signed in at <strong>Central Finance</strong>.
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

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-lg">
        <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Administrator · Finance</div>
          <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Cashbook Management</h1>
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
                background: "transparent", border: "none", borderBottom: mode === m ? "2px solid #c9a227" : "2px solid transparent",
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
function SummaryReport({ cb }: { cb: CashbookState }) {
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
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">Summary Report — Fiscal Year 2039</h1>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          ["Total Expenditure", `${CUR} ${fmtMoney(grandTotal)}`, "#991b1b"],
          ["Available Balance", `${CUR} ${fmtMoney(bal)}`, bal >= 0 ? "#047857" : "#991b1b"],
          ["Total Entries", payments.length.toString(), "#1e40af"],
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
            <h2 className="font-sans font-semibold text-sm text-white uppercase tracking-widest">Expenditure by Station</h2>
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
            <h2 className="font-sans font-semibold text-sm text-white uppercase tracking-widest">Expenditure by Vote Code</h2>
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

// ══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(loadSession)
  const user = session?.user ?? null
  const token = session?.token ?? null
  const [view, setView] = useState("dashboard")
  const [cb, setCb] = useState<CashbookState>({ openingBalance: 0, entries: [] })
  const [stations, setStations] = useState<string[]>([])
  const [voteItems, setVoteItems] = useState<VoteItem[]>([])
  const [dataErr, setDataErr] = useState("")
  const [dataTick, setDataTick] = useState(0)
  const [mobileNav, setMobileNav] = useState(false)

  // Load reference data + the cashbook from the API whenever a session is present
  useEffect(() => {
    if (!token) return
    setDataErr("")
    Promise.all([api.bootstrap(token), api.cashbook(token)])
      .then(([b, c]) => {
        setStations(b.stations)
        setVoteItems(b.voteItems)
        setCb(c)
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

  async function addPayment(p: PaymentPayload): Promise<CashbookEntry> {
    const res = await api.addPayment(token!, p)
    setCb({ openingBalance: res.openingBalance, entries: res.entries })
    return res.entry
  }

  async function addCredit(p: CreditPayload): Promise<CashbookEntry> {
    const res = await api.addCredit(token!, p)
    setCb({ openingBalance: res.openingBalance, entries: res.entries })
    return res.entry
  }

  async function setOpening(amount: number): Promise<void> {
    setCb(await api.setOpeningBalance(token!, amount))
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
          <button onClick={() => setMobileNav(true)} className="text-white text-xl cursor-pointer font-bold">☰</button>
          <div className="font-serif font-bold text-white text-sm">Police Votebook System</div>
          <div className="font-mono text-xs" style={{ color: "#c9a227" }}>TSh {fmtMoney(bal)}</div>
        </div>

        {dataErr && (
          <div className="px-4 py-2.5 font-sans text-sm flex items-center justify-between"
            style={{ background: "#fee2e2", borderBottom: "1px solid #fca5a5", color: "#991b1b" }}>
            <span>{dataErr}</span>
            <button onClick={() => setDataTick(t => t + 1)} className="font-semibold underline underline-offset-2 cursor-pointer">Retry</button>
          </div>
        )}

        {view === "dashboard" && <Dashboard cb={cb} user={user} stations={stations} onAction={setView} />}
        {view === "new"       && <NewEntryForm user={user} cb={cb} voteItems={voteItems} stations={stations} onSave={addPayment} />}
        {view === "cashbook"  && <CashbookLedger cb={cb} stations={stations} />}
        {view === "votebook"  && <VotebookRecords cb={cb} stations={stations} voteItems={voteItems} />}
        {view === "topup"     && user.role === "admin" && (
          <TopUpForm cb={cb} user={user} onTopUp={addCredit} onSetOpening={setOpening} />
        )}
        {view === "users"     && user.role === "admin" && (
          <UsersAdmin token={token!} user={user} />
        )}
        {view === "summary"   && user.role === "admin" && <SummaryReport cb={cb} />}
      </div>
    </div>
  )
}
