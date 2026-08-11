-- The deployed Lab_management database was created from the older contract department
-- department migration. Its create RPC had already been updated, but the
-- table check and update RPC still rejected the newer POCT department.
-- Keep this migration idempotent so it can also be replayed against staging.

begin;

alter table public.contracts
  drop constraint if exists contracts_department_check;

alter table public.contracts
  add constraint contracts_department_check
  check (department in (
    'สำนักงานกลุ่มงานเทคนิคการแพทย์',
    'งานเคมีคลินิก',
    'งานโลหิตวิทยาคลินิก',
    'งานภูมิคุ้มกันวิทยาคลินิก',
    'งานจุลทรรศนศาสตร์คลินิก',
    'งานอณูชีววิทยา',
    'งานจุลชีววิทยา',
    'งานคลังเลือด',
    'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
    'งานบริการผู้ป่วยนอก',
    'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
    'คลังน้ำยาและวัสดุวิทยาศาสตร์',
    'POCT'
  ));

-- Preserve the deployed update_contract body and patch only its stale
-- department allowlist. This avoids replacing unrelated production changes
-- while still making the SQL migration self-contained.
do $migration$
declare
  function_sql text;
  old_block text;
  new_block text;
  line_break text := chr(13) || chr(10);
begin
  old_block := '    or parsed_department not in (' || line_break ||
    '      ''สำนักงานกลุ่มงานเทคนิคการแพทย์'',' || line_break ||
    '      ''งานเคมีคลินิก'',' || line_break ||
    '      ''งานโลหิตวิทยาคลินิก'',' || line_break ||
    '      ''งานภูมิคุ้มกันวิทยาคลินิก'',' || line_break ||
    '      ''งานจุลทรรศนศาสตร์คลินิก'',' || line_break ||
    '      ''งานอณูชีววิทยา'',' || line_break ||
    '      ''งานจุลชีววิทยา'',' || line_break ||
    '      ''งานคลังเลือด'',' || line_break ||
    '      ''งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ'',' || line_break ||
    '      ''งานบริการผู้ป่วยนอก'',' || line_break ||
    '      ''ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี''' || line_break ||
    '    )';

  new_block := '    or parsed_department not in (' || line_break ||
    '      ''สำนักงานกลุ่มงานเทคนิคการแพทย์'',' || line_break ||
    '      ''งานเคมีคลินิก'',' || line_break ||
    '      ''งานโลหิตวิทยาคลินิก'',' || line_break ||
    '      ''งานภูมิคุ้มกันวิทยาคลินิก'',' || line_break ||
    '      ''งานจุลทรรศนศาสตร์คลินิก'',' || line_break ||
    '      ''งานอณูชีววิทยา'',' || line_break ||
    '      ''งานจุลชีววิทยา'',' || line_break ||
    '      ''งานคลังเลือด'',' || line_break ||
    '      ''งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ'',' || line_break ||
    '      ''งานบริการผู้ป่วยนอก'',' || line_break ||
    '      ''ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี'',' || line_break ||
    '      ''คลังน้ำยาและวัสดุวิทยาศาสตร์'',' || line_break ||
    '      ''POCT''' || line_break ||
    '    )';

  select pg_get_functiondef(p.oid)
    into function_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'update_contract';

  if function_sql is null then
    raise exception 'public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz) was not found';
  end if;

  if position(old_block in function_sql) = 0 then
    -- pg_get_functiondef normally preserves the deployed CRLF style, but
    -- accept LF-only definitions as well.
    line_break := chr(10);
    old_block := replace(old_block, chr(13) || chr(10), line_break);
    new_block := replace(new_block, chr(13) || chr(10), line_break);
  end if;

  if position(old_block in function_sql) = 0 then
    if position('''POCT''' in function_sql) = 0 then
      raise exception 'update_contract department allowlist has an unexpected shape';
    end if;
  else
    execute replace(function_sql, old_block, new_block);
  end if;
end
$migration$;

revoke execute on function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz)
  to service_role;

commit;
