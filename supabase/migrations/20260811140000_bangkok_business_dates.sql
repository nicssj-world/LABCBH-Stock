begin;

-- PostgreSQL's current_date follows the session TimeZone. Keep existing RPC
-- bodies correct without rewriting every historical function: these function
-- settings make current_date use the Bangkok business calendar for the whole
-- invocation and are restored automatically afterwards.
alter function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date)
  set timezone = 'Asia/Bangkok';
alter function public.record_contract_expense(uuid, bigint, numeric, date, date, text)
  set timezone = 'Asia/Bangkok';
alter function public.apply_lab_stock_import(jsonb, jsonb, text, uuid)
  set timezone = 'Asia/Bangkok';
alter function public.fulfill_requisition(uuid, uuid, jsonb)
  set timezone = 'Asia/Bangkok';

-- Direct service-role inserts that rely on the column default must use the same
-- calendar as the RPCs too.
alter table public.stock_movements
  alter column occurred_on set default public.lab_stock_today();

commit;
