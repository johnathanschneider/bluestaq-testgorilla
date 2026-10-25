# Team Notes API

A REST backend for a note-taking service shared among small teams. TypeScript, Node.js, Express 5, SQLite (`better-sqlite3`), `zod` validation, Vitest + supertest tests.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:3000, data in ./notes.db
npm test           # integration tests (in-memory SQLite)
npm run build && npm start
```

Config via env: `PORT` (default 3000), `DB_PATH` (default `notes.db`; `:memory:` works).

### Database and migrations

The schema is defined in TypeScript ([src/db/schema.ts](src/db/schema.ts)) with Drizzle ORM. SQL migrations in [drizzle/](drizzle) are applied automatically on startup (including in tests).

```bash
npm run db:generate    # after editing schema.ts: generate a new migration
npm run db:studio      # browse the database in a web UI (DB_PATH selects the file)
```

`drizzle/0001_fts.sql` is hand-written: the FTS5 search index and its triggers cannot be expressed in the TypeScript schema. If you have a `notes.db` created before the move to Drizzle, delete it; it was built by the old schema bootstrap and will conflict with the migrations.

## Try it with Bruno

[`bruno/`](bruno) is a [Bruno](https://www.usebruno.com) collection with sample data. With the server running, open the folder in Bruno (Open Collection), pick the **local** environment, and run the whole collection. Folders are by resource (Users, Teams, Notes) and run in that order: Users creates ann, bob and cara and Teams creates a team with ann and bob, storing their ids as variables for the Notes requests, so each run starts from fresh data (run the folders in order, not individually). Every request has assertions; names show the expected status. CLI: `npx @usebruno/cli run -r --env local` from inside `bruno/`.

## Concepts

- **Users** and **teams** (a user can be in many teams).
- A **note** has an author, a title, a body, tags, and an optional team. No team = **private** to the author; with a team = visible to every member.
- Permissions: anyone who can see a note can edit its content; only the **author** can delete it or change who it is shared with (and only with teams they belong to).

### Authentication (stub)

Real auth is intentionally deferred. Callers send `X-User-Id: <id>` (ids come from `POST /users`). **This is not secure**: anyone who knows an id can act as that user. All of it lives in `src/middleware/identify.ts`; swapping in tokens/JWT means changing that one file, since routes and services only read `req.userId`. Authorization rules are real and enforced in the service layer regardless.

## API (`/api/v1`, JSON)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/users` | `{name}` - no auth; returns the user id |
| POST | `/teams` | `{name}` - creator becomes a member |
| GET | `/teams` | teams you belong to |
| POST | `/teams/:id/members` | `{userId}` - any member may add others; 204 |
| POST | `/notes` | `{title, body?, tags?, teamId?}` |
| GET | `/notes` | list notes you can see (see below) |
| GET | `/notes/:id` | |
| PATCH | `/notes/:id` | any subset of `title, body, tags, teamId` (`teamId: null` makes it private) |
| DELETE | `/notes/:id` | author only; 204 |
| GET | `/health` | liveness |

List query params: `tag`, `teamId`, `q` (full-text, prefix match on the last word), `limit` (1-100, default 20), `cursor`. Response: `{items: Note[], nextCursor: string | null}`; pass `nextCursor` back as `cursor` for the next page.

Errors: `{"error": {"code", "message", "details?"}}` with 400 (validation, with per-field `details`), 401 (missing/unknown user), 403 (visible but not allowed), 404.

```bash
U=$(curl -s -XPOST localhost:3000/api/v1/users -H 'content-type: application/json' -d '{"name":"ann"}' | jq -r .id)
T=$(curl -s -XPOST localhost:3000/api/v1/teams -H "x-user-id: $U" -H 'content-type: application/json' -d '{"name":"platform"}' | jq -r .id)
curl -s -XPOST localhost:3000/api/v1/notes -H "x-user-id: $U" -H 'content-type: application/json' \
  -d "{\"title\":\"Standup\",\"body\":\"ship it\",\"tags\":[\"meeting\"],\"teamId\":\"$T\"}"
curl -s "localhost:3000/api/v1/notes?q=ship&tag=meeting" -H "x-user-id: $U"
```

## Design and tradeoffs

**Layout.** `routes` (HTTP + validation) -> `service` (authorization and rules) -> `repository` (queries). `createApp(db)` takes an open database, so tests run the real stack against `:memory:`. Users/teams are thin enough that their routes talk to a small repository directly.

**SQLite.** Zero setup, real transactions, and FTS5 for search, which keeps the project runnable with just `npm install`. Cost: a single writer and a single node. The repository layer isolates queries, so Postgres would be a contained change.

**Drizzle ORM** gives a typed schema, generated migrations and a DB browser (Drizzle Studio) while staying close to SQL. I chose it over Prisma because the interesting queries (visibility `OR` + subquery, FTS5 match, keyset cursor) need raw SQL fragments, which Drizzle lets me mix into typed queries and Prisma does not. Two things remain hand-written SQL: the FTS5 table/triggers (a custom migration) and the row-value cursor comparison and FTS match (small `sql` fragments). Tags are loaded with a second query per page instead of a JSON aggregate subquery: one extra round trip, simpler and fully typed.

**Visibility is enforced in SQL** (`author = me OR team in my teams`) for lists, and by `canRead` for single notes, so search/tag/team filters can never leak other people's notes. Notes you can't see return **404, not 403**, to avoid revealing they exist.

**Keyset pagination** on `(updated_at, id)` instead of offset: pages stay stable while teammates edit, and cost doesn't grow with depth. Tradeoff: no random page access, and results are ordered by recency, not search relevance, even when `q` is set.

**Search** uses an FTS5 external-content index kept in sync by triggers. User input is quoted token-by-token so FTS operators/syntax can't cause errors or be injected. Matching is word/prefix based, not substring.

**Tags** are lowercased and de-duplicated (`Work` == `work`), max 20 per note.

**Timestamps / IDs.** UUIDs and ISO-8601 UTC strings (sortable as text).

### Known gaps (deliberate scope cuts)

- **Auth** is stubbed (above).
- **Lost updates:** concurrent edits are last-write-wins. Next step: a `version` column checked via `If-Match`/ETag (409/412 on mismatch).
- **No roles** within teams, no removing members or leaving a team, no team/user listing for others. If a member could be removed, note visibility would follow automatically since it is computed from membership at read time.
- **Hard delete**, no history or trash.
- No rate limiting or request logging. Migrations only roll forward (no down-migrations).
