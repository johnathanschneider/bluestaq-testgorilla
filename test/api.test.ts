import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { openDb } from "../src/db/connection";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp(openDb(":memory:"));
});

const PASSWORD = "correct horse";
const tokens = new Map<string, string>(); // user id -> bearer token

async function makeUser(name: string): Promise<string> {
  const username = `user_${name}`;
  const reg = await request(app).post("/api/v1/users").send({ username, password: PASSWORD, name }).expect(201);
  const login = await request(app).post("/api/v1/auth/login").send({ username, password: PASSWORD }).expect(200);
  tokens.set(reg.body.id, login.body.token);
  return reg.body.id;
}

const bearer = (userId: string) => `Bearer ${tokens.get(userId)}`;

async function makeTeam(userId: string, name = "team"): Promise<string> {
  const res = await request(app).post("/api/v1/teams").set("authorization", bearer(userId)).send({ name }).expect(201);
  return res.body.id;
}

const as = (userId: string) => ({
  post: (url: string) => request(app).post(url).set("authorization", bearer(userId)),
  get: (url: string) => request(app).get(url).set("authorization", bearer(userId)),
  patch: (url: string) => request(app).patch(url).set("authorization", bearer(userId)),
  delete: (url: string) => request(app).delete(url).set("authorization", bearer(userId)),
});

async function makeNote(userId: string, body: Record<string, unknown>) {
  const res = await as(userId).post("/api/v1/notes").send(body).expect(201);
  return res.body;
}

describe("authentication", () => {
  const register = (body: Record<string, unknown>) => request(app).post("/api/v1/users").send(body);
  const login = (body: Record<string, unknown>) => request(app).post("/api/v1/auth/login").send(body);

  it("rejects missing, malformed and unknown tokens", async () => {
    await request(app).get("/api/v1/notes").expect(401);
    await request(app).get("/api/v1/notes").set("authorization", "Bearer nope").expect(401);
    await request(app).get("/api/v1/notes").set("authorization", "Basic abc").expect(401);
  });

  it("registers without exposing the password hash and rejects duplicate usernames", async () => {
    const body = { username: "Ann_1", password: PASSWORD, name: "Ann" };
    const res = await register(body).expect(201);
    expect(res.body).toMatchObject({ username: "ann_1", name: "Ann" });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
    await register({ ...body, username: "ann_1" }).expect(409);
  });

  it("validates username and password", async () => {
    await register({ username: "ab", password: PASSWORD, name: "x" }).expect(400);
    await register({ username: "has space", password: PASSWORD, name: "x" }).expect(400);
    await register({ username: "okname", password: "short", name: "x" }).expect(400);
  });

  it("logs in case-insensitively on username and gives the same 401 for bad password and unknown user", async () => {
    await register({ username: "ann_1", password: PASSWORD, name: "Ann" }).expect(201);
    const ok = await login({ username: "ANN_1", password: PASSWORD }).expect(200);
    expect(ok.body.token).toEqual(expect.any(String));
    const wrongPw = await login({ username: "ann_1", password: "wrong password" }).expect(401);
    const unknown = await login({ username: "nobody", password: PASSWORD }).expect(401);
    expect(wrongPw.body).toEqual(unknown.body);
  });

  it("lets a token work until logout, then rejects it", async () => {
    const u = await makeUser("a");
    await as(u).get("/api/v1/notes").expect(200);
    await as(u).post("/api/v1/auth/logout").expect(204);
    await as(u).get("/api/v1/notes").expect(401);
  });

  it("rejects expired sessions", async () => {
    const expiring = createApp(openDb(":memory:"), { sessionTtlHours: -1 });
    await request(expiring).post("/api/v1/users").send({ username: "ann_1", password: PASSWORD, name: "A" });
    const res = await request(expiring).post("/api/v1/auth/login").send({ username: "ann_1", password: PASSWORD });
    await request(expiring).get("/api/v1/notes").set("authorization", `Bearer ${res.body.token}`).expect(401);
  });
});

