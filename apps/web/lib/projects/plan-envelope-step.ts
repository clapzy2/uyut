import type { PlanPageVertexProof } from '@uyut/db'
import type { PagePoint } from './plan-pdf-linework'

/** Снятие уступа: три подряд идущих угла кольца заменяются одним новым углом. */
export type EnvelopeStepCollapse = {
  corner: PagePoint
  /** Номера заменяемых углов кольца, по порядку обхода. */
  replaces: [number, number, number]
}

/**
 * Варианты снять короткую ступеньку кольца, не выдумывая точку.
 *
 * Ступенька - это короткое ребро a-b, к которому с обеих сторон примыкают параллельные
 * рёбра p-a и b-q. Её можно снять двумя способами: дотянуть предыдущий участок до линии
 * следующего (новый угол на месте p, сдвинутый вдоль ступеньки) или наоборот. Новый угол
 * собирается из уже существующих координат без вычислений, и вариант предлагается,
 * только если этот угол - исходный узел PDF. Если оба варианта невозможны, ступенька
 * остаётся ручной правкой. Поддерживаются лишь ступеньки по осям листа.
 */
export function envelopeStepCollapses(
  polygon: readonly PagePoint[],
  vertexProofs: readonly PlanPageVertexProof[],
  index: number,
  nodes: ReadonlySet<string>,
): EnvelopeStepCollapse[] {
  const n = polygon.length
  if (n < 5) return []
  const at = (k: number) => polygon[(((k % n) + n) % n) as number] as PagePoint
  const wrap = (k: number) => ((k % n) + n) % n
  const p = at(index - 1),
    a = at(index),
    b = at(index + 1),
    q = at(index + 2)
  const vertical = a.x === b.x && a.y !== b.y
  const horizontal = a.y === b.y && a.x !== b.x
  if (!vertical && !horizontal) return []
  // Примыкающие рёбра должны идти поперёк ступеньки, иначе это не ступенька.
  const across = (from: PagePoint, to: PagePoint) =>
    vertical ? from.y === to.y && from.x !== to.x : from.x === to.x && from.y !== to.y
  if (!across(p, a) || !across(b, q)) return []
  const options: EnvelopeStepCollapse[] = [
    {
      // Предыдущий участок переносится на линию следующего.
      corner: vertical ? { x: p.x, y: b.y } : { x: b.x, y: p.y },
      replaces: [wrap(index - 1), wrap(index), wrap(index + 1)],
    },
    {
      // Следующий участок переносится на линию предыдущего.
      corner: vertical ? { x: q.x, y: a.y } : { x: a.x, y: q.y },
      replaces: [wrap(index), wrap(index + 1), wrap(index + 2)],
    },
  ]
  return options.filter((option) => {
    if (!nodes.has(`${option.corner.x}:${option.corner.y}`)) return false
    const result = collapseEnvelopeStep(polygon, vertexProofs, option).polygon
    // Новый угол не должен совпасть с уже существующим: это была бы петля, а не правка.
    return (
      result.length >= 3 &&
      new Set(result.map((point) => `${point.x}:${point.y}`)).size === result.length
    )
  })
}

/**
 * Применяет снятие уступа: заменяет три угла одним и переносит доказательства вершин.
 * Обход кольца начинается с нового угла, остальные углы и их доказательства сохраняются.
 */
export function collapseEnvelopeStep(
  polygon: readonly PagePoint[],
  vertexProofs: readonly PlanPageVertexProof[],
  collapse: EnvelopeStepCollapse,
): { polygon: PagePoint[]; vertexProofs: PlanPageVertexProof[] } {
  const n = polygon.length
  const replaced = new Set(collapse.replaces)
  const after = (collapse.replaces[2] + 1) % n
  const kept: number[] = []
  for (let step = 0; step < n; step++) {
    const index = (after + step) % n
    if (!replaced.has(index)) kept.push(index)
  }
  const nextIndex = new Map(kept.map((oldIndex, position) => [oldIndex, position + 1]))
  return {
    polygon: [
      { x: collapse.corner.x, y: collapse.corner.y },
      ...kept.map((index) => ({ ...(polygon[index] as PagePoint) })),
    ],
    vertexProofs: vertexProofs.flatMap((proof) => {
      const moved = nextIndex.get(proof.vertexIndex)
      return moved === undefined ? [] : [{ ...structuredClone(proof), vertexIndex: moved }]
    }),
  }
}
