import type { PlanPoint } from '@uyut/db'
import type { MultiPolygon } from 'polygon-clipping'
import type { inspectSourceClearanceRoutes } from './plan-source-clearance-route'

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  )
}

/** Diagnostic drawing only; route points and floor use the same metric coordinate frame. */
export function renderSourceRoutePreview(input: {
  freeFloor: MultiPolygon
  rooms: Array<{ id: string; name: string; polygon: PlanPoint[] }>
  result: ReturnType<typeof inspectSourceClearanceRoutes>
  start: PlanPoint
}) {
  const points = input.rooms.flatMap((room) => room.polygon)
  if (!points.length) throw new Error('Нет комнат для отображения')
  const minX = Math.min(...points.map((point) => point.xCm)) - 50
  const minY = Math.min(...points.map((point) => point.yCm)) - 130
  const width = Math.max(...points.map((point) => point.xCm)) - minX + 50
  const height = Math.max(...points.map((point) => point.yCm)) - minY + 50
  const floor = input.freeFloor
    .map((body) =>
      body.map((ring) => `M ${ring.map(([x, y]) => `${x},${y}`).join(' L ')} Z`).join(' '),
    )
    .join(' ')
  const rooms = input.rooms
    .map((room) => {
      const unresolved = input.result.unresolvedRoomIds.includes(room.id)
      const x = room.polygon.reduce((sum, point) => sum + point.xCm, 0) / room.polygon.length
      const y = room.polygon.reduce((sum, point) => sum + point.yCm, 0) / room.polygon.length
      return `<polygon points="${room.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')}" fill="none" stroke="${unresolved ? '#a55d16' : '#858077'}" stroke-width="2" ${unresolved ? 'stroke-dasharray="8 6"' : ''}/><text x="${x}" y="${y}" text-anchor="middle" font-size="18" fill="#302d28">${escapeXml(room.name)}${unresolved ? `<tspan x="${x}" dy="22" font-size="14">путь не подтверждён</tspan>` : ''}</text>`
    })
    .join('\n')
  const routes = input.result.routes
    .map(
      (route) =>
        `<polyline data-room-id="${escapeXml(route.roomId)}" points="${route.points.map((point) => `${point.xCm},${point.yCm}`).join(' ')}" fill="none" stroke="#247752" stroke-width="6" stroke-linejoin="round"/>`,
    )
    .join('\n')
  const half = input.result.widthCm / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-labelledby="route-title route-description" font-family="Arial, sans-serif">
<title id="route-title">Домица: локальная проверка проходов ${input.result.widthCm} см</title>
<desc id="route-description">Зелёные линии — найденные маршруты квадратной зоны. Янтарные контуры — путь не подтверждён. Старт внутри входной зоны. Это не проверка внешнего входа и не проект ремонта.</desc>
<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#faf7f0"/>
<text x="${minX + 30}" y="${minY + 36}" font-size="24" fill="#302d28">Домица · проверка проходов ${input.result.widthCm} см</text>
<text x="${minX + 30}" y="${minY + 66}" font-size="17" fill="#625b50">Зелёный — найденный путь. Янтарный — путь не подтверждён.</text>
<text x="${minX + 30}" y="${minY + 92}" font-size="15" fill="#625b50">Локальная модель Swiss · старт внутри входной зоны · без мебели и зон открывания</text>
<path d="${floor}" fill="#e8e2d7" fill-rule="evenodd" stroke="#625b50" stroke-width="2"/>
${routes}
${rooms}
<rect x="${input.start.xCm - half}" y="${input.start.yCm - half}" width="${input.result.widthCm}" height="${input.result.widthCm}" fill="none" stroke="#174f37" stroke-width="3" stroke-dasharray="5 4"/>
<circle cx="${input.start.xCm}" cy="${input.start.yCm}" r="7" fill="#174f37"/>
</svg>`
}
