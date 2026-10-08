-- Lista de QA, item 22: aviso de Pix vencendo. Uma vez por pedido, quando faltam 12 h
-- ou menos para o prazo e o comprador ainda não enviou o comprovante.
-- Os demais avisos (frete/Pix liberado, pagamento confirmado ou recusado, lote fechado,
-- cartão amarelo, bloqueio, desbloqueio e envio) já são gravados pelas funções.
create or replace function public.app_remind_due_payments()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  o record;
  n int := 0;
begin
  for o in
    select id, user_id, total_cents, due_at from public.orders
     where status = 'awaiting_payment' and due_at > clock_timestamp() and due_at <= clock_timestamp() + interval '12 hours'
       and not exists (select 1 from public.notifications x
                        where x.user_id = orders.user_id and x.kind = 'payment_due_soon' and x.data ->> 'order_id' = orders.id::text)
  loop
    perform public.app_notify(o.user_id, 'payment_due_soon', 'Seu Pix vence em breve',
      'Pague ' || public.app_brl(o.total_cents) || ' até ' || to_char(o.due_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
        || ' para não levar cartão amarelo.',
      jsonb_build_object('order_id', o.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.app_remind_due_payments() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule com nome já existente só atualiza o agendamento
    perform cron.schedule('remind-due-payments', '*/10 * * * *', 'select public.app_remind_due_payments()');
  end if;
end $$;
