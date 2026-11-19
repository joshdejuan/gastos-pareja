-- =====================================================================
--  Gastos v3: presupuestos, periodicidad mejorada, comparativas y tiempo real
--  (se aplica después de schema.sql)
-- =====================================================================

-- Presupuesto mensual por categoría (opcional)
alter table public.categories add column if not exists monthly_budget_cents integer
  check (monthly_budget_cents is null or (monthly_budget_cents > 0 and monthly_budget_cents <= 100000000));
grant update (monthly_budget_cents) on public.categories to authenticated;

-- Periodicidad: "cada N semanas/meses/años" y fecha de fin opcional
alter table public.recurring
  add column if not exists interval_count smallint not null default 1 check (interval_count between 1 and 12),
  add column if not exists end_date date;
alter table public.recurring drop constraint if exists recurring_end_after_start;
alter table public.recurring add constraint recurring_end_after_start check (end_date is null or end_date >= start_date);
grant update (end_date) on public.recurring to authenticated;

create or replace function public.recurring_step(p_frequency text, p_count smallint) returns interval
language sql immutable set search_path = '' as $$
  select p_count * case p_frequency when 'weekly' then interval '1 week'
                                    when 'monthly' then interval '1 month' else interval '1 year' end
$$;

create or replace function public.run_recurring_internal(p_household uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0; v_step interval; v_today date := public.today_local();
begin
  for r in select * from public.recurring
           where active and next_date <= v_today
             and (end_date is null or next_date <= end_date)
             and (p_household is null or household_id = p_household)
           for update skip locked
  loop
    v_step := public.recurring_step(r.frequency, r.interval_count);
    while r.next_date <= v_today and (r.end_date is null or r.next_date <= r.end_date) and v_n < 1000 loop
      insert into public.transactions (household_id, kind, category_id, paid_by, amount_cents, description,
                                       payer_share_pct, spent_on, recurring_id, created_by)
      values (r.household_id, r.kind, r.category_id, r.paid_by, r.amount_cents, r.description,
              r.payer_share_pct, r.next_date, r.id, r.created_by);
      r.occurrences := r.occurrences + 1;
      -- siempre desde la fecha de inicio: 31 ene → 28/29 feb → 31 mar
      r.next_date := (r.start_date + r.occurrences * v_step)::date;
      v_n := v_n + 1;
    end loop;
    update public.recurring set occurrences = r.occurrences, next_date = r.next_date where id = r.id;
  end loop;
  return v_n;
end $$;
revoke execute on function public.run_recurring_internal(uuid) from public, anon, authenticated;

create or replace function public.recurring_resume() returns trigger
language plpgsql set search_path = '' as $$
declare v_step interval;
begin
  if new.active and not old.active then
    v_step := public.recurring_step(new.frequency, new.interval_count);
    while new.next_date < public.today_local() loop
      new.occurrences := new.occurrences + 1;
      new.next_date := (new.start_date + new.occurrences * v_step)::date;
    end loop;
  end if;
  return new;
end $$;

-- Totales de ingresos y gastos por mes (los p_months meses que terminan en p_end). Respeta RLS.
create or replace function public.month_totals(p_end date, p_months integer default 12)
returns table (month date, income bigint, expense bigint)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', t.spent_on)::date,
         coalesce(sum(t.amount_cents) filter (where t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.kind = 'expense'), 0)::bigint
  from public.transactions t
  where t.household_id = public.my_household_id()
    and t.spent_on >= (date_trunc('month', p_end) - make_interval(months => least(greatest(p_months, 1), 36) - 1))::date
    and t.spent_on <  (date_trunc('month', p_end) + interval '1 month')::date
  group by 1 order by 1
$$;

-- Gasto por categoría entre dos fechas [p_from, p_to). Respeta RLS.
create or replace function public.category_totals(p_from date, p_to date)
returns table (category_id uuid, total bigint)
language sql stable security invoker set search_path = '' as $$
  select t.category_id, sum(t.amount_cents)::bigint
  from public.transactions t
  where t.household_id = public.my_household_id() and t.kind = 'expense'
    and t.spent_on >= p_from and t.spent_on < p_to
  group by 1
$$;

revoke execute on function public.month_totals(date, integer), public.category_totals(date, date) from public, anon;
grant execute on function public.month_totals(date, integer), public.category_totals(date, date) to authenticated;

-- Tiempo real: la app recibe al instante los cambios de la pareja (RLS se sigue aplicando)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.transactions, public.categories, public.recurring;
  end if;
end $$;
