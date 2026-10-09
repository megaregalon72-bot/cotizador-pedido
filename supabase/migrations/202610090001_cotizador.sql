-- Ejecutar como postgres mediante SQL Editor o `supabase db push`.
begin;

create type public.app_role as enum ('admin', 'seller');
create type public.quote_status as enum ('draft', 'sent', 'confirmed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9_-]$' and strpos(username, '..') = 0),
  display_name text not null check (char_length(display_name) between 1 and 100),
  role public.app_role not null default 'seller',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create unique index clients_owner_name on public.clients(owner_id, lower(name));
create table public.quotes (
  id uuid primary key,
  number bigint generated always as identity unique,
  owner_id uuid not null references public.profiles(id),
  username text not null,
  client_id uuid not null references public.clients(id),
  customer_name text not null,
  status public.quote_status not null default 'draft',
  revision integer not null default 1 check (revision > 0),
  input_payload jsonb not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_owner_created on public.quotes(owner_id, created_at desc);
create index quotes_created on public.quotes(created_at desc);
create index quotes_customer on public.quotes(lower(customer_name));
create index quotes_status on public.quotes(status);
create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id),
  position integer not null check (position > 0),
  description text not null,
  quantity integer not null check (quantity between 1 and 9999),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 999999999),
  tax_exempt boolean not null default false,
  unique(quote_id, position)
);
create table public.quote_revisions (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes(id),
  revision integer not null,
  actor_id uuid not null references public.profiles(id),
  previous_snapshot jsonb,
  new_snapshot jsonb not null,
  previous_status public.quote_status,
  new_status public.quote_status not null,
  created_at timestamptz not null default now(),
  unique(quote_id, revision)
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  actor_username text,
  action text not null,
  resource_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_created on public.audit_events(created_at desc);
create index audit_actor on public.audit_events(actor_id, created_at desc);

create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active);
$$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;
create function public.can_read_quote(p_quote_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and exists(
    select 1 from public.quotes where id = p_quote_id and (owner_id = auth.uid() or public.is_admin())
  );
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_revisions enable row level security;
alter table public.audit_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy clients_read on public.clients for select to authenticated using (public.is_active_user() and (owner_id = auth.uid() or public.is_admin()));
create policy quotes_read on public.quotes for select to authenticated using (public.is_active_user() and (owner_id = auth.uid() or public.is_admin()));
create policy items_read on public.quote_items for select to authenticated using (public.can_read_quote(quote_id));
create policy revisions_read on public.quote_revisions for select to authenticated using (public.can_read_quote(quote_id));
create policy audit_read on public.audit_events for select to authenticated using (public.is_admin());
-- Sin políticas de escritura: los cambios pasan por funciones con comprobaciones explícitas.
revoke all on public.profiles, public.clients, public.quotes, public.quote_items, public.quote_revisions, public.audit_events from anon, authenticated;
grant select on public.profiles, public.clients, public.quotes, public.quote_items, public.quote_revisions, public.audit_events to authenticated;
grant select on public.profiles to service_role;

create function public.append_audit(p_actor uuid, p_action text, p_resource uuid, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_id, actor_username, action, resource_id, details)
  values(p_actor, (select username from public.profiles where id = p_actor), p_action, p_resource, p_details);
end;
$$;
revoke all on function public.append_audit(uuid, text, uuid, jsonb) from public, anon, authenticated;

create function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Metadata solo identifica al usuario; jamás concede rol ni activa cuentas.
  insert into public.profiles(id, username, display_name)
  values(new.id, lower(split_part(new.email, '@', 1)), coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)));
  perform public.append_audit(null, 'user_provisioned', new.id, jsonb_build_object('username', lower(split_part(new.email, '@', 1)), 'active', false));
  return new;
end;
$$;
revoke all on function public.handle_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_auth_user();

