-- Lance que assume a liderança nos últimos 5 s de uma rodada com cronômetro soma 10 s
-- ao fim (decisão do Tom em 08/10). Fica num gatilho da rodada para valer para qualquer
-- caminho que troque o líder, usando o relógio do servidor.
create or replace function public.app_extend_on_late_bid()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status = 'open' and new.close_mode = 'timer' and new.ends_at is not null
     and new.leading_bid_id is distinct from old.leading_bid_id
     and new.ends_at - clock_timestamp() < interval '5 seconds' then
    new.ends_at := new.ends_at + interval '10 seconds';
  end if;
  return new;
end;
$$;

revoke execute on function public.app_extend_on_late_bid() from public, anon, authenticated;

create or replace trigger rounds_extend_on_late_bid
  before update of leading_bid_id on public.rounds
  for each row execute function public.app_extend_on_late_bid();
