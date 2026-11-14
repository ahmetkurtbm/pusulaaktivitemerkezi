import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, hashPassword, sessionCookie, verifyPassword } from "@/lib/auth";
import { beginAttempt, finishAttempt, getClientIp, RATE_LIMIT_UNAVAILABLE_MESSAGE, RateLimitUnavailableError } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase";

// Kullanıcı bulunamadığında da aynı sürede cevap vermek için sahte bir hash ile karşılaştırılır.
let dummyHash: string | undefined;

export async function POST(request: Request) {
  try {
    const { slug, password } = await request.json();
    const db = getSupabaseAdmin();
    const ip = getClientIp(request);
    const accountKey = String(slug || "").toLowerCase();
    const { blocked, attemptId } = await beginAttempt(db, "parent", ip, accountKey);
    if (blocked) return NextResponse.json({ error: "Çok fazla başarısız deneme. Lütfen birkaç dakika sonra tekrar deneyin." }, { status: 429 });
    const { data } = await db.from("parent_accounts").select("id,slug,password_hash,active").eq("slug", accountKey).maybeSingle();
    dummyHash ??= hashPassword("dummy-password");
    const matches = typeof password === "string" && verifyPassword(password, data?.password_hash ?? dummyHash);
    const success = Boolean(data?.active) && matches;
    await finishAttempt(db, attemptId, success);
    if (!success) return NextResponse.json({ error: "Kullanıcı adı veya şifre hatalı." }, { status: 401 });
    (await cookies()).set("ka_parent", createSession({ role: "parent", parentId: data!.id, slug: data!.slug }), sessionCookie);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) return NextResponse.json({ error: RATE_LIMIT_UNAVAILABLE_MESSAGE }, { status: 503 });
    return NextResponse.json({ error: "Giriş şu anda yapılamıyor." }, { status: 500 });
  }
}
