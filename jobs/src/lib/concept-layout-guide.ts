import type { ConceptModelId } from '@uyut/ai'
import { layoutGuideSvgs, type RoomLayout } from '@uyut/catalog'
import sharp from 'sharp'

export type ConceptLayoutGuide = { referenceUrls: string[]; prompt: string }

/** The layout must come from conceptLayout's confirmed-geometry and safety gate. */
export async function prepareConceptLayoutGuide(input: {
  layout: RoomLayout | undefined
  ceilingCm: number | undefined
  modelId: ConceptModelId
  hasSourceImage: boolean
  hasBaseConcept: boolean
  hasEditSteps: boolean
  preserving: boolean
}): Promise<ConceptLayoutGuide | undefined> {
  if (
    !input.layout ||
    input.hasSourceImage ||
    input.hasBaseConcept ||
    input.hasEditSteps ||
    input.preserving ||
    !['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'nano-banana-2', 'nano-banana-pro'].includes(
      input.modelId,
    )
  ) {
    return undefined
  }
  const diagrams = layoutGuideSvgs(input.layout, input.ceilingCm)
  if (!diagrams) return undefined
  const referenceUrls = await Promise.all(
    [diagrams.perspective, diagrams.plan].map(async (svg) => {
      const png = await sharp(Buffer.from(svg)).png().toBuffer()
      return `data:image/png;base64,${png.toString('base64')}`
    }),
  )
  return {
    referenceUrls,
    prompt: [
      'The technical diagram references are a perspective furniture blockout followed by a top-down floor plan.',
      'Use them to preserve furniture count, footprints, positions and stated facing directions while making a photorealistic interior.',
      'If a photorealistic interior image is also supplied, it is the base image; the technical diagrams remain placement references only.',
      'Do not reproduce diagram labels, arrows, flat colors or box styling. Do not add furniture or infer missing dimensions from diagram shapes.',
      'The diagrams do not prove that the generated image meets measurements or safety requirements.',
    ].join(' '),
  }
}
