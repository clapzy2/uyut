import { hash, type Options, verify } from '@node-rs/argon2'

// Параметры argon2id по рекомендации OWASP: 64 MiB памяти, 3 прохода
const options: Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: 2,
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, options)
}

export function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  return verify(input.hash, input.password, options)
}
