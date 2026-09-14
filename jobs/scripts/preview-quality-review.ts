/** Read-only smoke check: reuses an existing render, never updates a concept or renders anew. */
import { reviewConceptImage } from '@uyut/ai'

const url = process.env.QUALITY_SAMPLE_URL
const apiKey = process.env.FAL_KEY
if (!url || !apiKey) throw new Error('QUALITY_SAMPLE_URL and FAL_KEY are required')
const parsed = new URL(url)
if (parsed.protocol !== 'https:') throw new Error('Use an HTTPS image URL')
const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
if (!response.ok) throw new Error(`Image request failed (${response.status})`)
const body = Buffer.from(await response.arrayBuffer())
if (body.length > 10_000_000) throw new Error('Sample exceeds 10 MB')
const kind = process.env.QUALITY_SAMPLE_ROOM_KIND === 'living' ? 'living' : 'kitchen'
const result = await reviewConceptImage(
  apiKey,
  { body, contentType: response.headers.get('content-type') ?? 'image/webp' },
  { roomKind: kind },
)
console.log(JSON.stringify(result, null, 2))
