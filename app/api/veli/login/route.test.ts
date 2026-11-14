import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth";
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

const passwordHash = hashPassword("veli-sifresi");

beforeEach(() => {
  vi.resetModules();
  setCookie.mockClear();
  process.env.SESSION_SECRET = "a".repeat(32);
  fakeDb = createFakeSupabase({
    parentAccount: { id: "parent-1", slug: "ayseece", password_hash: passwordHash, active: true },
  });
});

describe("POST /api/veli/login", () => {
  it("accepts a correct slug and password", async () => {
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "ayseece", password: "veli-sifresi" }) }));
    expect(response.status).toBe(200);
    expect(setCookie).toHaveBeenCalledWith("ka_parent", expect.any(String), expect.objectContaining({ httpOnly: true }));
  });

  it("rejects an incorrect password", async () => {
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "ayseece", password: "wrong" }) }));
    expect(response.status).toBe(401);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("rejects a deactivated account even with the right password", async () => {
    fakeDb = createFakeSupabase({ parentAccount: { id: "parent-1", slug: "ayseece", password_hash: passwordHash, active: false } });
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "ayseece", password: "veli-sifresi" }) }));
    expect(response.status).toBe(401);
  });

  it("rejects a nonexistent slug without crashing", async () => {
    fakeDb = createFakeSupabase({ parentAccount: null });
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "nobody", password: "anything" }) }));
    expect(response.status).toBe(401);
  });

  it("returns 429 when the account is rate-limited", async () => {
    fakeDb = createFakeSupabase({ attempts: failures(5, { scope: "parent", ip: "unknown", account_key: "ayseece" }), parentAccount: { id: "parent-1", slug: "ayseece", password_hash: passwordHash, active: true } });
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "ayseece", password: "veli-sifresi" }) }));
    expect(response.status).toBe(429);
  });
});

describe("POST /api/veli/login rate limiting", () => {
  const body = (password: string) => new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "ayseece", password }) });
  const activeAccount = () => ({ id: "parent-1", slug: "ayseece", password_hash: passwordHash, active: true });

  it("records the attempt before checking the password and upgrades it on success", async () => {
    const { POST } = await importRoute();
    expect((await POST(body("veli-sifresi"))).status).toBe(200);
    expect(fakeDb.inserts[0].row).toMatchObject({ account_key: "ayseece", success: false });
    expect(fakeDb.attempts[0].success).toBe(true);
  });

  it("keeps a failed login recorded as a failure", async () => {
    const { POST } = await importRoute();
    await POST(body("wrong"));
    expect(fakeDb.attempts[0].success).toBe(false);
  });

  it("allows a few wrong passwords, then the correct one", async () => {
    const { POST } = await importRoute();
    for (let i = 0; i < 3; i++) expect((await POST(body("wrong"))).status).toBe(401);
    expect((await POST(body("veli-sifresi"))).status).toBe(200);
  });

  it("is not locked by failures coming from a different IP", async () => {
    fakeDb = createFakeSupabase({ attempts: failures(20, { scope: "parent", ip: "9.9.9.9", account_key: "ayseece" }), parentAccount: activeAccount() });
    const { POST } = await importRoute();
    expect((await POST(body("veli-sifresi"))).status).toBe(200);
  });

  it("returns 503 and does not log in when the attempt cannot be recorded", async () => {
    fakeDb = createFakeSupabase({ loginAttemptsError: { insert: { message: "boom" } }, parentAccount: activeAccount() });
    const { POST } = await importRoute();
    expect((await POST(body("veli-sifresi"))).status).toBe(503);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("returns 503 and does not log in when counting fails", async () => {
    fakeDb = createFakeSupabase({ loginAttemptsError: { count: { message: "boom" } }, parentAccount: activeAccount() });
    const { POST } = await importRoute();
    expect((await POST(body("veli-sifresi"))).status).toBe(503);
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("POST /api/veli/login timing", () => {
  it("still runs a scrypt comparison against the dummy hash when the user does not exist", async () => {
    vi.doMock("@/lib/auth", async (original) => {
      const actual = await original<typeof import("@/lib/auth")>();
      return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
    });
    fakeDb = createFakeSupabase({ parentAccount: null });
    const { POST } = await importRoute();
    const auth = await import("@/lib/auth");
    const response = await POST(new Request("http://localhost/api/veli/login", { method: "POST", body: JSON.stringify({ slug: "nobody", password: "anything" }) }));
    expect(response.status).toBe(401);
    expect(auth.verifyPassword).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/auth");
  });
});
