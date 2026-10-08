/** A private page response, not an OCR result or proof of scale. */
export async function pdfRasterPreview(response: Response, expectedPage: number) {
  if (!response.ok)
    throw new Error((await response.text()).slice(0, 300) || 'Не удалось открыть лист PDF.')
  const sha256 = response.headers.get('X-Plan-Sha256') ?? ''
  const page = Number(response.headers.get('X-Plan-Page'))
  const width = Number(response.headers.get('X-Plan-Image-Width'))
  const height = Number(response.headers.get('X-Plan-Image-Height'))
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    page !== expectedPage ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 100 ||
    height < 100 ||
    width > 2000 ||
    height > 2000 ||
    !response.headers.get('content-type')?.startsWith('image/jpeg')
  )
    throw new Error('Ответ не соответствует выбранному PDF-листу. Обновите страницу.')
  const blob = await response.blob()
  if (!blob.size || blob.size > 10_000_000)
    throw new Error('Изображение листа повреждено или слишком велико.')
  return { blob, sha256, page, width, height }
}
