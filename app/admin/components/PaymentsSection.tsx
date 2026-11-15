"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { currentMonth, parseFee } from "@/lib/payments";

type PaymentParent = { id: string; parent_name: string; student_name: string; monthly_fee: number | string | null };
type PaymentRecord = { parent_id: string; paid: boolean; amount: number | string | null; paid_at: string | null };
type Draft = { fee: string; paid: boolean };

const money = (value: number) => value.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });
const feeText = (value: number | string | null | undefined) => (value === null || value === undefined ? "" : String(Number(value)));

export default function PaymentsSection() {
  const [month, setMonth] = useState(currentMonth());
  const [parents, setParents] = useState<PaymentParent[]>([]);
  const [payments, setPayments] = useState<Map<string, PaymentRecord>>(new Map());
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    const response = await fetch(`/api/admin/payments?month=${encodeURIComponent(target)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage({ text: data.error || "Ödemeler yüklenemedi.", error: true }); setLoading(false); return; }
    const list: PaymentParent[] = data.parents || [];
    const records = new Map<string, PaymentRecord>((data.payments || []).map((p: PaymentRecord) => [p.parent_id, p]));
    setParents(list); setPayments(records); setSetupRequired(Boolean(data.setupRequired));
    setDraft(Object.fromEntries(list.map((p) => [p.id, { fee: feeText(p.monthly_fee), paid: records.get(p.id)?.paid ?? false }])));
    setLoading(false);
  }, []);
  useEffect(() => { load(month); }, [load, month]);

  const changed = useMemo(() => parents.filter((p) => {
    const d = draft[p.id];
    if (!d) return false;
    return d.paid !== (payments.get(p.id)?.paid ?? false) || d.fee.trim() !== feeText(p.monthly_fee);
  }), [parents, draft, payments]);

  const totals = useMemo(() => {
    let expected = 0, collected = 0;
    for (const p of parents) {
      const d = draft[p.id];
      const fee = parseFee(d?.fee ?? "") ?? 0;
      expected += fee;
      if (!d?.paid) continue;
      const record = payments.get(p.id);
      const unchanged = record?.paid && d.fee.trim() === feeText(p.monthly_fee);
      collected += unchanged && record.amount !== null ? Number(record.amount) : fee;
    }
    return { expected, collected, remaining: Math.max(0, expected - collected) };
  }, [parents, draft, payments]);

  function changeMonth(next: string) {
    if (!next || next === month) return;
    if (changed.length > 0 && !confirm("Kaydedilmemiş değişiklikler var. Ay değişirse kaybolacak; devam edilsin mi?")) return;
    setMessage(null); setMonth(next);
  }

  function update(id: string, patch: Partial<Draft>) {
    setMessage(null);
    setDraft((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function save() {
    setMessage(null);
    const items = [];
    for (const p of changed) {
      const d = draft[p.id];
      const item: { parentId: string; paid: boolean; fee?: number | null } = { parentId: p.id, paid: d.paid };
      if (d.fee.trim() !== feeText(p.monthly_fee)) {
        const fee = parseFee(d.fee);
        if (fee === undefined) { setMessage({ text: `${p.student_name} için ücret geçersiz.`, error: true }); return; }
        item.fee = fee;
      }
      items.push(item);
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/payments", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, items }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ text: data.error || "Kaydedilemedi.", error: true }); return; }
      await load(month);
      setMessage({ text: `${data.saved} kayıt kaydedildi.` });
    } finally { setSaving(false); }
  }

  return <section id="payments" className="adminCard paymentsCard">
    <div className="cardHead"><div><small>AİDAT TAKİBİ</small><h2>Ödemeler</h2></div><label className="paymentsMonth">Ay<input type="month" value={month} onChange={(e) => changeMonth(e.target.value)} /></label></div>
    {setupRequired && <div className="usersNotice">Ödeme özelliği için Supabase SQL Editor&apos;da <code>supabase/migrations/20261115_add_payments.sql</code> dosyasını çalıştırın.</div>}
    <div className="paymentsSummary"><div><small>BEKLENEN</small><b>{money(totals.expected)}</b></div><div><small>ÖDENEN</small><b className="paidTotal">{money(totals.collected)}</b></div><div><small>KALAN</small><b className={totals.remaining > 0 ? "dueTotal" : ""}>{money(totals.remaining)}</b></div></div>
    {loading ? <p>Yükleniyor…</p> : parents.length === 0 ? <p>{setupRequired ? "" : "Aktif veli hesabı yok."}</p> : <div className="paymentsList">
      <div className="paymentsHeader"><span>Veli / öğrenci</span><span>Aylık ücret (₺)</span><span>Ödendi</span></div>
      {parents.map((p) => {
        const d = draft[p.id] ?? { fee: "", paid: false };
        const dirty = changed.some((c) => c.id === p.id);
        return <div className={`paymentRow${d.paid ? " isPaid" : ""}${dirty ? " isDirty" : ""}`} key={p.id}>
          <span className="paymentName"><b>{p.parent_name}</b><small>{p.student_name}</small></span>
          <input className="paymentFee" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Ücret" aria-label={`${p.parent_name} aylık ücret`} value={d.fee} onChange={(e) => update(p.id, { fee: e.target.value })} />
          <span className="paymentPaid"><input type="checkbox" checked={d.paid} onChange={(e) => update(p.id, { paid: e.target.checked })} aria-label={`${p.parent_name} ${month} ödendi`} /><em>{d.paid ? "Ödendi" : "Ödenmedi"}</em></span>
        </div>;
      })}
    </div>}
    {message && <div className={`formMessage${message.error ? " error" : ""}`}>{message.text}</div>}
    <div className="paymentsActions"><span>{changed.length > 0 ? `${changed.length} değişiklik kaydedilmedi` : "Değişiklik yok"}</span><button className="adminPrimary" disabled={saving || changed.length === 0} onClick={save}>{saving ? "Kaydediliyor…" : "Kaydet →"}</button></div>
  </section>;
}
