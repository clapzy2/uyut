export function FormError({ message }: { message?: string }) {
  if (!message) {
    return null
  }
  return (
    <p
      role="alert"
      className="rounded-sm border border-danger/40 bg-paper px-3.5 py-3 text-sm leading-snug text-ink"
    >
      {message}
    </p>
  )
}
