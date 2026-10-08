import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AdminContext {
  sb: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  sellerId: string;
  sellerName: string;
}

/**
 * Garante que quem abre a página é admin ativo de um leiloeiro.
 * Visitante vai para o login; comprador volta para o início.
 * (A proteção de verdade está no banco: RLS e funções admin_*.)
 */
export async function requireAdmin(next: string): Promise<AdminContext> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  const { data: profile } = await sb
    .from("profiles")
    .select("role, status, admin_seller_id, sellers:admin_seller_id(name)")
    .eq("id", data.user.id)
    .maybeSingle<{ role: string; status: string; admin_seller_id: string | null; sellers: { name: string } | null }>();
  if (!profile || profile.role !== "admin" || profile.status !== "active" || !profile.admin_seller_id) redirect("/");
  return { sb, userId: data.user.id, sellerId: profile.admin_seller_id, sellerName: profile.sellers?.name ?? "" };
}
