import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { quoteShipping, SuperfreteError } from "@/lib/superfrete";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cotação do SuperFrete para um pedido (só o leiloeiro). O banco confere a permissão e
 * devolve os CEPs; o token do SuperFrete nunca sai do servidor. O valor escolhido é
 * gravado depois por admin_quote_shipping, como na cotação manual.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" && UUID.test(body.orderId) ? body.orderId : null;
  if (!orderId) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });

  const sb = await createClient();
  const { data, error } = await sb.rpc("admin_shipping_quote_input", { p_order_id: orderId });
  if (error) return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  const input = data as { ok: boolean; code: string; from_cep: string | null; to_cep: string | null; cards: number };
  if (!input.ok) return NextResponse.json(input, { status: input.code === "forbidden" ? 403 : 404 });
  if (!input.from_cep) return NextResponse.json({ ok: false, code: "origin_required" });
  if (!input.to_cep) return NextResponse.json({ ok: false, code: "address_required" });

  try {
    const options = await quoteShipping(input.from_cep, input.to_cep, input.cards);
    return NextResponse.json({ ok: true, code: "quoted", options });
  } catch (e) {
    const reason = e instanceof SuperfreteError ? e.reason : "unavailable";
    return NextResponse.json({ ok: false, code: `superfrete_${reason}` });
  }
}
