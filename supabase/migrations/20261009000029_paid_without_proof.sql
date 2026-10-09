-- "Já paguei" (pedido do Tom: comprador simplificado). O comprador avisa que pagou sem
-- precisar anexar o comprovante; o pedido vai para "comprovante enviado" e o leiloeiro
-- confere no banco antes de tocar em "Recebi o Pix". Anexar continua possível.
create or replace function public.submit_payment_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.user_id <> auth.uid() then return jsonb_build_object('ok', false, 'code', 'order_not_found'); end if;
  if o.status not in ('awaiting_payment', 'proof_sent') then return jsonb_build_object('ok', false, 'code', 'order_wrong_status'); end if;
  if p_proof_path is not null and p_proof_path not like auth.uid()::text || '/' || o.id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  -- sem arquivo novo, um comprovante já enviado continua valendo
  update public.payments set status = 'proof_sent', proof_path = coalesce(p_proof_path, proof_path), proof_sent_at = clock_timestamp()
   where order_id = o.id and status in ('pending', 'proof_sent');
  update public.orders set status = 'proof_sent' where id = o.id;
  perform public.app_audit(o.seller_id, 'payment.proof', 'order', o.id, jsonb_build_object('file', p_proof_path is not null));
  return jsonb_build_object('ok', true, 'code', 'proof_sent');
end;
$$;

revoke execute on function public.submit_payment_proof(uuid, text) from public, anon;
grant execute on function public.submit_payment_proof(uuid, text) to authenticated;
