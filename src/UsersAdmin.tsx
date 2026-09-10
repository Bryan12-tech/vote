import { useState, useEffect } from "react"
import { api, type SessionUser, type UserRecord, type UserPayload } from "./api"

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM USERS — ADMINISTRATOR (CENTRAL FINANCE) ONLY
// The administrator creates officer accounts and assigns each officer a station.
// ══════════════════════════════════════════════════════════════════════════
export default function UsersAdmin({ token, user, stations }: {
  token: string; user: SessionUser; stations: string[]
}) {
  const [records, setRecords] = useState<UserRecord[]>([])
  const [err, setErr] = useState("")
  const [ok, setOk] = useState("")
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<UserRecord | null>(null)

  const [fName, setFName] = useState("")
  const [fUsername, setFUsername] = useState("")
  const [fPassword, setFPassword] = useState("")
  const [fRole, setFRole] = useState<"officer" | "admin">("officer")
  const [fStation, setFStation] = useState("")

  async function refresh() {
    try {
      setRecords((await api.users(token)).users)
      setErr("")
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to load users.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [token])

  function resetForm() {
    setEditing(null)
    setFName(""); setFUsername(""); setFPassword("")
    setFRole("officer"); setFStation("")
    setErr(""); setOk("")
  }

  function startEdit(u: UserRecord) {
    setEditing(u)
    setFName(u.name); setFUsername(u.username); setFPassword("")
    setFRole(u.role); setFStation(u.station === "Central Finance" ? "" : u.station)
    setErr(""); setOk("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setOk("")
    if (!fName.trim()) { setErr("Full name is required."); return }
    if (!editing && !fUsername.trim()) { setErr("Username is required."); return }
    if (!editing && fPassword.length < 6) { setErr("Password must be at least 6 characters."); return }
    if (fRole === "officer" && !fStation.trim()) { setErr("Please assign the officer to a station."); return }

    const payload: UserPayload = { name: fName.trim(), role: fRole }
    if (fPassword) payload.password = fPassword
    payload.station = fRole === "admin" ? "Central Finance" : fStation.trim()

    try {
      if (editing) {
        await api.updateUser(token, editing.username, payload)
        setOk(`Updated ${editing.username}.`)
      } else {
        await api.createUser(token, { ...payload, username: fUsername.trim() })
        setOk(`Created user ${fUsername.trim()}.`)
      }
      resetForm()
      await refresh()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to save the user.")
    }
  }

  async function handleDelete(u: UserRecord) {
    if (!window.confirm(`Delete user "${u.username}" (${u.name})? Their past cashbook entries remain on record.`)) return
    setErr(""); setOk("")
    try {
      await api.deleteUser(token, u.username)
      setOk(`Deleted ${u.username}.`)
      if (editing?.username === u.username) resetForm()
      await refresh()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to delete the user.")
    }
  }

  // Hard guard: only the administrator at Central Finance manages user accounts.
  if (user.role !== "admin" || user.station !== "Central Finance") {
    return (
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-lg gov-card p-6">
          <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">Access Restricted</div>
          <h1 className="font-serif text-xl font-bold text-[#1a2744] mb-2">User Management Locked</h1>
          <p className="font-sans text-sm text-[#4b5d84]">
            User accounts are created and managed only by the administrator signed in at
            <strong>Central Finance</strong>.
          </p>
        </div>
      </div>
    )
  }

  const officerCount = records.filter(r => r.role === "officer").length
  const adminCount = records.length - officerCount

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 pb-4" style={{ borderBottom: "2px solid #d1d9e6" }}>
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
          Administrator · Central Finance · User Accounts
        </div>
        <h1 className="font-serif text-2xl font-bold text-[#1a2744]">System Users</h1>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          ["Total Accounts", records.length.toString(), "#1a2744"],
          ["Officers", officerCount.toString(), "#1e40af"],
          ["Administrators", adminCount.toString(), "#b45309"],
        ].map(([label, val, color]) => (
          <div key={label} className="gov-card p-4">
            <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-2">{label}</div>
            <div className="font-mono text-xl font-bold" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {err && (
        <div className="mb-4 px-4 py-2.5 text-sm text-[#991b1b]"
          style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "2px" }}>{err}</div>
      )}
      {ok && (
        <div className="mb-4 px-4 py-2.5 text-sm text-[#047857]"
          style={{ background: "#d1fae5", border: "1px solid #a7f3d0", borderRadius: "2px" }}>{ok}</div>
      )}

      {/* Create / edit form */}
      <form onSubmit={handleSubmit} className="gov-card p-5 space-y-4">
        <div className="font-mono text-[10px] text-[#8a96af] uppercase tracking-widest mb-1">
          {editing ? `Edit User — ${editing.username}` : "Register New User"}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Full Name</label>
            <input className="gov-input" value={fName} onChange={e => setFName(e.target.value)}
              placeholder="e.g. Sgt. A. Kombo" autoComplete="off"/>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Username</label>
            <input className="gov-input" value={fUsername} disabled={!!editing}
              onChange={e => setFUsername(e.target.value)} placeholder="e.g. officer4" autoComplete="off"/>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">
              Password {editing ? "(blank = unchanged)" : ""}
            </label>
            <input className="gov-input" type="text" value={fPassword}
              onChange={e => setFPassword(e.target.value)}
              placeholder={editing ? "Leave blank to keep current" : "Min 6 characters"} autoComplete="new-password"/>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Role</label>
            <select className="gov-input" value={fRole}
              onChange={e => setFRole(e.target.value === "admin" ? "admin" : "officer")}>
              <option value="officer">Officer</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          {fRole === "admin" ? (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Station</label>
              <input className="gov-input" value="Central Finance" disabled/>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#4b5d84] mb-1.5">Assigned Station</label>
              <select className="gov-input" value={fStation} onChange={e => setFStation(e.target.value)}>
                <option value="">— Select Station —</option>
                {stations.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-1">
          {editing && (
            <button type="button" onClick={resetForm} className="gov-btn-secondary">Cancel</button>
          )}
          <button type="submit" className="gov-btn-gold">{editing ? "Save Changes" : "Create User"}</button>
        </div>
      </form>

      {/* User table */}
      <div className="gov-card overflow-hidden">
        <div className="px-5 py-3" style={{ background: "#1a2744" }}>
          <h2 className="font-sans font-semibold text-sm text-white uppercase tracking-widest">
            Accounts ({records.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 font-sans text-sm text-[#8a96af]">Loading users…</div>
        ) : records.length === 0 ? (
          <div className="p-6 font-sans text-sm text-[#8a96af]">No users yet. Register the first account above.</div>
        ) : (
          <div className="divide-y divide-[#d1d9e6]">
            {records.map(u => (
              <div key={u.username} className={`px-5 py-3 flex items-center gap-4 ${editing?.username === u.username ? "bg-[#eef3fb]" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-sans font-semibold text-sm text-[#1a2744]">{u.name}</div>
                  <div className="font-mono text-[10px] text-[#8a96af] mt-0.5">
                    {u.username} · {u.station}
                  </div>
                </div>
                <span className={`chip shrink-0 ${u.role === "admin" ? "chip-amber" : "chip-blue"}`}>
                  {u.role.toUpperCase()}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(u)} className="gov-btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}>
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(u)}
                    disabled={u.username === user.username}
                    className="gov-btn-secondary"
                    style={{ padding: "3px 10px", fontSize: 12, color: u.username === user.username ? "#b6c1d6" : "#991b1b" }}
                    title={u.username === user.username ? "You cannot delete your own account" : undefined}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="font-mono text-[10px] text-[#8a96af] mt-4 uppercase tracking-widest">
        New officers are assigned a station at creation — they sign in with just their username and password.
      </p>
    </div>
  )
}