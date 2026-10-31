-- =====================================================================
-- حسابدار بهای تمام‌شده – راه‌اندازی سرور مرکزی (Supabase) – فاز ۶
-- این فایل را در Supabase بخش SQL Editor ← New query ← Paste ← Run اجرا کنید.
-- اجرای دوباره آن بی‌خطر است (اطلاعات قبلی پاک نمی‌شود).
-- =====================================================================

-- ---------- جدول‌ها ----------
create table if not exists public.cloud_companies (
  id text primary key,
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  company_id text not null references public.cloud_companies(id) on delete cascade,
  user_id uuid not null,
  email text,
  is_admin boolean not null default false,
  perms text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create sequence if not exists public.change_seq;

create table if not exists public.records (
  company_id text not null,
  store text not null,
  id text not null,
  data jsonb not null,
  version integer not null default 1,
  seq bigint not null default nextval('public.change_seq'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (company_id, store, id)
);
create index if not exists records_seq_idx on public.records (company_id, seq);

create table if not exists public.applied_ops (
  op_id text primary key,
  company_id text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  note text,
  payload text not null
);

-- دسترسی مستقیم به جدول‌ها بسته است؛ فقط از طریق تابع‌های زیر
alter table public.cloud_companies enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;
alter table public.applied_ops enable row level security;
alter table public.cloud_backups enable row level security;

-- ---------- بررسی مجوز ----------
create or replace function public.has_perm(p_company text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and (m.is_admin or p_perm = any (m.perms))
  );
$$;

-- مجوز لازم برای هر تغییر (قواعد کنترل دسترسی سمت سرور)
create or replace function public.need_perm(p_store text, p_data jsonb, p_cur jsonb, p_exists boolean)
returns text
language plpgsql
immutable
as $$
declare
  need text;
begin
  if p_store in ('companies', 'factories') then
    need := 'orgs';
  elsif p_store in ('accounts', 'fiscalYears', 'currencies', 'fxRates') then
    need := 'settings';
  elsif not p_exists then
    need := 'create';
  else
    need := 'edit';
  end if;

  if p_exists and (
       (coalesce(p_data->>'voided', '') = 'true' and coalesce(p_cur->>'voided', '') <> 'true')
    or (coalesce(p_data->>'status', '') = 'voided' and coalesce(p_cur->>'status', '') <> 'voided')
  ) then
    need := 'void';
  elsif p_store = 'stockMoves' then
    need := 'post';
  elsif p_store in ('docs', 'journals', 'prodOrders')
        and coalesce(p_data->>'status', '') in ('posted', 'done')
        and (not p_exists or coalesce(p_cur->>'status', '') <> coalesce(p_data->>'status', '')) then
    need := 'post';
  end if;
  return need;
end;
$$;

-- ---------- شرکت‌ها و اعضا ----------
create or replace function public.create_company(p_id text, p_name text, p_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.cloud_companies c where c.id = p_id) then
    if exists (select 1 from public.members m where m.company_id = p_id and m.user_id = uid) then
      return jsonb_build_object('ok', true, 'existing', true);
    end if;
    raise exception 'company_exists_not_member';
  end if;
  insert into public.cloud_companies(id, name, created_by) values (p_id, p_name, uid);
  insert into public.members(company_id, user_id, email, is_admin, perms)
  values (p_id, uid, lower(p_email), true,
          array['view','create','edit','void','post','reports','export','users','orgs','backup','settings']);
  return jsonb_build_object('ok', true, 'existing', false);
end;
$$;

create or replace function public.my_companies()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'is_admin', m.is_admin, 'perms', to_jsonb(m.perms))), '[]'::jsonb)
  from public.members m
  join public.cloud_companies c on c.id = m.company_id
  where m.user_id = auth.uid();
$$;

create or replace function public.add_member(p_company text, p_email text, p_perms text[], p_admin boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_perm(p_company, 'users') then raise exception 'no_permission'; end if;
  if p_admin and not exists (
       select 1 from public.members m
       where m.company_id = p_company and m.user_id = auth.uid() and m.is_admin) then
    raise exception 'only_admin_can_grant_admin';
  end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  if v_uid is null then raise exception 'user_not_found'; end if;
  insert into public.members(company_id, user_id, email, is_admin, perms)
  values (p_company, v_uid, lower(p_email), p_admin, coalesce(p_perms, '{}'))
  on conflict (company_id, user_id)
  do update set is_admin = excluded.is_admin, perms = excluded.perms;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.list_members(p_company text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_perm(p_company, 'users') then raise exception 'no_permission'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'email', m.email, 'is_admin', m.is_admin, 'perms', to_jsonb(m.perms))
             order by m.created_at), '[]'::jsonb)
    from public.members m where m.company_id = p_company
  );
end;
$$;

