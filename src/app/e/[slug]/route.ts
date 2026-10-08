import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Link curto de divulgação do evento: /e/<slug> → sala do evento. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data } = await sb.from("events").select("id").eq("share_slug", slug).neq("status", "draft").maybeSingle<{ id: string }>();
  return NextResponse.redirect(new URL(data ? `/sala/${data.id}` : "/eventos", request.nextUrl.origin));
}
