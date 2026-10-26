# Team Notes API

A REST backend for a note-taking service shared among small teams. Users keep private notes or share them with teams they belong to.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:3000, data in ./notes.db
npm test             # integration tests against in-memory SQLite
npm run build && npm start
npm run db:studio    # web UI to browse the database
```

Env vars: `PORT` (3000), `DB_PATH` (`notes.db`), `SESSION_TTL_HOURS` (24). Migrations in [drizzle/](drizzle) run automatically on startup. If you have a `notes.db` from an older version, delete it (with its `-shm` and `-wal` files).

## Why these choices

- **Node.js + Express:** lightweight, low memory use, and a large ecosystem with plenty of support.
- **SQLite:** lightweight and needs no separate container or service. This app does not need many resources. Queries are isolated in repositories, so moving to Postgres later is a contained change.
- **ORM (Drizzle) over raw SQL:** standardizes database access and prevents SQL mistakes, with a typed schema and generated migrations. Drizzle Studio gives a web UI to double-check the data. The full-text search index (FTS5) is the exception: it is hand-written SQL in a custom migration, because an ORM can't express it.
- **Bruno collection ([bruno/](bruno)), kept in sync with the API:** developers can test the API on the fly. Every request has assertions. In Bruno, open the folder, pick the `local` environment and run the whole collection (folders run in order: Users, Auth, Teams, Notes). CLI: `npx @usebruno/cli run -r --env local` from `bruno/`.
- **Basic username/password auth:** ensures the basics, such as users not reaching protected endpoints or notes they have no access to. Passwords are hashed with scrypt, and sessions use random tokens (only their hash is stored) that expire after 24h.

## API

Base path `/api/v1` (except `/health`). "Bearer" means `Authorization: Bearer <token>` from login.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | liveness |
| POST | `/users` | none | register `{username, password, name}` |
| POST | `/auth/login` | none | `{username, password}` returns `{token, expiresAt}` |
| POST | `/auth/logout` | Bearer | revoke the current token |
| POST | `/teams` | Bearer | create a team (you become a member) |
| GET | `/teams` | Bearer | teams you belong to |
| POST | `/teams/:teamId/members` | Bearer | add a member `{userId}` |
| POST | `/notes` | Bearer | create `{title, body?, tags?, teamId?}` |
| GET | `/notes` | Bearer | list notes you can see |
| GET | `/notes/:id` | Bearer | get one note |
| PATCH | `/notes/:id` | Bearer | edit any of `title, body, tags, teamId` |
| DELETE | `/notes/:id` | Bearer | delete (author only) |

- **List filters:** `tag`, `teamId`, `q` (full-text), `limit` (1-100, default 20), `cursor`. Response: `{items, nextCursor}`.
- **Errors:** `{"error": {"code", "message", "details?"}}` with 400 (validation), 401 (missing, invalid or expired token, or bad login), 403 (visible but not allowed), 404, 409 (username taken).

## Data model

Defined in [src/db/schema.ts](src/db/schema.ts).

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id`, `username` (unique), `name`, `password_hash` | password is a salted scrypt hash, never returned |
| `sessions` | `token_hash`, `user_id`, `expires_at` | login tokens, stored hashed |
| `teams` | `id`, `name` | |
| `team_members` | `team_id`, `user_id` | many-to-many users and teams |
| `notes` | `id`, `author_id`, `team_id?`, `title`, `body`, timestamps | no team = private to the author |
| `note_tags` | `note_id`, `tag` | tags are lowercase, de-duplicated, max 20 per note |
| `notes_fts` | (virtual) | FTS5 search index kept in sync by triggers |

## Behavior

- A note is visible to its author, or to members of its team. Notes you cannot see return **404**, not 403, so their existence is not revealed.
- Anyone who can see a note can edit it. Only the author can delete it or change which team it is shared with (and only with teams they belong to).
- Lists use keyset pagination on `(updated_at, id)`, so pages stay stable while notes change. Search is word-prefix based and results are ordered by recency.

## What I would add with more time

**Security**
- **Login rate limiting and lockout.** Today a password can be guessed without limit. Per-IP and per-username throttling (for example `express-rate-limit`, or a store shared across instances) is the most important gap.
- **Password change and reset.** Change needs the current password and should revoke other sessions. Reset needs an email flow with single-use, expiring links.
- **Session management.** Token refresh or sliding expiry so users aren't logged out mid-day, plus a "log out everywhere" endpoint.
- **Security headers and request logging.** `helmet`, structured request logs with request ids, and an audit trail for sharing and deletes. HTTPS is assumed to be terminated in front of the service.

**Collaboration**
- **Team roles and membership management.** Owner, editor and viewer roles, removing members, leaving a team, and deleting a team. Note visibility is computed from membership at read time, so access would follow automatically.
- **Safe concurrent edits.** Edits are last-write-wins today. Add a `version` column checked through `If-Match`/ETag headers, returning 412 on a conflict.
- **Soft delete and history.** Deletes are permanent. A trash with restore and a note revision history would make mistakes recoverable.

**API and search**
- **Relevance-ranked search.** Results are ordered by recency. FTS5 can rank by relevance (bm25), and `q` could return snippets with highlights.
- **Richer queries.** Sorting options, date filters, and listing users or team members.
- **Generated API docs.** An OpenAPI spec from the zod schemas, served as Swagger UI, alongside the Bruno collection.

**Operations**
- **Down-migrations and backups.** Migrations only roll forward. Add rollback scripts and a scheduled backup of the SQLite file.
- **Postgres and containers.** A Dockerfile and compose file, and a Postgres option if the service needs more than one instance or heavy concurrent writes. The repository layer isolates the queries.
- **CI.** Run typecheck, tests, and the Bruno CLI collection on every push.
- **More tests.** Unit tests for the services, and a test that checks the migrations against a populated database.
