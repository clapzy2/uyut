import type { NativeTextAnchors } from './plan-document'
import { nativeDoorSymbolCandidates } from './plan-native-door-symbols'
import { exactNativeOrientation } from './plan-native-exact-intersections'
import { nativeOpeningFrameCandidates } from './plan-native-opening-frames'
import type { NativePanelSymbol } from './plan-native-panel-symbols'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

type SourceProfile = {
  id: string
  path: PdfVectorPath
  aliases: PdfVectorPath[]
  edges: NativePageSegment[]
}
type Contact = {
  profileId: string
  capEdge: NativePageSegment
  profileEdge: NativePageSegment
  start: PagePoint
  end: PagePoint
}
type GlazingEnd = {
  side: 'before' | 'after'
  status: 'matched' | 'ambiguous' | 'unresolved'
  profileId: string | null
  contacts: Contact[]
}
export type NativeGlazingLink = {
  symbolId: string
  axis: 'x' | 'y'
  status: 'two-sided' | 'ambiguous' | 'unresolved'
  ends: [GlazingEnd, GlazingEnd]
}
export type NativeDoorLink = {
  symbolId: string
  status: 'linked' | 'ambiguous' | 'unresolved'
  targetKind: 'opening-frame' | 'glazing-panel' | null
  targetId: string | null
  relation: 'jamb-to-frame' | 'shared-cap-edge' | null
  evidence: NativePageSegment[]
}
export type NativeSourceSymbolGroup = {
  id: string
  glazingIds: string[]
  doorIds: string[]
  bridges: NativePageSegment[]
}

const MAX_WORK = 200_000
const MAX_CONTACTS = 50
const samePoint = (a: PagePoint, b: PagePoint) => a.x === b.x && a.y === b.y
const pathKey = (path: Pick<PdfVectorPath, 'operationIndex' | 'subpathIndex'>) =>
  `${path.operationIndex}:${path.subpathIndex}`
const glazingId = (panel: NativePanelSymbol) => `native-glazing-symbol-${pathKey(panel.body)}`
function edges(path: PdfVectorPath): NativePageSegment[] {
  const first = path.points[0],
    last = path.points.at(-1)
  const points = first && last && samePoint(first, last) ? path.points.slice(0, -1) : path.points
  return points.map((start, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start,
    end: points[(segmentIndex + 1) % points.length] as PagePoint,
  }))
}
function onEdge(point: PagePoint, edge: Pick<NativePageSegment, 'start' | 'end'>) {
  return (
    point.x >= Math.min(edge.start.x, edge.end.x) &&
    point.x <= Math.max(edge.start.x, edge.end.x) &&
    point.y >= Math.min(edge.start.y, edge.end.y) &&
    point.y <= Math.max(edge.start.y, edge.end.y) &&
    exactNativeOrientation(edge.start, edge.end, point) === 0
  )
}
function sharedSegment(a: NativePageSegment, b: NativePageSegment) {
  if (
    exactNativeOrientation(a.start, a.end, b.start) !== 0 ||
    exactNativeOrientation(a.start, a.end, b.end) !== 0
  )
    return null
  const axis = a.start.x === a.end.x ? 'y' : 'x'
  const lowA = a.start[axis] < a.end[axis] ? a.start : a.end
  const highA = a.start[axis] < a.end[axis] ? a.end : a.start
  const lowB = b.start[axis] < b.end[axis] ? b.start : b.end
  const highB = b.start[axis] < b.end[axis] ? b.end : b.start
  const start = lowA[axis] > lowB[axis] ? lowA : lowB
  const end = highA[axis] < highB[axis] ? highA : highB
  return start[axis] < end[axis] ? { start, end } : null
}
function sameEdge(a: NativePageSegment, b: NativePageSegment) {
  return (
    (samePoint(a.start, b.start) && samePoint(a.end, b.end)) ||
    (samePoint(a.start, b.end) && samePoint(a.end, b.start))
  )
}
function polygonKey(path: PdfVectorPath) {
  const points = edges(path).map((edge) => `${edge.start.x}:${edge.start.y}`)
  // Exact repeated-paint aliases only; do not simplify, merge or edit source vertices.
  let first = 0
  for (let index = 1; index < points.length; index++)
    if ((points[index] as string) < (points[first] as string)) first = index
  const forward = [...points.slice(first), ...points.slice(0, first)].join(';')
  const backward = points
    .map((_, index) => points[(first - index + points.length) % points.length])
    .join(';')
  return forward < backward ? forward : backward
}

