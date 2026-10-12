-- Reportes derivados de cotizaciones y revisiones persistidas; no reescribe datos históricos.
begin;
create or replace function public.seller_period_report(p_period text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrador activo requerido' using errcode = '42501'; end if;
  if p_period is null or p_period not in ('week', 'month') or p_from is null or p_to is null
    or p_to <= p_from or p_to - p_from > interval '367 days' then
    raise exception 'Selecciona semana o mes y un rango de hasta un año';
  end if;
  with contributions as (
    select q.owner_id, date_trunc(p_period, q.created_at at time zone 'America/Panama')::date as period_start,
      1::bigint as quote_count,
      case when q.status <> 'cancelled' then (q.snapshot->>'total_usd_cents')::numeric else 0 end as usd_cents,
      case when q.status <> 'cancelled' then (q.snapshot->>'total_crc_cents')::numeric else 0 end as crc_cents,
      case when q.status <> 'cancelled' then coalesce((q.snapshot->>'unit_count')::bigint, 0) else 0 end as quoted_units,
      0::bigint as confirmed_count, 0::bigint as sold_units
    from public.quotes q where q.created_at >= p_from and q.created_at < p_to
    union all
    select q.owner_id, date_trunc(p_period, confirmation.at at time zone 'America/Panama')::date,
      0, 0, 0, 0, 1, coalesce((q.snapshot->>'unit_count')::bigint, 0)
    from public.quotes q
    cross join lateral (select max(r.created_at) as at from public.quote_revisions r
      where r.quote_id = q.id and r.new_status = 'confirmed' and r.previous_status is distinct from 'confirmed') confirmation
    where q.status = 'confirmed' and confirmation.at >= p_from and confirmation.at < p_to
  ), grouped as (
    select c.owner_id, c.period_start, sum(c.quote_count)::bigint as quote_count,
      sum(c.usd_cents) as total_usd_cents, sum(c.crc_cents) as total_crc_cents,
      sum(c.quoted_units)::bigint as quoted_units, sum(c.confirmed_count)::bigint as confirmed_count,
      sum(c.sold_units)::bigint as sold_units
    from contributions c group by c.owner_id, c.period_start
  )
  select coalesce(jsonb_agg(jsonb_build_object('seller_id', g.owner_id, 'username', p.username,
    'seller_name', p.display_name, 'period_start', g.period_start,
    'period_end', (g.period_start + case when p_period = 'week' then interval '6 days' else interval '1 month - 1 day' end)::date,
    'quote_count', g.quote_count, 'confirmed_count', g.confirmed_count, 'quoted_units', g.quoted_units,
    'sold_units', g.sold_units, 'total_usd_cents', g.total_usd_cents::text, 'total_crc_cents', g.total_crc_cents::text)
    order by g.period_start desc, p.username), '[]'::jsonb) into v_result
  from grouped g join public.profiles p on p.id = g.owner_id;
  return v_result;
end;
$$;
revoke all on function public.seller_period_report(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.seller_period_report(text,timestamptz,timestamptz) to authenticated;
commit;
