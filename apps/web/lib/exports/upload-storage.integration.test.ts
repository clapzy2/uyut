import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { expect, it } from 'vitest'
import { getEnv } from '@/lib/env'
import { inspectObject } from '@/lib/storage'

it('reads the PDF checkpoint metadata from local S3 and recognizes a missing key', async () => {
  const env = getEnv()
  if (!['localhost', '127.0.0.1'].includes(new URL(env.S3_ENDPOINT).hostname)) {
    throw new Error('This test may only use local S3')
  }
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  })
  const key = `qa/upload-recovery-${randomUUID()}.pdf`
  const metadata = { 'export-id': randomUUID(), 'pdf-sha256': 'a'.repeat(64) }
  const body = Buffer.from('%PDF-1.7\n%%EOF')
  try {
    expect(await inspectObject(key)).toBeNull()
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
        Metadata: metadata,
      }),
    )
    const result = await inspectObject(key)
    expect(result?.Metadata).toEqual(metadata)
    expect(result?.ContentLength).toBe(body.length)
    expect(result?.ContentType).toBe('application/pdf')
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    client.destroy()
  }
})
