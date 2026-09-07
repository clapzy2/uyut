import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireEnv } from './env'

let cached: S3Client | undefined

function client(): S3Client {
  if (!cached) {
    cached = new S3Client({
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv('S3_ACCESS_KEY'),
        secretAccessKey: requireEnv('S3_SECRET_KEY'),
      },
    })
  }
  return cached
}

export type StoredFile = { body: Buffer; contentType: string }

export async function readObject(key: string): Promise<StoredFile> {
  const result = await client().send(
    new GetObjectCommand({ Bucket: requireEnv('S3_BUCKET'), Key: key }),
  )
  const bytes = await result.Body?.transformToByteArray()
  if (!bytes) {
    throw new Error(`объект ${key} пустой`)
  }
  return { body: Buffer.from(bytes), contentType: result.ContentType ?? 'image/jpeg' }
}

/** Подписанная ссылка на объект приватного bucket, для письма о готовом документе */
export function presignedUrl(key: string, expiresInSeconds: number): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: requireEnv('S3_BUCKET'), Key: key }),
    {
      expiresIn: expiresInSeconds,
    },
  )
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: requireEnv('S3_BUCKET'),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}