describe("validation", () => {
  it("returns 400 with details for invalid input", async () => {
    const u = await makeUser("a");
    const res = await as(u).post("/api/v1/notes").send({ title: "" }).expect(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(res.body.error.details[0].path).toBe("title");
  });

  it("returns 400 for malformed JSON and 404 for unknown routes", async () => {
    const u = await makeUser("a");
    await as(u).post("/api/v1/notes").set("content-type", "application/json").send("{bad").expect(400);
    await request(app).get("/nope").expect(404);
  });
});

describe("note CRUD", () => {
  it("creates, reads, updates and deletes a private note", async () => {
    const u = await makeUser("a");
    const note = await makeNote(u, { title: "Hi", body: "there", tags: ["Work", "work", "x"] });
    expect(note.tags).toEqual(["work", "x"]); // normalized + deduped
    expect(note.teamId).toBeNull();

    await as(u).get(`/api/v1/notes/${note.id}`).expect(200);

    const patched = await as(u).patch(`/api/v1/notes/${note.id}`).send({ title: "New", tags: [] }).expect(200);
    expect(patched.body).toMatchObject({ title: "New", body: "there", tags: [] });
    expect(patched.body.updatedAt >= note.updatedAt).toBe(true);

    await as(u).delete(`/api/v1/notes/${note.id}`).expect(204);
    await as(u).get(`/api/v1/notes/${note.id}`).expect(404);
  });

  it("rejects an empty PATCH", async () => {
    const u = await makeUser("a");
    const note = await makeNote(u, { title: "t" });
    await as(u).patch(`/api/v1/notes/${note.id}`).send({}).expect(400);
  });
});

describe("visibility and authorization", () => {
  it("hides private notes from other users (404)", async () => {
    const [a, b] = [await makeUser("a"), await makeUser("b")];
    const note = await makeNote(a, { title: "secret" });
    await as(b).get(`/api/v1/notes/${note.id}`).expect(404);
    await as(b).patch(`/api/v1/notes/${note.id}`).send({ title: "x" }).expect(404);
    await as(b).delete(`/api/v1/notes/${note.id}`).expect(404);
    const list = await as(b).get("/api/v1/notes").expect(200);
    expect(list.body.items).toEqual([]);
  });

  it("lets team members read and edit, but only the author delete or reshare", async () => {
    const [a, b, outsider] = [await makeUser("a"), await makeUser("b"), await makeUser("c")];
    const team = await makeTeam(a);
    await as(a).post(`/api/v1/teams/${team}/members`).send({ userId: b }).expect(204);
    const note = await makeNote(a, { title: "shared", teamId: team });

    await as(b).get(`/api/v1/notes/${note.id}`).expect(200);
    await as(b).patch(`/api/v1/notes/${note.id}`).send({ body: "edited by b" }).expect(200);
    await as(b).patch(`/api/v1/notes/${note.id}`).send({ teamId: null }).expect(403);
    await as(b).delete(`/api/v1/notes/${note.id}`).expect(403);
    await as(outsider).get(`/api/v1/notes/${note.id}`).expect(404);

    await as(a).patch(`/api/v1/notes/${note.id}`).send({ teamId: null }).expect(200);
    await as(b).get(`/api/v1/notes/${note.id}`).expect(404);
    await as(a).delete(`/api/v1/notes/${note.id}`).expect(204);
  });

  it("forbids sharing with a team you are not in", async () => {
    const [a, b] = [await makeUser("a"), await makeUser("b")];
    const team = await makeTeam(a);
    await as(b).post("/api/v1/notes").send({ title: "t", teamId: team }).expect(403);
  });

  it("hides teams from non-members when adding members", async () => {
    const [a, b] = [await makeUser("a"), await makeUser("b")];
    const team = await makeTeam(a);
    await as(b).post(`/api/v1/teams/${team}/members`).send({ userId: b }).expect(404);
  });
});

describe("listing", () => {
  it("filters by tag and team, only among visible notes", async () => {
    const [a, b] = [await makeUser("a"), await makeUser("b")];
    const team = await makeTeam(a);
    await as(a).post(`/api/v1/teams/${team}/members`).send({ userId: b }).expect(204);
    await makeNote(a, { title: "private work", tags: ["work"] });
    await makeNote(a, { title: "team work", tags: ["work"], teamId: team });
    await makeNote(a, { title: "team misc", tags: ["misc"], teamId: team });

    const aWork = await as(a).get("/api/v1/notes?tag=WORK").expect(200);
    expect(aWork.body.items.map((n: any) => n.title).sort()).toEqual(["private work", "team work"]);

    const bWork = await as(b).get("/api/v1/notes?tag=work").expect(200);
    expect(bWork.body.items.map((n: any) => n.title)).toEqual(["team work"]);

    const byTeam = await as(a).get(`/api/v1/notes?teamId=${team}`).expect(200);
    expect(byTeam.body.items).toHaveLength(2);
  });

  it("searches title and body, respects visibility, tolerates odd input", async () => {
    const [a, b] = [await makeUser("a"), await makeUser("b")];
    await makeNote(a, { title: "Groceries", body: "buy avocados" });
    await makeNote(b, { title: "Other", body: "avocado toast recipe" });

    const found = await as(a).get("/api/v1/notes?q=avoca").expect(200);
    expect(found.body.items.map((n: any) => n.title)).toEqual(["Groceries"]);

    await as(a).get(`/api/v1/notes?q=${encodeURIComponent('"AND (NEAR -')}`).expect(200);
  });

  it("paginates newest-updated first with a stable cursor", async () => {
    const u = await makeUser("a");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await makeNote(u, { title: `n${i}` })).id);
    // Touch the oldest so it jumps to the front.
    await as(u).patch(`/api/v1/notes/${ids[0]}`).send({ body: "bump" }).expect(200);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await as(u).get(`/api/v1/notes?limit=2${cursor ? `&cursor=${cursor}` : ""}`).expect(200);
      seen.push(...res.body.items.map((n: any) => n.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen[0]).toBe(ids[0]);
    expect(new Set(seen).size).toBe(5);
  });

  it("rejects bad cursors and limits", async () => {
    const u = await makeUser("a");
    await as(u).get("/api/v1/notes?cursor=garbage").expect(400);
    await as(u).get("/api/v1/notes?limit=0").expect(400);
    await as(u).get("/api/v1/notes?limit=1000").expect(400);
  });
});
