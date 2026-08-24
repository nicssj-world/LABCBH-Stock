begin;

alter table public.profiles
  add column if not exists name_prefix text;

do $function$
begin
  alter table public.profiles
    add constraint profiles_name_prefix_check
    check (name_prefix is null or name_prefix in ('นาย', 'น.ส.', 'นาง'));
exception when duplicate_object then
  null;
end
$function$;

commit;
