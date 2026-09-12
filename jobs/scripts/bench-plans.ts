// Прогон настоящих планов из ../plans через тот же читатель, что использует сайт.
// Запуск: bun run --filter @uyut/jobs bench-plans [--file часть-имени]

import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import {
  applyRecheck,
  createFalPlanReader,
  createFalSideReader,
  estimateSides,
  markChainMismatch,
  type PlanReading,
  type PlanRoom,
} from '@uyut/ai'
import sharp from 'sharp'
import { requireEnv } from '../src/lib/env'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_SIDE = 2000

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function asJpeg(path: string): Promise<Buffer> {
  return sharp(await readFile(path))
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
}

function summary(reading: PlanReading) {
  const complete = reading.rooms.filter(
    (room) => room.widthCm !== undefined && room.depthCm !== undefined,
  )
  return {
    ceilingCm: reading.ceilingCm ?? null,
    totalAreaM2: reading.totalAreaM2 ?? null,
    rooms: reading.rooms.map((room) => ({
      name: room.name,
      kind: room.kind,
      widthCm: room.widthCm ?? null,
      depthCm: room.depthCm ?? null,
      areaM2: room.areaM2 ?? null,
      estimated: room.estimated ?? [],
      rechecked: room.rechecked ?? [],
      chainMismatch: room.chainMismatch ?? [],
      suspicious: room.suspicious === true,
    })),
    metrics: {
      rooms: reading.rooms.length,
      withBothSides: complete.length,
      withArea: reading.rooms.filter((room) => room.areaM2 !== undefined).length,
      estimated: reading.rooms.filter((room) => room.estimated?.length).length,
      suspicious: reading.rooms.filter((room) => room.suspicious).length,
      chainMismatches: reading.rooms.filter((room) => room.chainMismatch?.length).length,
    },
  }
}

const plansDirectory = resolve(import.meta.dirname, '../../plans')
const selector = flag('file')?.toLowerCase()
const entries = await readdir(plansDirectory, { withFileTypes: true })
const paths = entries
  .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
  .map((entry) => join(plansDirectory, entry.name))
  .filter((path) => !selector || basename(path).toLowerCase().includes(selector))

if (paths.length === 0) {
  throw new Error('Не нашлось изображений планов. Проверьте папку plans или параметр --file.')
}

const read = createFalPlanReader(requireEnv('FAL_KEY'))
const readSide = createFalSideReader(requireEnv('FAL_KEY'))
const verifyChains = hasFlag('verify-chains')
const results: Array<{ file: string; reading?: ReturnType<typeof summary>; error?: string }> = []

for (const path of paths) {
  try {
    const body = await asJpeg(path)
    let reading = await read({ body, contentType: 'image/jpeg' })
    if (verifyChains) {
      const image = { body, contentType: 'image/jpeg' }
      const rooms: PlanRoom[] = []
      for (const room of reading.rooms) {
        if (room.widthCm === undefined || room.depthCm === undefined) {
          rooms.push(room)
          continue
        }
        const [widthCm, depthCm] = await Promise.all([
          readSide(image, room.name, 'width'),
          readSide(image, room.name, 'depth'),
        ])
        rooms.push(
          applyRecheck(room, { widthCm, depthCm }) ??
            markChainMismatch(room, { widthCm, depthCm }) ??
            estimateSides(room) ??
            room,
        )
      }
      reading = { ...reading, rooms }
    }
    results.push({ file: basename(path), reading: summary(reading) })
  } catch (error) {
    results.push({
      file: basename(path),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

console.log(JSON.stringify({ plansDirectory, results }, null, 2))
