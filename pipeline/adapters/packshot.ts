import sharp from 'sharp'

/**
 * Elegir la foto correcta es crítico: los generadores imagen→3D reconstruyen
 * TODO lo que sale en la foto. Un bodegón (silla + mesa + jarrón) produce un
 * modelo contaminado; el packshot (producto solo sobre fondo neutro) produce
 * el mueble limpio.
 *
 * Heurística: en un packshot el borde de la imagen es claro y uniforme.
 * score = brillo_medio_del_borde − 2 × desviación_típica_del_borde.
 */
export async function packshotScore(imageBytes: Uint8Array): Promise<number> {
  const SIZE = 64
  const MARGIN = 4
  const { data, info } = await sharp(imageBytes)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const border: number[] = []
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= MARGIN && x < SIZE - MARGIN && y >= MARGIN && y < SIZE - MARGIN) continue
      const i = (y * SIZE + x) * info.channels
      border.push((data[i]! + data[i + 1]! + data[i + 2]!) / 3)
    }
  }
  const mean = border.reduce((a, b) => a + b, 0) / border.length
  const variance = border.reduce((a, b) => a + (b - mean) ** 2, 0) / border.length
  return mean - 2 * Math.sqrt(variance)
}

export interface PackshotPick {
  url: string
  bytes: Uint8Array
  score: number
}

/** Descarga las candidatas, las puntúa y devuelve la mejor. */
export async function pickPackshot(
  urls: readonly string[],
  fetchBytes: (url: string) => Promise<Uint8Array>,
): Promise<PackshotPick | null> {
  let best: PackshotPick | null = null
  for (const url of urls) {
    try {
      const bytes = await fetchBytes(url)
      const score = await packshotScore(bytes)
      if (!best || score > best.score) best = { url, bytes, score }
    } catch {
      // candidata inaccesible: se ignora
    }
  }
  return best
}
