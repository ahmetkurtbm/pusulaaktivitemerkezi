type QueryFilters = Record<string, unknown>;
type Row = Record<string, unknown>;
type FakeError = { message: string; code?: string };

/** login_attempts tablosunu bellekte tutan basit bir Supabase taklidi. */
export function createFakeSupabase(options: {
  /** login_attempts tablosuna önceden yazılmış satırlar (created_at verilmezse şimdi). */
  attempts?: Row[];
  parentAccount?: Row | null;
  adminUser?: Row | null;
  /** Belirtilen işlem hata nesnesi döndürür (Supabase hata fırlatmaz, error alanı döner). */
  loginAttemptsError?: { insert?: FakeError; count?: FakeError };
} = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; row: Record<string, unknown>; filters: QueryFilters }> = [];
  const deletes: Array<{ table: string; filters: QueryFilters }> = [];
  const attempts: Row[] = (options.attempts ?? []).map((row, index) => ({ id: `seed-${index}`, success: false, created_at: new Date().toISOString(), ...row }));
  let nextId = 1;

  const matches = (row: Row, filters: QueryFilters) =>
    Object.entries(filters).every(([key, value]) => {
      if (key.startsWith("gte.")) return String(row[key.slice(4)]) >= String(value);
      if (key.startsWith("lt.")) return String(row[key.slice(3)]) < String(value);
      return row[key] === value;
    });

  const db = {
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          const filters: QueryFilters = {};
          const query = {
            eq(field: string, value: unknown) { filters[field] = value; return query; },
            gte(field: string, value: unknown) { filters[`gte.${field}`] = value; return query; },
            neq(field: string, value: unknown) { filters[`not.${field}`] = value; return query; },
            order() { return query; },
            maybeSingle() {
              const account = table === "parent_accounts" ? options.parentAccount : table === "admin_users" ? options.adminUser : null;
              // active filtresi gerçek veritabanındaki gibi uygulanır.
              if (account && "active" in filters && account.active !== filters.active) return Promise.resolve({ data: null, error: null });
              return Promise.resolve({ data: account ?? null, error: null });
            },
            then(onFulfilled: (v: { count: number | null; error: FakeError | null } | { data: unknown[]; error: null }) => unknown, onRejected?: (e: unknown) => unknown) {
              if (opts?.count) {
                if (options.loginAttemptsError?.count) return Promise.resolve({ count: null, error: options.loginAttemptsError.count }).then(onFulfilled, onRejected);
                const count = attempts.filter((row) => matches(row, filters)).length;
                return Promise.resolve({ count, error: null }).then(onFulfilled, onRejected);
              }
              return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
            },
          };
          return query;
        },
        insert(row: Record<string, unknown>) {
          const failed = table === "login_attempts" && options.loginAttemptsError?.insert;
          if (failed) {
            return { select: () => ({ single: () => Promise.resolve({ data: null, error: failed }) }), then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: failed }).then(f, r) };
          }
          inserts.push({ table, row });
          const stored = table === "login_attempts" ? { id: `attempt-${nextId++}`, created_at: new Date().toISOString(), ...row } : null;
          if (stored) attempts.push(stored);
          return {
            select: () => ({ single: () => Promise.resolve({ data: stored ? { id: stored.id } : null, error: null }) }),
            then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f, r),
          };
        },
        update(row: Record<string, unknown>) {
          const filters: QueryFilters = {};
          const builder = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              updates.push({ table, row, filters });
              if (table === "login_attempts") attempts.filter((a) => matches(a, filters)).forEach((a) => Object.assign(a, row));
              return Promise.resolve({ data: null, error: null });
            },
          };
          return builder;
        },
        delete() {
          const filters: QueryFilters = {};
          const done = () => {
            deletes.push({ table, filters });
            if (table === "login_attempts") for (let i = attempts.length - 1; i >= 0; i--) if (matches(attempts[i], filters)) attempts.splice(i, 1);
            return Promise.resolve({ data: null, error: null });
          };
          return {
            eq(field: string, value: unknown) { filters[field] = value; return done(); },
            lt(field: string, value: unknown) { filters[`lt.${field}`] = value; return done(); },
          };
        },
      };
    },
    inserts,
    updates,
    deletes,
    attempts,
  };

  return db;
}

/** Aynı (hesap, IP) için n adet başarısız deneme satırı üretir. */
export function failures(n: number, row: { scope: "admin" | "parent"; ip: string; account_key: string }): Row[] {
  return Array.from({ length: n }, () => ({ ...row, success: false }));
}