create function public.admin_set_profile(p_actor uuid, p_target uuid, p_role public.app_role, p_active boolean, p_display_name text, p_action text default 'user_updated')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.profiles; v_new public.profiles;
begin
  perform pg_advisory_xact_lock(91230577);
  if not exists(select 1 from public.profiles where id = p_actor and active and role = 'admin') then
    raise exception 'Administrador activo requerido' using errcode = '42501';
  end if;
  select * into v_old from public.profiles where id = p_target for update;
  if not found then raise exception 'Usuario inexistente'; end if;
  if p_role is null or p_active is null or p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 100 then raise exception 'Datos de usuario inválidos'; end if;
  if v_old.active and v_old.role = 'admin' and (not p_active or p_role <> 'admin')
    and not exists(select 1 from public.profiles where id <> p_target and active and role = 'admin') then
    raise exception 'Debe quedar al menos un administrador activo';
  end if;
  update public.profiles set role = p_role, active = p_active, display_name = btrim(p_display_name), updated_at = now()
  where id = p_target returning * into v_new;
  perform public.append_audit(p_actor, case when p_action = 'user_created' then p_action when v_old.active <> p_active then case when p_active then 'user_reactivated' else 'user_deactivated' end else 'user_updated' end,
    p_target, jsonb_build_object('previous', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return to_jsonb(v_new);
end;
$$;
revoke all on function public.admin_set_profile(uuid, uuid, public.app_role, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_profile(uuid, uuid, public.app_role, boolean, text, text) to service_role;

create function public.bootstrap_admin(p_target uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  perform pg_advisory_xact_lock(91230577);
  if exists(select 1 from public.profiles where role = 'admin') then raise exception 'Ya existe un administrador; usa la gestión de usuarios'; end if;
  update public.profiles set role = 'admin', active = true, updated_at = now() where id = p_target returning * into v_profile;
  if not found then raise exception 'Usuario inexistente'; end if;
  perform public.append_audit(p_target, 'admin_bootstrapped', p_target);
  return to_jsonb(v_profile);
end;
$$;
revoke all on function public.bootstrap_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(uuid) to service_role;

create function public.record_admin_event(p_actor uuid, p_target uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = p_actor and active and role = 'admin') then raise exception 'Administrador activo requerido' using errcode = '42501'; end if;
  if p_action not in ('password_reset_requested', 'password_reset') then raise exception 'Evento inválido'; end if;
  perform public.append_audit(p_actor, p_action, p_target);
end;
$$;
revoke all on function public.record_admin_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_admin_event(uuid, uuid, text) to service_role;

create function public.record_session_event(p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_user() then raise exception 'Cuenta inactiva' using errcode = '42501'; end if;
  if p_action not in ('login', 'logout') then raise exception 'Evento inválido'; end if;
  perform public.append_audit(auth.uid(), p_action, auth.uid());
end;
$$;
revoke all on function public.record_session_event(text) from public, anon;
grant execute on function public.record_session_event(text) to authenticated;

create function public.quote_response(p_quote public.quotes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_quote.id, 'number', 'COT-' || lpad(p_quote.number::text, 8, '0'),
    'owner_id', p_quote.owner_id, 'username', p_quote.username, 'customer_name', p_quote.customer_name,
    'status', p_quote.status, 'revision', p_quote.revision, 'created_at', p_quote.created_at,
    'updated_at', p_quote.updated_at, 'snapshot', p_quote.snapshot);
$$;
revoke all on function public.quote_response(public.quotes) from public, anon;
grant execute on function public.quote_response(public.quotes) to authenticated;

create function public.save_quote(p_id uuid, p_expected_revision integer, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.profiles; v_quote public.quotes; v_previous public.quotes; v_client uuid;
  v_customer text; v_rate numeric; v_weight numeric; v_subtotal numeric := 0; v_shipping numeric; v_total numeric;
  v_items jsonb := '[]'::jsonb; v_item jsonb; v_price numeric; v_qty integer; v_description text; v_exempt boolean;
  v_units integer := 0; v_count integer := 0; v_snapshot jsonb; v_input jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid() and active;
  if not found then raise exception 'Sesión válida y cuenta activa requeridas' using errcode = '42501'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 or jsonb_typeof(p_payload) <> 'object' then raise exception 'Solicitud inválida'; end if;
  v_customer := btrim(p_payload->>'customer_name');
  if v_customer is null or char_length(v_customer) not between 1 and 120 or v_customer ~ '[[:cntrl:]]' then raise exception 'Nombre del cliente inválido'; end if;
  if coalesce(p_payload->>'exchange_rate_cents', '') !~ '^[0-9]{1,9}$' or coalesce(p_payload->>'weight_micros', '') !~ '^[0-9]{1,13}$' then raise exception 'Cambio o peso inválidos'; end if;
  v_rate := (p_payload->>'exchange_rate_cents')::numeric;
  v_weight := (p_payload->>'weight_micros')::numeric;
  if v_rate not between 1 and 100000000 or v_weight not between 0 and 1000000000000 then raise exception 'Cambio o peso fuera de rango'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Lista de productos requerida'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'De 1 a 100 productos requeridos'; end if;
  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    if coalesce(v_item->>'unit_price_cents', '') !~ '^[0-9]{1,9}$' or coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,4}$' then raise exception 'Precio o cantidad inválidos'; end if;
    v_price := (v_item->>'unit_price_cents')::numeric; v_qty := (v_item->>'quantity')::integer;
    if v_price not between 0 and 999999999 or v_qty not between 1 and 9999 then raise exception 'Precio o cantidad fuera de rango'; end if;
    v_count := v_count + 1; v_units := v_units + v_qty;
    v_description := coalesce(nullif(btrim(v_item->>'description'), ''), 'Producto ' || v_count);
    if char_length(v_description) > 120 or v_description ~ '[[:cntrl:]]' then raise exception 'Descripción inválida'; end if;
    if v_item ? 'tax_exempt' and jsonb_typeof(v_item->'tax_exempt') <> 'boolean' then raise exception 'Exención inválida'; end if;
    v_exempt := coalesce((v_item->>'tax_exempt')::boolean, false);
    v_subtotal := v_subtotal + v_price * v_qty;
    v_items := v_items || jsonb_build_array(jsonb_build_object('description', v_description, 'unit_price_cents', v_price::text,
      'quantity', v_qty, 'tax_exempt', v_exempt, 'subtotal_cents', (v_price * v_qty)::text));
  end loop;
  v_shipping := case when v_weight <= 10000000 then 1500 when v_weight <= 20000000 then 3000 else 4000 end;
  v_total := v_subtotal + v_shipping;
  -- El servidor recalcula los importes; nunca confía en totales enviados por el navegador.
  v_input := jsonb_build_object('customer_name', v_customer, 'exchange_rate_cents', v_rate::text,
    'weight_micros', v_weight::text, 'items', v_items);
  v_snapshot := v_input || jsonb_build_object('subtotal_cents', v_subtotal::text, 'shipping_cents', v_shipping::text,
    'total_usd_cents', v_total::text, 'total_crc_cents', round(v_total * v_rate / 100)::text,
    'shipping_rate_label', case when v_weight <= 10000000 then '0–10 kg' when v_weight <= 20000000 then 'Más de 10–20 kg' else 'Más de 20 kg' end,
    'product_count', v_count, 'unit_count', v_units, 'tax_rate_basis_points', null, 'tax_cents', null,
    'tax_note', 'Sin tasa de IVA definida; precios finales. Exenciones registradas sin modificar importes.');
  -- Serializa reintentos del mismo ID, incluso cuando llegan a la vez.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previous from public.quotes where id = p_id for update;
  if found then
    if v_previous.owner_id <> v_actor.id and v_actor.role <> 'admin' then raise exception 'Cotización no autorizada' using errcode = '42501'; end if;
    if v_previous.input_payload = v_input then return public.quote_response(v_previous); end if;
    if v_previous.status in ('confirmed', 'cancelled') then raise exception 'Esta cotización está cerrada; crea una nueva'; end if;
    if p_expected_revision <> v_previous.revision then raise exception 'Conflicto: recarga la cotización antes de guardar' using errcode = '40001'; end if;
  elsif p_expected_revision <> 0 then raise exception 'Cotización inexistente'; end if;
  insert into public.clients(owner_id, name) values(coalesce(v_previous.owner_id, v_actor.id), v_customer)
    on conflict (owner_id, lower(name)) do nothing;
  select id into v_client from public.clients where owner_id = coalesce(v_previous.owner_id, v_actor.id) and lower(name) = lower(v_customer);
  if v_previous.id is null then
    insert into public.quotes(id, owner_id, username, client_id, customer_name, input_payload, snapshot)
    values(p_id, v_actor.id, v_actor.username, v_client, v_customer, v_input, v_snapshot) returning * into v_quote;
  else
    update public.quotes set client_id = v_client, customer_name = v_customer, input_payload = v_input, snapshot = v_snapshot,
      revision = revision + 1, updated_at = now() where id = p_id returning * into v_quote;
    delete from public.quote_items where quote_id = p_id;
  end if;
  insert into public.quote_items(quote_id, position, description, quantity, unit_price_cents, tax_exempt)
  select p_id, ordinality, value->>'description', (value->>'quantity')::integer, (value->>'unit_price_cents')::bigint, (value->>'tax_exempt')::boolean
  from jsonb_array_elements(v_items) with ordinality;
  insert into public.quote_revisions(quote_id, revision, actor_id, previous_snapshot, new_snapshot, previous_status, new_status)
  values(p_id, v_quote.revision, v_actor.id, v_previous.snapshot, v_snapshot, v_previous.status, v_quote.status);
  perform public.append_audit(v_actor.id, case when v_previous.id is null then 'quote_created' else 'quote_updated' end, p_id,
    jsonb_build_object('revision', v_quote.revision, 'previous', v_previous.snapshot, 'new', v_snapshot));
  return public.quote_response(v_quote);
end;
$$;
revoke all on function public.save_quote(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_quote(uuid, integer, jsonb) to authenticated;

create function public.set_quote_status(p_id uuid, p_status public.quote_status, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles; v_old public.quotes; v_new public.quotes;
begin
  select * into v_actor from public.profiles where id = auth.uid() and active;
  if not found then raise exception 'Cuenta inactiva' using errcode = '42501'; end if;
  select * into v_old from public.quotes where id = p_id for update;
  if not found then raise exception 'Cotización inexistente'; end if;
  if v_old.owner_id <> v_actor.id and v_actor.role <> 'admin' then raise exception 'Cotización no autorizada' using errcode = '42501'; end if;
  if p_status is null then raise exception 'Estado inválido'; end if;
  if v_old.status = p_status then return public.quote_response(v_old); end if;
  if p_expected_revision is null or v_old.revision <> p_expected_revision then raise exception 'Conflicto: recarga la cotización' using errcode = '40001'; end if;
  if v_actor.role <> 'admin' and (p_status = 'confirmed' or v_old.status in ('confirmed', 'cancelled')) then raise exception 'Solo el administrador puede confirmar o reabrir una cotización' using errcode = '42501'; end if;
  update public.quotes set status = p_status, revision = revision + 1, updated_at = now() where id = p_id returning * into v_new;
  insert into public.quote_revisions(quote_id, revision, actor_id, previous_snapshot, new_snapshot, previous_status, new_status)
  values(p_id, v_new.revision, v_actor.id, v_old.snapshot, v_new.snapshot, v_old.status, v_new.status);
  perform public.append_audit(v_actor.id, case when p_status = 'cancelled' then 'quote_cancelled' else 'quote_status_changed' end, p_id,
    jsonb_build_object('revision', v_new.revision, 'previous_status', v_old.status, 'new_status', p_status));
  return public.quote_response(v_new);
end;
$$;
revoke all on function public.set_quote_status(uuid, public.quote_status, integer) from public, anon;
grant execute on function public.set_quote_status(uuid, public.quote_status, integer) to authenticated;

create function public.search_quotes(p_customer text default '', p_username text default '', p_number text default '',
  p_status public.quote_status default null, p_from timestamptz default null, p_to timestamptz default null,
  p_page integer default 1, p_page_size integer default 20, p_sort text default 'desc', p_own_only boolean default false) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_count bigint; v_rows jsonb;
begin
  if not public.is_active_user() then raise exception 'Cuenta inactiva' using errcode = '42501'; end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100 then raise exception 'Paginación inválida'; end if;
  select count(*) into v_count from public.quotes q where (not p_own_only or q.owner_id = auth.uid()) and
    (coalesce(p_customer, '') = '' or strpos(lower(q.customer_name), lower(p_customer)) > 0) and
    (coalesce(p_username, '') = '' or strpos(q.username, lower(p_username)) > 0) and
    (coalesce(p_number, '') = '' or strpos('COT-' || lpad(q.number::text, 8, '0'), upper(p_number)) > 0) and
    (p_status is null or q.status = p_status) and (p_from is null or q.created_at >= p_from) and (p_to is null or q.created_at < p_to);
  select coalesce(jsonb_agg(public.quote_response(filtered)), '[]'::jsonb) into v_rows from (
    select q.* from public.quotes q where (not p_own_only or q.owner_id = auth.uid()) and
      (coalesce(p_customer, '') = '' or strpos(lower(q.customer_name), lower(p_customer)) > 0) and
      (coalesce(p_username, '') = '' or strpos(q.username, lower(p_username)) > 0) and
      (coalesce(p_number, '') = '' or strpos('COT-' || lpad(q.number::text, 8, '0'), upper(p_number)) > 0) and
      (p_status is null or q.status = p_status) and (p_from is null or q.created_at >= p_from) and (p_to is null or q.created_at < p_to)
    order by case when p_sort = 'asc' then q.created_at end asc, case when p_sort <> 'asc' then q.created_at end desc, q.id
    limit p_page_size offset (p_page - 1) * p_page_size
  ) filtered;
  return jsonb_build_object('total', v_count, 'rows', v_rows, 'page', p_page);
end;
$$;
revoke all on function public.search_quotes(text, text, text, public.quote_status, timestamptz, timestamptz, integer, integer, text, boolean) from public, anon;
grant execute on function public.search_quotes(text, text, text, public.quote_status, timestamptz, timestamptz, integer, integer, text, boolean) to authenticated;

create function public.get_quote(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_quote public.quotes; v_revisions jsonb;
begin
  if not public.can_read_quote(p_id) then raise exception 'Cotización no autorizada' using errcode = '42501'; end if;
  select * into v_quote from public.quotes where id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('revision', r.revision, 'actor_username', p.username,
    'created_at', r.created_at, 'previous_snapshot', r.previous_snapshot, 'new_snapshot', r.new_snapshot,
    'previous_status', r.previous_status, 'new_status', r.new_status) order by r.revision desc), '[]'::jsonb)
    into v_revisions from public.quote_revisions r join public.profiles p on p.id = r.actor_id where r.quote_id = p_id;
  return public.quote_response(v_quote) || jsonb_build_object('revisions', v_revisions);
end;
$$;
revoke all on function public.get_quote(uuid) from public, anon;
grant execute on function public.get_quote(uuid) to authenticated;

create function public.quote_statistics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrador requerido' using errcode = '42501'; end if;
  select jsonb_build_object('quotes', count(*), 'active_users', (select count(*) from public.profiles where active),
    'total_usd_cents', coalesce(sum((snapshot->>'total_usd_cents')::numeric) filter(where status <> 'cancelled'), 0)::text,
    'total_crc_cents', coalesce(sum((snapshot->>'total_crc_cents')::numeric) filter(where status <> 'cancelled'), 0)::text) into v_result from public.quotes;
  return v_result;
end;
$$;
revoke all on function public.quote_statistics() from public, anon;
grant execute on function public.quote_statistics() to authenticated;

commit;
