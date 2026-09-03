import sharp from 'sharp'

/**
 * Elegir la foto correcta es crítico: los generadores imagen→3D reconstruyen
 * TODO lo que sale en la foto. Un bodegón (silla + mesa + jarrón) produce un
 * modelo contaminado; el packshot (producto solo sobre fondo neutro) produce
 * el mueble limpio.
 *
 * Heurística en dos partes:
 *  - borde claro y uniforme (fondo de estudio): brillo − 2×desviación
 *  - y OBJETO en el centro: sin contraste centro-borde, la foto es una
 *    muestra de material o un fondo vacío (así se coló la "loncha de cuero"
 *    de la silla Dravena) y se penaliza fuerte.
 */
export async function packshotScore(imageBytes: Uint8Array): Promise<number> {
  const SIZE = 64
  const MARGIN = 4
  const { data, info } = await sharp(imageBytes)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const border: number[] = []
  const center: number[] = []
  const CENTER_LO = 20
  const CENTER_HI = 44
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * info.channels
      const luma = (data[i]! + data[i + 1]! + data[i + 2]!) / 3
      if (x < MARGIN || x >= SIZE - MARGIN || y < MARGIN || y >= SIZE - MARGIN) {
        border.push(luma)
      } else if (x >= CENTER_LO && x < CENTER_HI && y >= CENTER_LO && y < CENTER_HI) {
        center.push(luma)
      }
    }
  }
  const stats = (px: number[]) => {
    const mean = px.reduce((a, b) => a + b, 0) / px.length
    const sd = Math.sqrt(px.reduce((a, b) => a + (b - mean) ** 2, 0) / px.length)
    return { mean, sd }
  }
  const b = stats(border)
  const c = stats(center)

  const cleanBackground = b.mean - 2 * b.sd
  // Evidencia de objeto: el centro varía y/o difiere del fondo.
  const objectEvidence = c.sd + Math.abs(c.mean - b.mean)
  const swatchPenalty = objectEvidence < 25 ? 150 : 0
  return cleanBackground + Math.min(objectEvidence, 80) - swatchPenalty
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
