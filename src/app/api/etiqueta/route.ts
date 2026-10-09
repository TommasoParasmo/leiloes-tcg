import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createLabel,
  LABEL_SERVICES,
  labelInfo,
  labelIsPaid,
  printLabel,
  serviceIdFromName,
  SuperfreteError,
  type LabelInput,
  type LabelServiceId,
} from "@/lib/superfrete";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Input = LabelInput & {
  ok: boolean;
  code: string;
  service_name: string | null;
  label: { superfrete_order_id: string | null; status: string } | null;
};

function failure(e: unknown) {
  if (e instanceof SuperfreteError) return NextResponse.json({ ok: false, code: `superfrete_${e.reason}`, detail: e.detail ?? null });
  return NextResponse.json({ ok: false, code: "superfrete_unavailable", detail: null });
}

/**
 * Etiqueta do SuperFrete para um pedido pago (só o leiloeiro).
 * - action "create": manda para o carrinho do SuperFrete (o leiloeiro paga lá; o site não paga nada).
 * - action "refresh": consulta a situação; depois de paga, traz o rastreio e o link do PDF.
 * O banco confere a permissão e monta remetente e destinatário; o token nunca sai do servidor.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; action?: unknown; service?: unknown } | null;
  const orderId = typeof body?.orderId === "string" && UUID.test(body.orderId) ? body.orderId : null;
  const action = body?.action === "create" || body?.action === "refresh" ? body.action : null;
  if (!orderId || !action) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });

  const sb = await createClient();
  const { data, error } = await sb.rpc("admin_label_input", { p_order_id: orderId });
  if (error || !data) return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  const input = data as Input;
  if (!input.ok) return NextResponse.json({ ok: false, code: input.code }, { status: input.code === "forbidden" ? 403 : 200 });

  const save = async (id: string, status: string, url: string | null, tracking: string | null) => {
    const { data: r, error: e } = await sb.rpc("admin_save_label", {
      p_order_id: orderId,
      p_superfrete_order_id: id,
      p_status: status,
      p_label_url: url,
      p_tracking_code: tracking,
    });
    return !e && (r as { ok?: boolean } | null)?.ok === true;
  };

  if (action === "create") {
    const requested = LABEL_SERVICES.find((s) => s.id === body?.service)?.id;
    const service: LabelServiceId | null = requested ?? serviceIdFromName(input.service_name);
    if (!service) return NextResponse.json({ ok: false, code: "service_required" });
    // reserva o pedido no banco antes de criar lá fora: dois toques não geram duas etiquetas
    const { data: reserved, error: reserveError } = await sb.rpc("admin_reserve_label", { p_order_id: orderId });
    const reservation = reserved as { ok?: boolean; code?: string } | null;
    if (reserveError || !reservation?.ok) return NextResponse.json({ ok: false, code: reservation?.code ?? "superfrete_unavailable" });
    let label: { id: string; status: string };
    try {
      label = await createLabel(input, service);
    } catch (e) {
      await sb.rpc("admin_release_label", { p_order_id: orderId });
      return failure(e);
    }
    try {
      if (!(await save(label.id, label.status, null, null))) {
        // o envio já está no carrinho do SuperFrete; avisa para não gerar outro
        return NextResponse.json({ ok: false, code: "label_not_saved", superfreteOrderId: label.id });
      }
      return NextResponse.json({ ok: true, code: "label_created", status: label.status });
    } catch (e) {
      return failure(e);
    }
  }

  if (!input.label) return NextResponse.json({ ok: false, code: "label_missing" });
  if (!input.label.superfrete_order_id) return NextResponse.json({ ok: false, code: "label_creating" });
  const id = input.label.superfrete_order_id;
  try {
    const info = await labelInfo(id);
    const url = labelIsPaid(info.status) ? await printLabel(id) : null;
    await save(id, info.status, url, info.tracking);
    return NextResponse.json({ ok: true, code: "label_status", status: info.status, tracking: info.tracking, url });
  } catch (e) {
    return failure(e);
  }
}
