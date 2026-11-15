import { describe, expect, it } from "vitest";
import { buildPaymentRow, currentMonth, parseFee, parsePaymentRequest } from "./payments";

describe("currentMonth", () => {
  it("formats as YYYY-MM with a zero-padded month", () => {
    expect(currentMonth(new Date(2026, 0, 15))).toBe("2026-01");
    expect(currentMonth(new Date(2026, 10, 15))).toBe("2026-11");
  });
});

describe("parseFee", () => {
  it("accepts numbers and decimal-comma strings, rounding to kuruş", () => {
    expect(parseFee(1500)).toBe(1500);
    expect(parseFee("1500,5")).toBe(1500.5);
    expect(parseFee("10.999")).toBe(11);
  });

  it("treats an empty value as clearing the fee", () => {
    expect(parseFee("")).toBeNull();
    expect(parseFee(null)).toBeNull();
  });

  it("rejects negative, non-numeric and absurdly large fees", () => {
    expect(parseFee(-1)).toBeUndefined();
    expect(parseFee("abc")).toBeUndefined();
    expect(parseFee(1_000_001)).toBeUndefined();
    expect(parseFee(Infinity)).toBeUndefined();
  });
});

describe("parsePaymentRequest", () => {
  const ok = { month: "2026-11", items: [{ parentId: "p1", paid: true, fee: "1200" }, { parentId: "p2", paid: false }] };

  it("parses a valid request and only sets fee when it was sent", () => {
    expect(parsePaymentRequest(ok)).toEqual({ month: "2026-11", items: [{ parentId: "p1", paid: true, fee: 1200 }, { parentId: "p2", paid: false }] });
  });

  it("rejects malformed months", () => {
    for (const month of ["2026-13", "2026-1", "26-11", "", undefined, 202611]) {
      expect(parsePaymentRequest({ ...ok, month })).toEqual({ error: "Geçersiz ay." });
    }
  });

  it("rejects empty, duplicate and badly typed items", () => {
    expect(parsePaymentRequest({ month: "2026-11", items: [] })).toHaveProperty("error");
    expect(parsePaymentRequest({ month: "2026-11", items: [{ parentId: "p1", paid: true }, { parentId: "p1", paid: false }] })).toHaveProperty("error");
    expect(parsePaymentRequest({ month: "2026-11", items: [{ parentId: "p1", paid: "yes" }] })).toHaveProperty("error");
    expect(parsePaymentRequest({ month: "2026-11", items: [{ paid: true }] })).toHaveProperty("error");
    expect(parsePaymentRequest(null)).toHaveProperty("error");
  });

  it("rejects an invalid fee instead of silently ignoring it", () => {
    expect(parsePaymentRequest({ month: "2026-11", items: [{ parentId: "p1", paid: true, fee: -5 }] })).toHaveProperty("error");
  });
});

describe("buildPaymentRow", () => {
  const now = "2026-11-15T10:00:00.000Z";

  it("snapshots the fee and timestamp when paid", () => {
    expect(buildPaymentRow({ parentId: "p1", paid: true }, "2026-11", 1200, now)).toEqual({ parent_id: "p1", period: "2026-11", paid: true, amount: 1200, paid_at: now, updated_at: now });
  });

  it("clears amount and paid_at when marked unpaid", () => {
    expect(buildPaymentRow({ parentId: "p1", paid: false }, "2026-11", 1200, now)).toEqual({ parent_id: "p1", period: "2026-11", paid: false, amount: null, paid_at: null, updated_at: now });
  });
});