create or replace function public.remove_member(p_company text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_perm(p_company, 'users') then raise exception 'no_permission'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
  delete from public.members where company_id = p_company and user_id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- ارسال تغییرات (با کنترل نسخه، مجوز و جلوگیری از ثبت تکراری) ----------
create or replace function public.sync_push(p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  op jsonb;
  res jsonb;
  results jsonb := '[]'::jsonb;
  v_op_id text;
  v_company text;
  v_store text;
  v_id text;
  v_base integer;
  v_data jsonb;
  cur public.records%rowtype;
  v_exists boolean;
  need text;
  v_new integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    v_op_id := op->>'op_id';
    v_company := op->>'company_id';
    v_store := op->>'store';
    v_id := op->>'id';
    v_base := coalesce((op->>'base_version')::integer, 0);
    v_data := op->'data';

    -- ارسال تکراری همان تغییر: نتیجه قبلی برگردانده می‌شود و دوباره ثبت نمی‌شود
    select a.result into res from public.applied_ops a where a.op_id = v_op_id;
    if found then
      results := results || jsonb_build_array(jsonb_build_object(
        'op_id', v_op_id, 'status', 'duplicate', 'version', (res->>'version')::integer));
      continue;
    end if;

    if v_store is null or v_id is null or v_company is null or v_data is null then
      results := results || jsonb_build_array(jsonb_build_object('op_id', v_op_id, 'status', 'denied', 'reason', 'bad_request'));
      continue;
    end if;

    if not exists (select 1 from public.members m where m.company_id = v_company and m.user_id = uid) then
      results := results || jsonb_build_array(jsonb_build_object('op_id', v_op_id, 'status', 'denied', 'reason', 'not_member'));
      continue;
    end if;

    if (v_store = 'companies' and v_id <> v_company)
       or (v_store <> 'companies' and coalesce(v_data->>'companyId', '') <> v_company) then
      results := results || jsonb_build_array(jsonb_build_object('op_id', v_op_id, 'status', 'denied', 'reason', 'company_mismatch'));
      continue;
    end if;

    select * into cur from public.records r
     where r.company_id = v_company and r.store = v_store and r.id = v_id
     for update;
    v_exists := found;

    need := public.need_perm(v_store, v_data, case when v_exists then cur.data else null end, v_exists);
    if not public.has_perm(v_company, need) then
      results := results || jsonb_build_array(jsonb_build_object('op_id', v_op_id, 'status', 'denied', 'reason', 'no_permission:' || need));
      continue;
    end if;

    if v_exists then
      if cur.data = v_data then
        results := results || jsonb_build_array(jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'version', cur.version));
        continue;
      end if;
      if cur.version <> v_base then
        results := results || jsonb_build_array(jsonb_build_object(
          'op_id', v_op_id, 'status', 'conflict', 'version', cur.version,
          'server', jsonb_build_object('version', cur.version, 'data', cur.data)));
        continue;
      end if;
      v_new := cur.version + 1;
      update public.records
         set data = v_data, version = v_new, seq = nextval('public.change_seq'),
             updated_by = uid, updated_at = now()
       where company_id = v_company and store = v_store and id = v_id;
    else
      v_new := 1;
      insert into public.records(company_id, store, id, data, version, updated_by)
      values (v_company, v_store, v_id, v_data, 1, uid);
    end if;

    res := jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'version', v_new);
    insert into public.applied_ops(op_id, company_id, result) values (v_op_id, v_company, res)
    on conflict (op_id) do nothing;
    results := results || jsonb_build_array(res);
  end loop;

  return results;
end;
$$;

-- ---------- دریافت تغییرات ----------
create or replace function public.sync_pull(p_since bigint default 0, p_limit integer default 500)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', t.company_id, 'store', t.store, 'id', t.id,
           'data', t.data, 'version', t.version, 'seq', t.seq) order by t.seq), '[]'::jsonb)
  from (
    select r.*
    from public.records r
    join public.members m on m.company_id = r.company_id and m.user_id = auth.uid()
    where r.seq > p_since and (m.is_admin or 'view' = any (m.perms))
    order by r.seq
    limit least(greatest(p_limit, 1), 1000)
  ) t;
$$;

-- ---------- پشتیبان ابری ----------
create or replace function public.save_backup(p_company text, p_payload text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_perm(p_company, 'backup') then raise exception 'no_permission'; end if;
  insert into public.cloud_backups(company_id, created_by, note, payload)
  values (p_company, auth.uid(), p_note, p_payload);
  delete from public.cloud_backups
   where company_id = p_company
     and id not in (select b.id from public.cloud_backups b
                     where b.company_id = p_company order by b.created_at desc limit 30);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.list_backups(p_company text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_perm(p_company, 'backup') then raise exception 'no_permission'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'created_at', b.created_at, 'note', b.note, 'size', length(b.payload))
             order by b.created_at desc), '[]'::jsonb)
    from public.cloud_backups b where b.company_id = p_company
  );
end;
$$;

create or replace function public.get_backup(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text;
  v_payload text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select b.company_id, b.payload into v_company, v_payload from public.cloud_backups b where b.id = p_id;
  if v_company is null then raise exception 'not_found'; end if;
  if not public.has_perm(v_company, 'backup') then raise exception 'no_permission'; end if;
  return v_payload;
end;
$$;

-- ---------- دسترسی‌ها: فقط کاربران واردشده ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_company(text, text, text) to authenticated;
grant execute on function public.my_companies() to authenticated;
grant execute on function public.add_member(text, text, text[], boolean) to authenticated;
grant execute on function public.list_members(text) to authenticated;
grant execute on function public.remove_member(text, uuid) to authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
grant execute on function public.save_backup(text, text, text) to authenticated;
grant execute on function public.list_backups(text) to authenticated;
grant execute on function public.get_backup(uuid) to authenticated;
