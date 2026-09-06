import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getEnv } from './env'

let client: S3Client | undefined

function getClient(): S3Client {
  if (!client) {
    const env = getEnv()
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      // MinIO и Selectel отвечают по пути bucket/key, а не по поддомену
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    })
  }
  return client
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getEnv().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }))
}

// Bucket приватный: наружу отдаём только временные подписанные ссылки
export function presignedObjectUrl(key: string, expiresInSeconds = 15 * 60): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }), {
    expiresIn: expiresInSeconds,
  })
}

/** Ключ объекта, если ссылка ведёт в наш bucket: такие картинки наружу отдаём подписанными. */
export function ownObjectKey(url: string): string | null {
  const env = getEnv()
  const prefix = `${env.S3_ENDPOINT.replace(/\/$/, '')}/${env.S3_BUCKET}/`
  return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null
}
