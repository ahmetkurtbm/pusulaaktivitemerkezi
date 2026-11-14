import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beginAttempt, finishAttempt, getClientIp, RateLimitUnavailableError } from "./rate-limit";
import { createFakeSupabase, failures } from "../test/fakeSupabase";

const asClient = (db: ReturnType<typeof createFakeSupabase>) => db as unknown as SupabaseClient;

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(getClientIp(request)).toBe("1.2.3.4");
  });

  it("falls back to unknown when the header is missing", () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("beginAttempt", () => {
  it("records the attempt as a failure before anything else and is not blocked under the limits", async () => {
    const db = createFakeSupabase();
    const result = await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece");
    expect(result.blocked).toBe(false);
    expect(db.inserts).toEqual([{ table: "login_attempts", row: { scope: "parent", ip: "1.2.3.4", account_key: "ayseece", success: false } }]);
  });

  it("allows 5 failures per (account, IP) pair and blocks the 6th", async () => {
    const db = createFakeSupabase({ attempts: failures(4, { scope: "parent", ip: "1.2.3.4", account_key: "ayseece" }) });
    expect((await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")).blocked).toBe(false);
    expect((await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")).blocked).toBe(true);
  });

  it("does not let another IP lock the account for the legitimate user's IP", async () => {
    // Saldırgan IP'si bu hesap için 20 kez denedi; meşru kullanıcının (hesap, IP) çifti temiz.
    const db = createFakeSupabase({ attempts: failures(20, { scope: "parent", ip: "9.9.9.9", account_key: "ayseece" }) });
    expect((await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")).blocked).toBe(false);
  });

  it("blocks an account across all IPs only after the much higher account limit (50)", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ scope: "parent", ip: `10.0.0.${i}`, account_key: "ayseece" }));
    const db = createFakeSupabase({ attempts: many });
    expect((await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")).blocked).toBe(true);
    const under = createFakeSupabase({ attempts: many.slice(0, 48) });
    expect((await beginAttempt(asClient(under), "parent", "1.2.3.4", "ayseece")).blocked).toBe(false);
  });

  it("limits total failures per IP across accounts (30)", async () => {
    const spread = Array.from({ length: 30 }, (_, i) => ({ scope: "parent", ip: "1.2.3.4", account_key: `veli${i}` }));
    const db = createFakeSupabase({ attempts: spread });
    expect((await beginAttempt(asClient(db), "parent", "1.2.3.4", "yeni")).blocked).toBe(true);
  });

  it("applies the same (account, IP) logic to the admin recovery key", async () => {
    const db = createFakeSupabase({ attempts: failures(5, { scope: "admin", ip: "1.2.3.4", account_key: "admin" }) });
    expect((await beginAttempt(asClient(db), "admin", "1.2.3.4", "admin")).blocked).toBe(true);
    expect((await beginAttempt(asClient(db), "admin", "5.5.5.5", "admin")).blocked).toBe(false);
  });

  it("does not exceed the limit under parallel requests", async () => {
    const db = createFakeSupabase();
    const results = await Promise.all(Array.from({ length: 20 }, () => beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")));
    expect(results.filter((r) => !r.blocked).length).toBeLessThanOrEqual(5);
  });

  it("removes the row of a blocked attempt so the lock expires on its own", async () => {
    const db = createFakeSupabase({ attempts: failures(5, { scope: "parent", ip: "1.2.3.4", account_key: "ayseece" }) });
    await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece");
    expect(db.attempts).toHaveLength(5);
  });

  it("throws (fails closed) when the insert returns an error", async () => {
    const db = createFakeSupabase({ loginAttemptsError: { insert: { message: "relation does not exist" } } });
    await expect(beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  it("keeps working as before (and logs) when the login_attempts table does not exist", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["42P01", "PGRST205"]) {
      const db = createFakeSupabase({ loginAttemptsError: { insert: { message: "relation does not exist", code } } });
      const result = await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece");
      expect(result).toEqual({ blocked: false, attemptId: "" });
      await expect(finishAttempt(asClient(db), result.attemptId, true)).resolves.toBeUndefined();
      expect(db.updates).toEqual([]);
    }
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("throws (fails closed) when the count returns an error", async () => {
    const db = createFakeSupabase({ loginAttemptsError: { count: { message: "timeout" } } });
    await expect(beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece")).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });
});

describe("finishAttempt", () => {
  it("marks the pre-recorded attempt as successful", async () => {
    const db = createFakeSupabase();
    const { attemptId } = await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece");
    await finishAttempt(asClient(db), attemptId, true);
    expect(db.updates[0]).toMatchObject({ table: "login_attempts", row: { success: true }, filters: { id: attemptId } });
    expect(db.attempts[0].success).toBe(true);
  });

  it("leaves a failed attempt recorded as a failure", async () => {
    const db = createFakeSupabase();
    const { attemptId } = await beginAttempt(asClient(db), "parent", "1.2.3.4", "ayseece");
    await finishAttempt(asClient(db), attemptId, false);
    expect(db.updates).toHaveLength(0);
    expect(db.attempts[0].success).toBe(false);
  });
});
