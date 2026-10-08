// Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central) com valor fixo.

function field(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos; corta no limite. */
function clean(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-]/g, "")
    .trim()
    .toUpperCase()
    .slice(0, max);
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no fim do BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const ch of new TextEncoder().encode(payload)) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function pixCopyPaste({ key, name, city, amountCents, txid }: { key: string; name: string; city: string; amountCents: number; txid?: string }): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Valor do Pix inválido");
  const account = field("00", "br.gov.bcb.pix") + field("01", key.trim());
  const reference = clean(txid ?? "***", 25).replace(/[^A-Z0-9]/g, "") || "***";
  const body =
    field("00", "01") +
    field("26", account) +
    field("52", "0000") +
    field("53", "986") +
    field("54", (amountCents / 100).toFixed(2)) +
    field("58", "BR") +
    field("59", clean(name, 25) || "RECEBEDOR") +
    field("60", clean(city, 15) || "BRASIL") +
    field("62", field("05", reference)) +
    "6304";
  return body + crc16(body);
}
