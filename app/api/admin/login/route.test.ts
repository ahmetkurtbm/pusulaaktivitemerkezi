import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, readSession } from "@/lib/auth";
import { createFakeSupabase, failures } from "../../../../test/fakeSupabase";

const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: setCookie, get: vi.fn() })),
}));

let fakeDb: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => fakeDb,
}));

async function importRoute() {
  return import("./route");
}

beforeEach(() => {
  vi.resetModules();
  setCookie.mockClear();
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.ADMIN_PASSWORD = "correct-password";
  fakeDb = createFakeSupabase();
});

describe("POST /api/admin/login", () => {
  it("rejects an incorrect password", async () => {
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/admin/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) }));
    expect(response.status).toBe(401);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("accepts the correct password and sets a session cookie", async () => {
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/admin/login", { method: "POST", body: JSON.stringify({ password: "correct-password" }) }));
    expect(response.status).toBe(200);
    expect(setCookie).toHaveBeenCalledWith("ka_admin", expect.any(String), expect.objectContaining({ httpOnly: true }));
  });

  it("returns 503 when ADMIN_PASSWORD is not configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/admin/login", { method: "POST", body: JSON.stringify({ password: "anything" }) }));
    expect(response.status).toBe(503);
  });

  it("returns 429 when the IP is rate-limited", async () => {
    fakeDb = createFakeSupabase({ attempts: failures(5, { scope: "admin", ip: "unknown", account_key: "admin" }) });
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/admin/login", { method: "POST", body: JSON.stringify({ password: "correct-password" }) }));
    expect(response.status).toBe(429);
  });

  it("records failures per account so one user cannot lock out another", async () => {
    const { POST } = await importRoute();
    await POST(login({ username: "Ayse", password: "wrong" }));
    expect(fakeDb.inserts.find((i) => i.table === "login_attempts")?.row).toMatchObject({ account_key: "user:ayse", success: false });
  });
});

function login(body: Record<string, string>) {
  return new Request("http://localhost/api/admin/login", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/admin/login with a personal account", () => {
  const user = (overrides: Record<string, unknown> = {}) => ({ id: "u1", password_hash: hashPassword("staff-password"), active: true, ...overrides });

  it("signs the user in and puts their id in the session", async () => {
    fakeDb = createFakeSupabase({ adminUser: user() });
    const { POST } = await importRoute();
    const response = await POST(login({ username: "ayse", password: "staff-password" }));
    expect(response.status).toBe(200);
    const token = setCookie.mock.calls[0][1] as string;
    expect(readSession(token)).toMatchObject({ role: "admin", sub: "u1" });
    expect(fakeDb.updates.find((u) => u.table === "admin_users")).toMatchObject({ filters: { id: "u1" } });
  });

  it("rejects a wrong password", async () => {
    fakeDb = createFakeSupabase({ adminUser: user() });
    const { POST } = await importRoute();
    expect((await POST(login({ username: "ayse", password: "nope" }))).status).toBe(401);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("rejects a deactivated account even with the right password", async () => {
    fakeDb = createFakeSupabase({ adminUser: user({ active: false }) });
    const { POST } = await importRoute();
    expect((await POST(login({ username: "ayse", password: "staff-password" }))).status).toBe(401);
  });

  it("rejects an unknown username", async () => {
    fakeDb = createFakeSupabase({ adminUser: null });
    const { POST } = await importRoute();
    expect((await POST(login({ username: "nobody", password: "staff-password" }))).status).toBe(401);
  });

  it("does not accept the recovery password as a personal account password", async () => {
    fakeDb = createFakeSupabase({ adminUser: user() });
    const { POST } = await importRoute();
    expect((await POST(login({ username: "ayse", password: "correct-password" }))).status).toBe(401);
  });
});

describe("POST /api/admin/login rate limiting", () => {
  it("returns 503 and does not log in when the attempt cannot be recorded", async () => {
    fakeDb = createFakeSupabase({ loginAttemptsError: { insert: { message: "boom" } } });
    const { POST } = await importRoute();
    expect((await POST(login({ password: "correct-password" }))).status).toBe(503);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("returns 503 and does not log in when counting fails", async () => {
    fakeDb = createFakeSupabase({ loginAttemptsError: { count: { message: "boom" } } });
    const { POST } = await importRoute();
    expect((await POST(login({ password: "correct-password" }))).status).toBe(503);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("limits the recovery login per (account, IP): 5 failures, then 429", async () => {
    fakeDb = createFakeSupabase({ attempts: failures(5, { scope: "admin", ip: "1.1.1.1", account_key: "admin" }) });
    const { POST } = await importRoute();
    const request = (ip: string) => new Request("http://localhost/api/admin/login", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ password: "correct-password" }) });
    expect((await POST(request("1.1.1.1"))).status).toBe(429);
    expect((await POST(request("2.2.2.2"))).status).toBe(200);
  });

  it("marks the pre-recorded attempt successful after a correct recovery login", async () => {
    const { POST } = await importRoute();
    await POST(login({ password: "correct-password" }));
    expect(fakeDb.attempts[0].success).toBe(true);
  });
});
