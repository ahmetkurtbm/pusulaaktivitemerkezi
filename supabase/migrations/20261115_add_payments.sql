-- Aylık ücret ve aylık ödeme takibi (yalnızca yönetim panelinden erişilir).
alter table public.parent_accounts
  add column if not exists monthly_fee numeric(10,2) check (monthly_fee is null or monthly_fee >= 0);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parent_accounts(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  paid boolean not null default false,
  amount numeric(10,2) check (amount is null or amount >= 0),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (parent_id, period)
);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

create index if not exists payments_period_idx on public.payments(period);
