/**
 * Reduz a foto no próprio celular antes de subir (fotos de câmera passam de 4 MB).
 * Lado maior até 1600 px, JPEG 85%. Fica nítido para a foto ampliada e leve para a sala.
 */
export async function shrinkPhoto(file: File, maxSide = 1600): Promise<Blob> {
  // respeita a rotação gravada pela câmera do celular (EXIF); onde o navegador não decodifica
  // por createImageBitmap (alguns iPhones), usa uma <img>, que já aplica a rotação
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => decodeWithImg(file));
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível processar a foto"))), "image/jpeg", 0.85),
  );
}

/** Confere se o navegador consegue abrir a foto (evita descobrir só na hora de salvar). */
export async function canOpenPhoto(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

async function decodeWithImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // a <img> já decodificada continua desenhável depois de liberar a URL
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Rejeita se a promessa não terminar no prazo (rede de celular pode travar sem erro). */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
