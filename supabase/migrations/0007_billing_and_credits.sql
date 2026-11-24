-- Managed AI subscriptions, unified credits, and immutable credit ledger

create table if not exists public.user_subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan_id text not null default 'free' check (plan_id in ('free', 'pro', 'sprint_90', 'plus')),
  status text not null default 'active' check (status in ('active', 'canceled', 'expired', 'past_due')),
  billing_currency text not null default 'INR' check (billing_currency in ('INR', 'USD')),
  ai_mode_preference text not null default 'fast' check (ai_mode_preference in ('fast', 'precision')),
  use_byok_override boolean not null default false,
  monthly_credits_remaining integer not null default 25 check (monthly_credits_remaining >= 0),
  monthly_credits_allowance integer not null default 25 check (monthly_credits_allowance >= 0),
  topup_credits_remaining integer not null default 0 check (topup_credits_remaining >= 0),
  current_period_start timestamptz not null default timezone('utc', now()),
  current_period_end timestamptz not null default (timezone('utc', now()) + interval '30 days'),
  payment_provider text check (payment_provider is null or payment_provider in ('stripe', 'razorpay', 'dodo', 'manual')),
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists user_subscriptions_set_updated_at on public.user_subscriptions;
create trigger user_subscriptions_set_updated_at
  before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null,
  bucket text not null check (bucket in ('monthly', 'topup')),
  reason text not null,
  ai_mode text check (ai_mode is null or ai_mode in ('fast', 'precision', 'byok')),
  balance_after integer not null check (balance_after >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_credit_ledger_user_created
  on public.credit_ledger (user_id, created_at desc);

alter table public.user_subscriptions enable row level security;
alter table public.credit_ledger enable row level security;

-- Users can read their own subscription & credit ledger, while all writes happen server-side via service_role.
drop policy if exists "user_subscriptions_owner_select" on public.user_subscriptions;
create policy "user_subscriptions_owner_select"
  on public.user_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "credit_ledger_owner_select" on public.credit_ledger;
create policy "credit_ledger_owner_select"
  on public.credit_ledger
  for select
  to authenticated
  using (auth.uid() = user_id);

grant all on table public.user_subscriptions to service_role;
grant select on table public.user_subscriptions to authenticated;

grant all on table public.credit_ledger to service_role;
grant select on table public.credit_ledger to authenticated;
