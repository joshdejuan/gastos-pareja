-- =====================================================================
--  Gastos en Pareja v2 — esquema para Supabase
--  Pega TODO este archivo en Supabase → SQL Editor → Run (proyecto nuevo).
-- =====================================================================

-- ---------- Tablas ---------------------------------------------------

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique
              default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind         text not null check (kind in ('expense', 'income')),
  name         text not null check (char_length(name) between 1 and 30),
  color        text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (id, household_id)
);
create unique index categories_name_uq on public.categories (household_id, kind, lower(name)) where not archived;

create table public.recurring (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  kind            text not null check (kind in ('expense', 'income')),
  category_id     uuid not null,
  paid_by         uuid not null references auth.users(id) on delete cascade,
  amount_cents    integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  description     text not null check (char_length(description) between 1 and 120),
  payer_share_pct smallint not null default 50 check (payer_share_pct between 0 and 100),
  frequency       text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  start_date      date not null,
  occurrences     integer not null default 0,     -- cuántas veces se ha generado ya
  next_date       date not null,
  active          boolean not null default true,
  created_by      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  foreign key (category_id, household_id) references public.categories(id, household_id)
);

create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  kind            text not null check (kind in ('expense', 'income', 'settlement')),
  category_id     uuid,
  paid_by         uuid not null references auth.users(id) on delete cascade,  -- quién pagó / quién recibió
  amount_cents    integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  description     text not null check (char_length(description) between 1 and 120),
  payer_share_pct smallint not null default 50 check (payer_share_pct between 0 and 100),
  spent_on        date not null,
  recurring_id    uuid references public.recurring(id) on delete set null,
  created_by      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  foreign key (category_id, household_id) references public.categories(id, household_id),
  check ((kind = 'settlement') = (category_id is null))
);
create index transactions_household_date_idx on public.transactions (household_id, spent_on desc);

-- ---------- Helpers ---------------------------------------------------

-- Fecha "de hoy" en horario peninsular español
create or replace function public.today_local() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Madrid')::date $$;

create or replace function public.my_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

create or replace function public.is_member(p_household uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members where household_id = p_household and user_id = p_user)
$$;

-- ---------- Permisos y RLS --------------------------------------------

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.categories        enable row level security;
alter table public.recurring         enable row level security;
alter table public.transactions      enable row level security;

revoke all on public.households, public.household_members, public.categories,
              public.recurring, public.transactions from anon, authenticated;

grant select on public.households, public.household_members to authenticated;
grant update (name)         on public.households        to authenticated;
grant update (display_name) on public.household_members to authenticated;
grant select, insert on public.categories to authenticated;
grant update (name, color, archived) on public.categories to authenticated;
grant select, insert, delete on public.recurring to authenticated;
grant update (category_id, paid_by, amount_cents, description, payer_share_pct, active) on public.recurring to authenticated;
grant select, insert, delete on public.transactions to authenticated;
grant update (category_id, paid_by, amount_cents, description, payer_share_pct, spent_on) on public.transactions to authenticated;

create policy hh_select on public.households for select to authenticated using (id = public.my_household_id());
create policy hh_update on public.households for update to authenticated using (id = public.my_household_id());

create policy hm_select on public.household_members for select to authenticated using (household_id = public.my_household_id());
create policy hm_update on public.household_members for update to authenticated using (user_id = auth.uid());

create policy cat_select on public.categories for select to authenticated using (household_id = public.my_household_id());
create policy cat_insert on public.categories for insert to authenticated with check (household_id = public.my_household_id());
create policy cat_update on public.categories for update to authenticated using (household_id = public.my_household_id());

create policy rec_select on public.recurring for select to authenticated using (household_id = public.my_household_id());
create policy rec_insert on public.recurring for insert to authenticated with check (
  household_id = public.my_household_id() and created_by = auth.uid()
  and public.is_member(household_id, paid_by));
create policy rec_update on public.recurring for update to authenticated
  using (household_id = public.my_household_id())
  with check (public.is_member(household_id, paid_by));
create policy rec_delete on public.recurring for delete to authenticated using (household_id = public.my_household_id());

create policy tx_select on public.transactions for select to authenticated using (household_id = public.my_household_id());
create policy tx_insert on public.transactions for insert to authenticated with check (
  household_id = public.my_household_id() and created_by = auth.uid()
  and public.is_member(household_id, paid_by));
create policy tx_update on public.transactions for update to authenticated
  using (household_id = public.my_household_id())
  with check (public.is_member(household_id, paid_by));
create policy tx_delete on public.transactions for delete to authenticated using (household_id = public.my_household_id());

-- La categoría de un movimiento debe ser del mismo tipo (gasto/ingreso)
create or replace function public.check_category_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.category_id is not null and not exists (
       select 1 from public.categories c where c.id = new.category_id and c.kind = new.kind) then
    raise exception 'La categoría no corresponde al tipo de movimiento';
  end if;
  return new;
end $$;
create trigger tx_category_kind before insert or update on public.transactions
  for each row execute function public.check_category_kind();
create trigger rec_category_kind before insert or update on public.recurring
  for each row execute function public.check_category_kind();

-- La primera fecha de un recurrente es su fecha de inicio
create or replace function public.recurring_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.occurrences := 0;
  new.next_date := new.start_date;
  return new;
end $$;
create trigger rec_defaults before insert on public.recurring
  for each row execute function public.recurring_defaults();

