// API client for the Votebook backend (Express + PostgreSQL, proxied via /api).

export interface SessionUser {
  username: string
  name: string
  role: string
  station: string
}

export interface Station {
  name: string
  subVote: string
}

export interface VoteItem {
  vote: string
  item: string
  subItem: string
  code: string
  description: string
}

export interface CashbookEntry {
  id: string
  timestamp: string
  type: "receipt" | "payment"
  description: string
  station: string
  officer: string
  officerName: string
  voteCode: string
  voteDescription: string
  voteSubVote: string
  voteItem: string
  voteSubItem: string
  payee: string
  purpose: string
  receiptNo: string
  cashbookRef: string
  debit: number
  credit: number
  balance: number
}

export interface CashbookState {
  openingBalance: number
  entries: CashbookEntry[]
}

export interface PaymentPayload {
  voteCode: string
  amount: string
  payee: string
  purpose: string
  receiptNo: string
  cashbookRef: string
  station: string
}

export interface CreditPayload {
  amount: string
  description: string
  ref: string
}

export interface UserRecord {
  id: number
  username: string
  name: string
  role: "admin" | "officer"
  station: string
  createdAt: string | null
}

export interface UserPayload {
  username?: string
  password?: string
  name?: string
  role?: "admin" | "officer"
  station?: string
}

const TOKEN_KEY = "vbm_token"
const USER_KEY = "vbm_user"

export function loadSession(): { token: string; user: SessionUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null") as SessionUser | null
    return token && user ? { token, user } : null
  } catch {
    return null
  }
}

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  const res = await fetch(path, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Something went wrong. Please try again.")
  }
  return data as T
}

export const api = {
  // Used by the login screen to lock the station field for administrator accounts.
  async roleHint(username: string): Promise<string | null> {
    try {
      const r = await request<{ role: string | null }>(`/api/auth/role?username=${encodeURIComponent(username)}`)
      return r.role
    } catch {
      return null
    }
  },

  // Stations come from the database, but officers no longer pick one at sign-in:
  // the station is assigned to the account by the administrator.
  stations: () => request<{ stations: Station[] }>("/api/stations"),

  // The station is attached to the account server-side (see POST /api/users).
  login: (username: string, password: string) =>
    request<{ token: string; user: SessionUser }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  bootstrap: (token: string) =>
    request<{ stations: Station[]; voteItems: VoteItem[] }>("/api/bootstrap", { token }),

  cashbook: (token: string) => request<CashbookState>("/api/cashbook", { token }),

  addPayment: (token: string, payload: PaymentPayload) =>
    request<CashbookState & { entry: CashbookEntry }>("/api/cashbook/payments", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),

  addCredit: (token: string, payload: CreditPayload) =>
    request<CashbookState & { entry: CashbookEntry }>("/api/cashbook/credits", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),

  setOpeningBalance: (token: string, amount: number) =>
    request<CashbookState>("/api/cashbook/opening-balance", {
      method: "PUT",
      token,
      body: JSON.stringify({ amount }),
    }),

  // ── System users (admin · Central Finance only) ─────────────────────────
  users: (token: string) => request<{ users: UserRecord[] }>("/api/users", { token }),

  createUser: (token: string, payload: UserPayload) =>
    request<{ user: UserRecord }>("/api/users", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),

  updateUser: (token: string, username: string, payload: UserPayload) =>
    request<{ user: UserRecord }>(`/api/users/${encodeURIComponent(username)}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    }),

  deleteUser: (token: string, username: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(username)}`, {
      method: "DELETE",
      token,
    }),
}