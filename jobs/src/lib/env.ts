export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} не задан`)
  }
  return value
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value : undefined
}
