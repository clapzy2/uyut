import { describe, expect, it } from 'vitest'
import labels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import { snapPageContourPoint } from '../../components/plan-page-contour-editor-model'
import { pdfDepthChain, pdfWidthChain } from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfRoomContours } from './plan-pdf-room-binding'

const contours = annotated as PdfRoomContours
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 842,
  pageHeight: 1191,
  paths: annotated.dimensionPaths as PdfVectorPath[],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}

describe('editor native vertex acceptance into dimension verification', () => {
  it.each(['width', 'depth'] as const)(
    'preserves the exact printed %s chain after a slightly imprecise user click',
    (axis) => {
      const room = annotated.rooms.find((candidate) => candidate.roomSourceNumber === 4)
      if (!room) throw new Error('Missing bedroom fixture')
      // These reviewed native wall corners reproduce the points returned by the private preview.
      // This is an interaction regression, not a new AI recognition measurement.
      const nativePoints = room.polygon
      const clicked = nativePoints.map((point) => ({ x: point.x + 0.8, y: point.y - 0.5 }))
      const accepted = clicked.map((point) => {
        const proposal = snapPageContourPoint(point, nativePoints, { width: 842, height: 1191 })
        expect(proposal.kind).toBe('candidate')
        if (proposal.kind !== 'candidate') throw new Error('No unique native vertex')
        return proposal.point
      })
      expect(accepted).toEqual(nativePoints)
      const selectedLabels = (axis === 'width' ? room.widthLabels : room.depthLabels).map(
        (index) => {
          const label = labels.items.find((item) => item.index === index)
          if (!label) throw new Error('Missing native label')
          return label
        },
      )
      const chain = axis === 'width' ? pdfWidthChain : pdfDepthChain
      const total = axis === 'width' ? room.widthMm : room.depthMm
      const drafted = {
        ...contours,
        rooms: contours.rooms.map((candidate) =>
          candidate.roomSourceNumber === 4 ? { ...candidate, polygon: clicked } : candidate,
        ),
      }
      expect(chain(work, contours.source, drafted, 4, selectedLabels, total).status).not.toBe(
        'candidate',
      )
      const reviewed = {
        ...drafted,
        rooms: drafted.rooms.map((candidate) =>
          candidate.roomSourceNumber === 4 ? { ...candidate, polygon: accepted } : candidate,
        ),
      }
      expect(chain(work, contours.source, reviewed, 4, selectedLabels, total)).toMatchObject({
        status: 'candidate',
        totalMm: total,
        roomSourceNumber: 4,
      })
    },
  )
})
