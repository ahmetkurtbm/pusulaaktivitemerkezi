import type { SupabaseClient } from "@supabase/supabase-js";

const WINDOW_MINUTES = 15;
/** Aynı (hesap, IP) çifti için pencere başına izin verilen başarısız deneme. */
const MAX_PAIR_FAILURES = 5;
/** Yalnızca hesaba bağlı sınır: başkasının hesabı IP değiştirerek kilitlenemesin diye çok daha yüksek tutulur. */
const MAX_ACCOUNT_FAILURES = 50;
/** Bir IP'den (hesaptan bağımsız) pencere başına toplam başarısız deneme. */
const MAX_IP_FAILURES = 30;
/** KVKK aydınlatma metninde söz verilen saklama süresi. */
const RETENTION_DAYS = 90;

export const RATE_LIMIT_UNAVAILABLE_MESSAGE = "Giriş denemesi şu anda doğrulanamıyor. Lütfen biraz sonra tekrar deneyin.";

/** Sayım ya da kayıt başarısız olduğunda fırlatılır; çağıran girişe izin vermemeli (503). */
export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Giriş denemesi kaydedilemedi veya sayılamadı.");
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return forwarded.split(",")[0].trim() || "unknown";
}

/**
 * Denemeyi şifre kontrolünden ÖNCE başarısız olarak kaydeder, sonra sayar.
 * Sayıma kendi kaydı da dahildir; böylece yavaş şifre kontrolü sürerken gelen
 * paralel istekler birbirini görür ve sınır aşılamaz. Kayıt ya da sayım hata
 * verirse RateLimitUnavailableError fırlatılır (sınır sessizce kalkmaz).
 */
export async function beginAttempt(db: SupabaseClient, scope: "admin" | "parent", ip: string, accountKey: string): Promise<{ blocked: boolean; attemptId: string }> {
  const { data: inserted, error: insertError } = await db.from("login_attempts").insert({ scope, ip, account_key: accountKey, success: false }).select("id").single();
  if (insertError || !inserted?.id) throw new RateLimitUnavailableError();
  const attemptId = String(inserted.id);

  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const failures = () => db.from("login_attempts").select("id", { count: "exact", head: true }).eq("scope", scope).eq("success", false).gte("created_at", cutoff);
  const [pair, account, ipTotal] = await Promise.all([
    failures().eq("account_key", accountKey).eq("ip", ip),
    failures().eq("account_key", accountKey),
    failures().eq("ip", ip),
  ]);
  if (pair.error || account.error || ipTotal.error || pair.count == null || account.count == null || ipTotal.count == null) throw new RateLimitUnavailableError();

  // Sayımda kendi kaydı da var; eşik aşılınca (>) engellenir.
  const blocked = pair.count > MAX_PAIR_FAILURES || account.count > MAX_ACCOUNT_FAILURES || ipTotal.count > MAX_IP_FAILURES;
  // Engellenen istek sayaca eklenmez, böylece kilit 15 dk sonra kendiliğinden açılır.
  if (blocked) await db.from("login_attempts").delete().eq("id", attemptId);
  return { blocked, attemptId };
}

/** Başarılı girişte beginAttempt'in yazdığı kaydı başarılı olarak günceller. */
export async function finishAttempt(db: SupabaseClient, attemptId: string, success: boolean): Promise<void> {
  if (success) await db.from("login_attempts").update({ success: true }).eq("id", attemptId);
  // Süresi dolan kayıtlar ayrı bir zamanlanmış iş gerektirmeden girişlerde temizlenir.
  const expired = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.from("login_attempts").delete().lt("created_at", expired);
}
