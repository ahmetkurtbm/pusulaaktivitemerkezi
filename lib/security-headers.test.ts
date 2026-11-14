import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config security headers", () => {
  it("sets the hardening headers on every route and no CSP", async () => {
    const rules = await nextConfig.headers!();
    const headers = Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((h) => [h.key, h.value]));
    expect(headers).toEqual({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });
});
