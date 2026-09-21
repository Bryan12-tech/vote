# Security test suite

Automated tests that enforce the system's security contracts. They are written
against the **real API process** and the **real database schema** — no mocks — so
they fail if a guard is removed, a route is reordered, or a validation is
loosened.

```bash
docker start votebook-db   # the tests need the local Postgres container
pnpm test                  # runs the whole suite
pnpm test -- --test-name-pattern="JWT"   # run a subset by name
```

Requires Node 22+ (uses the built-in `node:test` runner and global `fetch`) and
adds **no dependencies**.

## Isolation

* The harness derives a separate database (`votebook_test`, override with
  `TEST_DB_NAME`) from the credentials in `server/.env`, creating it on first run
  and building it with `server/seed.js`.
* **The development database is never read or written.**
* Each test file spawns its own `server/index.js` on a free port with a unique
  random `JWT_SECRET`, so a leaked or copied token from another run is useless.
* Test files run one at a time (`--test-concurrency=1`) because the cashbook is
  global state; tests inside a file are sequential.

## What is covered

| File | Scope |
| --- | --- |
| `security.authentication.test.js` | The `auth` middleware, JWT forgery (wrong secret, tampered payload, `alg: none`, algorithm confusion, expiry, malformed tokens, `Bearer` scheme), login responses and credential handling, malformed/oversized request bodies, prototype pollution |
| `security.authorization.test.js` | Officer vs Central Finance admin boundaries on every admin route, forged elevated sessions, privilege escalation through the user API, self-protection rules (own role, own account, last administrator), user lifecycle, username/password/role validation |
| `security.cashbook-integrity.test.js` | Amount/station/vote-code validation, SQL injection in lookup fields, mass assignment (client-supplied `debit`/`credit`/`balance`/`type`/`officer`/`station`), overdraft rejection, running-balance recomputation, concurrent payments vs the balance (advisory lock) |
| `security.data-exposure.test.js` | No password/hash/secret leakage from any endpoint, bcrypt storage at cost 10, JSON-only API responses including 404s, encoded traversal and NUL probes, repository files not reachable over HTTP, error responses free of stacks/SQL/paths |

## Known gaps (tracked as `it.todo`)

The suite deliberately reports the remaining hardening work instead of asserting
the weak behaviour. Run `pnpm test` and look for the `# TODO` lines:

* no rate limiting or lockout on repeated failed logins
* no token revocation after a password change, role change or user deletion
  (a 12h token stays valid until it expires)
* `jwt.verify` is not pinned with `algorithms: ["HS256"]`
* no audit trail for administrator actions (user create/update/delete)
* no idempotency key on payments (a retried request double-posts)
* no second-approver threshold for large payments
* 500 responses return the raw `err.message` (may contain SQL text)
* no hardening headers (`X-Content-Type-Options`, `X-Frame-Options`, CSP) on the
  HTML the Express process serves in production
* `/api/auth/role` is a public username-and-role oracle, required by the login
  screen to lock the station field — accepted trade-off, documented in the suite

## Notes for extenders

* `test/lib/harness.js` holds the bootstrap, HTTP client, token-forging helpers
  and fixtures (`resetCashbook`, `insertUserDirect`, `createUser`,
  `uniqueUsername`).
* Fixtures that bypass the API (`insertUserDirect`, direct `UPDATE`s) exist to
  create states the API intentionally refuses to create, such as a database with
  a single administrator. Always restore the state in a `finally` block.
* Balance-sensitive tests call `resetCashbook(ctx.db, openingBalance)` in
  `beforeEach` so they do not depend on execution order.
