/**
 * Relógio do servidor — regras puras.
 * O desvio (servidor − aparelho) é remedido durante o jogo, porque relógio de celular deriva
 * e pode ser trocado à mão. Medida com ida-e-volta lenta é descartada: o erro dela é grande demais.
 */
export type OffsetSample = { offset: number; rtt: number; at: number }

/** Acima disto, a mudança de desvio é sinalizada na tela. */
export const OFFSET_JUMP_MS = 2000
/** Ida-e-volta acima disto não é confiável para corrigir o relógio. */
export const MAX_RTT_MS = 4000
/** Intervalo entre remedições. */
export const REMEASURE_MS = 60000

export function applySample(previous: number | null, sample: OffsetSample): { offset: number; accepted: boolean; jumped: boolean } {
  if (previous === null) return { offset: sample.offset, accepted: true, jumped: false }
  if (sample.rtt > MAX_RTT_MS) return { offset: previous, accepted: false, jumped: false }
  return { offset: sample.offset, accepted: true, jumped: Math.abs(sample.offset - previous) > OFFSET_JUMP_MS }
}
