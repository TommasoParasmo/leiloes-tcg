import { describe, expect, it } from "vitest";
import { applyChatEvent, CHAT_KEEP, mergeChat, type ChatMessage } from "./chat";

const msg = (id: string, at: string, body = id): ChatMessage => ({ id, nickname: "Tom", body, is_admin: false, created_at: at });

describe("chat da sala", () => {
  it("junta sem repetir e mantém a ordem de envio", () => {
    const a = msg("a", "2026-10-08T20:00:01Z");
    const b = msg("b", "2026-10-08T20:00:02Z");
    const c = msg("c", "2026-10-08T20:00:03Z");
    expect(mergeChat([a, c], [b, c]).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("guarda só as últimas mensagens", () => {
    const many = Array.from({ length: CHAT_KEEP + 5 }, (_, i) => msg(String(i), new Date(Date.UTC(2026, 9, 8, 20, 0, i)).toISOString()));
    const out = mergeChat([], many);
    expect(out).toHaveLength(CHAT_KEEP);
    expect(out[0].id).toBe("5");
  });

  it("mensagem escondida pelo leiloeiro some da tela", () => {
    const list = [msg("a", "2026-10-08T20:00:01Z"), msg("b", "2026-10-08T20:00:02Z")];
    expect(applyChatEvent(list, { type: "hide", id: "a" }).map((m) => m.id)).toEqual(["b"]);
  });
});