/** Painted symbol connections only, not wall/room ownership, complete openings or a free floor. */
export function nativeOpeningSourceLinks(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const doors = nativeDoorSymbolCandidates(input)
  const frames = nativeOpeningFrameCandidates(input)
  const panels = doors.compoundPanels
  const doorLinks: NativeDoorLink[] = []
  const glazingLinks: NativeGlazingLink[] = []
  const groups: NativeSourceSymbolGroup[] = []
  const profiles: SourceProfile[] = []
  const finish = (reason: string | null) => ({
    status: reason ? ('unresolved' as const) : ('draft' as const),
    basis: 'native-painted-symbol-connections' as const,
    source: { ...input.native.source },
    originalPdfSha256: input.native.originalPdfSha256,
    doorSymbols: doors,
    openingFrames: frames,
    doorLinks: reason ? [] : structuredClone(doorLinks),
    glazingLinks: reason ? [] : structuredClone(glazingLinks),
    groups: reason ? [] : structuredClone(groups),
    profiles: reason ? [] : structuredClone(profiles),
    refusalReason: reason,
    completeOpeningInventory: false as const,
    roomOwnershipConfirmed: false as const,
    physicalPassagesAccepted: false as const,
    closesFloorBoundary: false as const,
  })
  if (doors.refusalReason || frames.refusalReason || panels.refusalReason)
    return finish('opening-candidates-unavailable')
  const scale = input.native.pageNormalizedScale
  if (!scale) return finish('source-frame-unavailable')
  let work = 0
  const spend = () => ++work <= MAX_WORK
  const counts = new Map<number, number>()
  for (const path of input.work.paths)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  const omitted = new Set(
    [...(input.work.skippedCurveBounds ?? []), ...(input.work.clippedPathBounds ?? [])].map(
      (item) => item.operationIndex,
    ),
  )
  const profileKeys = new Map<string, SourceProfile>()
  for (const path of input.work.paths) {
    if (!spend()) return finish('source-link-work-limit')
    if (
      path.paint !== 'stroke' ||
      !path.closed ||
      counts.get(path.operationIndex) !== 1 ||
      omitted.has(path.operationIndex)
    )
      continue
    const segments = edges(path)
    if (
      segments.length < 6 ||
      segments.length > 100 ||
      segments.some(
        (edge) =>
          samePoint(edge.start, edge.end) ||
          (edge.start.x !== edge.end.x && edge.start.y !== edge.end.y),
      ) ||
      !pdfPolygonIsValid(segments.map((edge) => edge.start))
    )
      continue
    const key = polygonKey(path)
    const alias = profileKeys.get(key)
    if (alias) alias.aliases.push(path)
    else {
      const profile = {
        id: `native-source-profile-${pathKey(path)}`,
        path,
        aliases: [],
        edges: segments,
      }
      profiles.push(profile)
      profileKeys.set(key, profile)
    }
  }
  const glazed = panels.panels.filter((panel) => panel.centerlineStatus === 'matched')
  for (const panel of glazed) {
    const width =
      (Math.max(...panel.body.points.map((p) => p.x)) -
        Math.min(...panel.body.points.map((p) => p.x))) *
      scale.x
    const height =
      (Math.max(...panel.body.points.map((p) => p.y)) -
        Math.min(...panel.body.points.map((p) => p.y))) *
      scale.y
    const axis = width > height ? 'x' : 'y'
    const ends: GlazingEnd[] = []
    for (const [index, cap] of panel.caps.entries()) {
      const coordinate =
        index === 0
          ? Math.min(...cap.points.map((p) => p[axis]))
          : Math.max(...cap.points.map((p) => p[axis]))
      const capEdge = edges(cap).find(
        (edge) => edge.start[axis] === coordinate && edge.end[axis] === coordinate,
      )
      if (!capEdge) return finish('invalid-source-cap-edge')
      const contacts: Contact[] = []
      for (const profile of profiles)
        for (const profileEdge of profile.edges) {
          if (!spend()) return finish('source-link-work-limit')
          const span = sharedSegment(capEdge, profileEdge)
          if (!span) continue
          if (contacts.length === MAX_CONTACTS) return finish('source-contact-limit')
          contacts.push({ profileId: profile.id, capEdge, profileEdge, ...span })
        }
      const owners = new Set(contacts.map((contact) => contact.profileId))
      ends.push({
        side: index === 0 ? 'before' : 'after',
        status: owners.size === 1 ? 'matched' : owners.size > 1 ? 'ambiguous' : 'unresolved',
        profileId: owners.size === 1 ? ([...owners][0] as string) : null,
        contacts,
      })
    }
    if (!ends[0] || !ends[1]) return finish('invalid-source-cap-edge')
    glazingLinks.push({
      symbolId: glazingId(panel),
      axis,
      ends: [ends[0], ends[1]],
      status: ends.every((end) => end.status === 'matched')
        ? 'two-sided'
        : ends.some((end) => end.status === 'ambiguous')
          ? 'ambiguous'
          : 'unresolved',
    })
  }
  for (const door of doors.candidates) {
    const targets = new Map<string, Omit<NativeDoorLink, 'symbolId' | 'status'>>()
    for (const frame of frames.candidates)
      for (const edge of frame.longEdges) {
        if (!spend()) return finish('source-link-work-limit')
        if (
          !onEdge(door.hinge, edge) ||
          samePoint(door.hinge, edge.start) ||
          samePoint(door.hinge, edge.end)
        )
          continue
        const jambKeys = new Set(frame.jambs.flatMap((jamb) => jamb.sourceEdges.map(pathKey)))
        for (const path of input.work.paths) {
          if (!spend()) return finish('source-link-work-limit')
          if (!jambKeys.has(pathKey(path))) continue
          for (const connector of edges(path)) {
            if (!spend()) return finish('source-link-work-limit')
            if (!samePoint(door.hinge, connector.start) && !samePoint(door.hinge, connector.end))
              continue
            if (
              !samePoint(connector.start, edge.start) &&
              !samePoint(connector.start, edge.end) &&
              !samePoint(connector.end, edge.start) &&
              !samePoint(connector.end, edge.end)
            )
              continue
            if (!onEdge(connector.start, edge) || !onEdge(connector.end, edge)) continue
            targets.set(`frame:${frame.id}`, {
              targetKind: 'opening-frame',
              targetId: frame.id,
              relation: 'jamb-to-frame',
              evidence: [edge, connector],
            })
          }
        }
      }
    if (door.leafProfile === 'capped-panel') {
      const leafPanel = panels.panels.find((panel) => pathKey(panel.body) === pathKey(door.leaf))
      if (!leafPanel) return finish('source-leaf-panel-unavailable')
      for (const panel of glazed)
        for (const leafCap of leafPanel.caps)
          for (const leafEdge of edges(leafCap)) {
            if (!samePoint(door.hinge, leafEdge.start) && !samePoint(door.hinge, leafEdge.end))
              continue
            for (const cap of panel.caps)
              for (const capEdge of edges(cap)) {
                if (!spend()) return finish('source-link-work-limit')
                if (!sameEdge(leafEdge, capEdge)) continue
                targets.set(`glazing:${glazingId(panel)}`, {
                  targetKind: 'glazing-panel',
                  targetId: glazingId(panel),
                  relation: 'shared-cap-edge',
                  evidence: [leafEdge, capEdge],
                })
              }
          }
    }
    const target = targets.size === 1 ? [...targets.values()][0] : undefined
    doorLinks.push(
      target
        ? { symbolId: door.id, status: 'linked', ...target }
        : {
            symbolId: door.id,
            status: targets.size > 1 ? 'ambiguous' : 'unresolved',
            targetKind: null,
            targetId: null,
            relation: null,
            evidence: [],
          },
    )
  }
  const connected = new Map(glazingLinks.map((link) => [link.symbolId, new Set<string>()]))
  const bridges: { first: string; second: string; edge: NativePageSegment }[] = []
  for (const [index, first] of glazingLinks.entries()) {
    if (first.status !== 'two-sided') continue
    for (const second of glazingLinks.slice(index + 1)) {
      if (second.status !== 'two-sided' || first.axis !== second.axis) continue
      for (const a of first.ends)
        for (const b of second.ends) {
          if (!spend()) return finish('source-link-work-limit')
          if (a.side === b.side || !a.profileId || a.profileId !== b.profileId) continue
          const profile = profiles.find((profile) => profile.id === a.profileId)
          if (!profile) return finish('source-contact-profile-unavailable')
          for (const bridge of profile.edges) {
            if (!spend()) return finish('source-link-work-limit')
            if (bridge.start[first.axis] === bridge.end[first.axis]) continue
            const supports = (contact: Contact, point: PagePoint) =>
              onEdge(point, contact) &&
              (samePoint(point, contact.profileEdge.start) ||
                samePoint(point, contact.profileEdge.end))
            if (
              !(
                a.contacts.some((contact) => supports(contact, bridge.start)) &&
                b.contacts.some((contact) => supports(contact, bridge.end))
              ) &&
              !(
                a.contacts.some((contact) => supports(contact, bridge.end)) &&
                b.contacts.some((contact) => supports(contact, bridge.start))
              )
            )
              continue
            connected.get(first.symbolId)?.add(second.symbolId)
            connected.get(second.symbolId)?.add(first.symbolId)
            bridges.push({ first: first.symbolId, second: second.symbolId, edge: bridge })
          }
        }
    }
  }
  const visited = new Set<string>()
  for (const id of [...connected.keys()].sort()) {
    if (visited.has(id)) continue
    const queue = [id],
      members: string[] = []
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]
      if (!current || visited.has(current)) continue
      visited.add(current)
      members.push(current)
      queue.push(...(connected.get(current) ?? []))
    }
    if (members.length < 2) continue
    const memberSet = new Set(members)
    groups.push({
      id: `native-source-symbol-group-${groups.length + 1}`,
      glazingIds: members.sort(),
      doorIds: doorLinks
        .filter(
          (link) =>
            link.status === 'linked' &&
            link.targetKind === 'glazing-panel' &&
            link.targetId &&
            memberSet.has(link.targetId),
        )
        .map((link) => link.symbolId),
      bridges: bridges
        .filter((bridge) => memberSet.has(bridge.first) && memberSet.has(bridge.second))
        .map((bridge) => bridge.edge),
    })
  }
  return finish(null)
}
