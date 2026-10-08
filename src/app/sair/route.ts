import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sair (POST para não ser disparado por links/prefetch). */
export async function POST(request: NextRequest) {
  const sb = await createClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
}
