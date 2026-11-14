import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "@/lib/auth";
import { createFakeSupabase } from "../../../../test/fakeSupabase";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) })),
}));

let fakeDb: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => fakeDb,
}));

async function importRoute() {
  return import("./route");
}

const account = (active: boolean) => ({ parent_name: "Ayşe", student_name: "Ece", slug: "ayseece", active });
const request = () => new Request("http://localhost/api/veli/results?slug=ayseece");

beforeEach(() => {
  vi.resetModules();
  process.env.SESSION_SECRET = "a".repeat(32);
  cookieValue = createSession({ role: "parent", parentId: "parent-1", slug: "ayseece" });
});

describe("GET /api/veli/results", () => {
  it("returns results for an active parent", async () => {
    fakeDb = createFakeSupabase({ parentAccount: account(true) });
    const { GET } = await importRoute();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).parent).toMatchObject({ slug: "ayseece" });
  });

  it("returns 401 when the account has been deactivated, even with a valid session cookie", async () => {
    fakeDb = createFakeSupabase({ parentAccount: account(false) });
    const { GET } = await importRoute();
    expect((await GET(request())).status).toBe(401);
  });

  it("returns 401 without a session", async () => {
    cookieValue = undefined;
    fakeDb = createFakeSupabase({ parentAccount: account(true) });
    const { GET } = await importRoute();
    expect((await GET(request())).status).toBe(401);
  });
});