-- Al reactivar un recurrente pausado, no se generan los periodos que estuvo en pausa
create or replace function public.recurring_resume() returns trigger
language plpgsql set search_path = '' as $$
declare v_step interval;
begin
  if new.active and not old.active then
    v_step := case new.frequency when 'weekly' then interval '1 week'
                                 when 'monthly' then interval '1 month' else interval '1 year' end;
    while new.next_date < public.today_local() loop
      new.occurrences := new.occurrences + 1;
      new.next_date := (new.start_date + new.occurrences * v_step)::date;
    end loop;
  end if;
  return new;
end $$;
create trigger rec_resume before update on public.recurring
  for each row execute function public.recurring_resume();

-- ---------- Funciones (RPC) -------------------------------------------

create or replace function public.seed_categories(p_household uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.categories (household_id, kind, name, color) values
    (p_household, 'expense', 'Casa',         '#2a78d6'),
    (p_household, 'expense', 'Supermercado', '#eb6834'),
    (p_household, 'expense', 'Facturas',     '#1baf7a'),
    (p_household, 'expense', 'Restaurantes', '#eda100'),
    (p_household, 'expense', 'Ocio',         '#e87ba4'),
    (p_household, 'expense', 'Transporte',   '#008300'),
    (p_household, 'expense', 'Viajes',       '#6250d6'),
    (p_household, 'expense', 'Otros',        '#e34948'),
    (p_household, 'income',  'Nómina',       '#2a78d6'),
    (p_household, 'income',  'Extra',        '#eb6834'),
    (p_household, 'income',  'Otros',        '#1baf7a')
$$;
revoke execute on function public.seed_categories(uuid) from public, anon, authenticated;

create or replace function public.create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'Ya perteneces a un hogar';
  end if;
  insert into public.households (name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into public.household_members (household_id, user_id, display_name) values (v_id, auth.uid(), trim(p_display_name));
  perform public.seed_categories(v_id);
  return v_id;
end $$;

create or replace function public.join_household(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'Ya perteneces a un hogar';
  end if;
  select id into v_id from public.households where invite_code = upper(trim(p_code)) for update;
  if v_id is null then raise exception 'Código no válido'; end if;
  if (select count(*) from public.household_members where household_id = v_id) >= 2 then
    raise exception 'Este hogar ya está completo';
  end if;
  insert into public.household_members (household_id, user_id, display_name) values (v_id, auth.uid(), trim(p_display_name));
  return v_id;
end $$;

-- Genera los movimientos recurrentes pendientes hasta hoy (idempotente).
-- p_household = null → todos los hogares (lo usa la tarea programada).
create or replace function public.run_recurring_internal(p_household uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0; v_step interval; v_today date := public.today_local();
begin
  for r in select * from public.recurring
           where active and next_date <= v_today
             and (p_household is null or household_id = p_household)
           for update skip locked
  loop
    v_step := case r.frequency when 'weekly' then interval '1 week'
                               when 'monthly' then interval '1 month' else interval '1 year' end;
    while r.next_date <= v_today and v_n < 1000 loop
      insert into public.transactions (household_id, kind, category_id, paid_by, amount_cents, description,
                                       payer_share_pct, spent_on, recurring_id, created_by)
      values (r.household_id, r.kind, r.category_id, r.paid_by, r.amount_cents, r.description,
              r.payer_share_pct, r.next_date, r.id, r.created_by);
      r.occurrences := r.occurrences + 1;
      -- se calcula siempre desde la fecha de inicio: el 31 de enero → 28/29 feb → 31 mar
      r.next_date := (r.start_date + r.occurrences * v_step)::date;
      v_n := v_n + 1;
    end loop;
    update public.recurring set occurrences = r.occurrences, next_date = r.next_date where id = r.id;
  end loop;
  return v_n;
end $$;
revoke execute on function public.run_recurring_internal(uuid) from public, anon, authenticated;

create or replace function public.run_recurring() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_household_id() is null then return 0; end if;
  return public.run_recurring_internal(public.my_household_id());
end $$;

-- Saldo entre los dos (positivo = te deben). Los ingresos no afectan a la deuda.
create or replace function public.household_balance() returns table (user_id uuid, net_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select m.user_id,
         round(coalesce(sum(
           case when t.paid_by = m.user_id
                then  t.amount_cents * (100 - t.payer_share_pct) / 100.0
                else -t.amount_cents * (100 - t.payer_share_pct) / 100.0 end), 0))::bigint
  from public.household_members m
  left join public.transactions t on t.household_id = m.household_id and t.kind in ('expense', 'settlement')
  where m.household_id = public.my_household_id()
  group by m.user_id
$$;

-- Llamada por GitHub Actions: mantiene el proyecto activo y genera los recurrentes
create or replace function public.keepalive() returns integer
language plpgsql security definer set search_path = '' as $$
begin return public.run_recurring_internal(null); end $$;

revoke execute on function public.create_household(text, text), public.join_household(text, text),
  public.household_balance(), public.my_household_id(), public.is_member(uuid, uuid), public.run_recurring(),
  public.keepalive() from public, anon;
grant execute on function public.create_household(text, text), public.join_household(text, text),
  public.household_balance(), public.my_household_id(), public.is_member(uuid, uuid), public.run_recurring()
  to authenticated;
grant execute on function public.keepalive() to anon, authenticated;

-- ---------- Generación automática dentro de Supabase (4 veces al día) ----------
create extension if not exists pg_cron;
select cron.schedule('generar-periodicos', '7 0,6,12,18 * * *', $$select public.run_recurring_internal(null)$$);
