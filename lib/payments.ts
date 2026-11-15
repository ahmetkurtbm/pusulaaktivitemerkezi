export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_FEE = 1_000_000;
export const MAX_ITEMS = 500;

export type PaymentItem = {
  parentId: string;
  paid: boolean;
  /** undefined = ücret değişmedi, null = ücreti temizle, sayı = yeni aylık ücret. */
  fee?: number | null;
};

/** "2026-11" biçiminde, yerel saate göre içinde bulunulan ay. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Ücret girdisini kuruşa yuvarlanmış sayıya çevirir; geçersizse undefined döner. */
export function parseFee(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > MAX_FEE) return undefined;
  return Math.round(number * 100) / 100;
}

/** PUT gövdesini doğrular; hata varsa kullanıcıya gösterilecek metni döndürür. */
export function parsePaymentRequest(body: unknown): { month: string; items: PaymentItem[] } | { error: string } {
  const input = (body ?? {}) as { month?: unknown; items?: unknown };
  if (typeof input.month !== "string" || !MONTH_PATTERN.test(input.month)) return { error: "Geçersiz ay." };
  if (!Array.isArray(input.items) || input.items.length === 0) return { error: "Kaydedilecek değişiklik yok." };
  if (input.items.length > MAX_ITEMS) return { error: "Tek seferde çok fazla kayıt gönderildi." };

  const items: PaymentItem[] = [];
  const seen = new Set<string>();
  for (const raw of input.items as Array<Record<string, unknown>>) {
    const parentId = typeof raw?.parentId === "string" ? raw.parentId : "";
    if (!parentId || seen.has(parentId)) return { error: "Geçersiz veli kaydı." };
    if (typeof raw.paid !== "boolean") return { error: "Geçersiz ödeme durumu." };
    seen.add(parentId);
    const item: PaymentItem = { parentId, paid: raw.paid };
    if ("fee" in raw && raw.fee !== undefined) {
      const fee = parseFee(raw.fee);
      if (fee === undefined) return { error: `Ücret 0 ile ${MAX_FEE.toLocaleString("tr-TR")} arasında olmalı.` };
      item.fee = fee;
    }
    items.push(item);
  }
  return { month: input.month, items };
}

/** Kaydedilecek ödeme satırı: ödendiyse o anki ücret tutar olarak saklanır. */
export function buildPaymentRow(item: PaymentItem, month: string, fee: number | null, nowIso: string) {
  return {
    parent_id: item.parentId,
    period: month,
    paid: item.paid,
    amount: item.paid ? fee : null,
    paid_at: item.paid ? nowIso : null,
    updated_at: nowIso,
  };
}
