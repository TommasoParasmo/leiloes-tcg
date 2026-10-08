"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Ao abrir a lista, marca como lidos só os avisos que apareceram nela (os pontos somem na
 * próxima visita). Um aviso que chegou depois de a página carregar continua novo.
 */
export function MarkRead({ ids }: { ids: string[] }) {
  const [sb] = useState(createClient);
  const key = ids.join(",");
  useEffect(() => {
    void sb.from("notifications").update({ read_at: new Date().toISOString() }).in("id", key.split(",")).is("read_at", null);
  }, [sb, key]);
  return null;
}
