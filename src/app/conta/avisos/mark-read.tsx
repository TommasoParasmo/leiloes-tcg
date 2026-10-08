"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Ao abrir a lista, marca os avisos como lidos (os pontos somem na próxima visita). */
export function MarkRead() {
  const [sb] = useState(createClient);
  useEffect(() => {
    void sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  }, [sb]);
  return null;
}
