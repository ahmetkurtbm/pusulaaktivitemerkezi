import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { buildPaymentRow, currentMonth, MONTH_PATTERN, parsePaymentRequest } from "@/lib/payments";
import { getSupabaseAdmin } from "@/lib/supabase";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const SETUP_HINT = "Ödeme özelliği için 20261115_add_payments.sql dosyası Supabase SQL Editor'da çalıştırılmalı.";

/** Seçilen ay için aktif velilerin ücretleri ve ödeme durumları. */
export async function GET(request: Request) {
  if (!(await getAdminSession())) return fail("Yetkisiz.", 401);
  const month = new URL(request.url).searchParams.get("month") || currentMonth();
  if (!MONTH_PATTERN.test(month)) return fail("Geçersiz ay.");

  const db = getSupabaseAdmin();
  const { data: parents, error: parentsError } = await db.from("parent_accounts").select("id,parent_name,student_name,monthly_fee").eq("active", true).order("student_name");
  if (parentsError) return NextResponse.json({ month, parents: [], payments: [], setupRequired: true });
  const { data: payments, error: paymentsError } = await db.from("payments").select("parent_id,paid,amount,paid_at").eq("period", month);
  if (paymentsError) return NextResponse.json({ month, parents: [], payments: [], setupRequired: true });
  return NextResponse.json({ month, parents, payments });
}

/**
 * Değişen satırları tek seferde kaydeder: önce (değiştiyse) aylık ücretler,
 * sonra o ayın ödendi/ödenmedi durumları. Ödendi işaretlenen satıra o anki
 * ücret tutar olarak yazılır; ücret sonradan değişse de geçmiş ay etkilenmez.
 */
export async function PUT(request: Request) {
  if (!(await getAdminSession())) return fail("Yetkisiz.", 401);
  const body = await request.json().catch(() => null);
  const parsed = parsePaymentRequest(body);
  if ("error" in parsed) return fail(parsed.error);
  const { month, items } = parsed;

  const db = getSupabaseAdmin();
  for (const item of items) {
    if (item.fee === undefined) continue;
    const { error } = await db.from("parent_accounts").update({ monthly_fee: item.fee }).eq("id", item.parentId);
    if (error) return fail(SETUP_HINT, 500);
  }

  const { data: fees, error: feeError } = await db.from("parent_accounts").select("id,monthly_fee").in("id", items.map((i) => i.parentId));
  if (feeError) return fail(SETUP_HINT, 500);
  const feeById = new Map((fees ?? []).map((p) => [p.id as string, p.monthly_fee === null ? null : Number(p.monthly_fee)]));
  if (feeById.size !== items.length) return fail("Bazı veliler bulunamadı; sayfayı yenileyin.", 404);

  const nowIso = new Date().toISOString();
  const rows = items.map((item) => buildPaymentRow(item, month, feeById.get(item.parentId) ?? null, nowIso));
  const { error } = await db.from("payments").upsert(rows, { onConflict: "parent_id,period" });
  if (error) return fail(SETUP_HINT, 500);
  return NextResponse.json({ ok: true, saved: rows.length });
}
