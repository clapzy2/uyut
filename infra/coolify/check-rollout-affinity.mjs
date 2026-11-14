import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Изолированная проверка реального Traefik, без сайта, БД и платных задач.
const directory = await mkdtemp(path.join(tmpdir(), 'uyut-rollout-'))
const project = `uyut-rollout-${process.pid}`
const composePath = path.join(directory, 'compose.json')
const configPath = path.join(directory, 'routing', 'dynamic.yml')

function compose(...args) {
  const result = spawnSync('docker', ['compose', '-p', project, '-f', composePath, ...args], {
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

async function configure(sticky, versions = ['old', 'new']) {
  await writeFile(
    configPath,
    JSON.stringify({
      http: {
        routers: { app: { rule: 'PathPrefix(`/`)', service: 'app', entryPoints: ['web'] } },
        services: {
          app: {
            loadBalancer: {
              servers: versions.map((version) => ({ url: `http://${version}:80` })),
              ...(sticky
                ? {
                    sticky: {
                      cookie: {
                        name: 'domitsa_release',
                        secure: true,
                        httpOnly: true,
                        sameSite: 'lax',
                      },
                    },
                  }
                : {}),
            },
          },
        },
      },
    }),
  )
}

await mkdir(path.dirname(configPath))
for (const version of ['old', 'new']) {
  const root = path.join(directory, version)
  await mkdir(root)
  await writeFile(path.join(root, 'index.html'), `<script src="/${version}.js"></script>`)
  await writeFile(path.join(root, `${version}.js`), `console.log('${version}')`)
}
await configure(false)
await writeFile(
  composePath,
  JSON.stringify({
    services: {
      proxy: {
        image: 'traefik:v3.6',
        command: [
          '--entrypoints.web.address=:80',
          '--providers.file.directory=/routing',
          '--providers.file.watch=true',
        ],
        ports: ['127.0.0.1::80'],
        volumes: [`${path.join(directory, 'routing').replaceAll('\\', '/')}:/routing:ro`],
      },
      ...Object.fromEntries(
        ['old', 'new'].map((version) => [
          version,
          {
            image: 'nginx:stable-alpine',
            volumes: [
              `${path.join(directory, version).replaceAll('\\', '/')}:/usr/share/nginx/html:ro`,
            ],
          },
        ]),
      ),
    },
  }),
)

try {
  compose('up', '-d')
  let origin = `http://${compose('port', 'proxy', '80')}`
  async function request(url = '/', cookie) {
    return fetch(`${origin}${url}`, {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(3000),
    })
  }
  async function until(check) {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if (await check()) return
      } catch {
        /* контейнер или новая конфигурация ещё не готовы */
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Traefik did not reach the expected state')
  }
  await until(async () => (await request()).ok)
  let missing = 0
  for (let attempt = 0; attempt < 20; attempt++) {
    const html = await (await request()).text()
    const asset = /src="([^"]+)"/.exec(html)?.[1]
    assert.ok(asset)
    if ((await request(asset)).status === 404) missing++
  }
  assert.ok(missing > 0, 'Control must reproduce mixed-build asset failures')
  await configure(true)
  compose('restart', 'proxy')
  origin = `http://${compose('port', 'proxy', '80')}`
  await until(async () => (await request()).headers.has('set-cookie'))
  const versions = new Set()
  let oldCookie
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await request()
    const header = response.headers.get('set-cookie')
    assert.match(header, /HttpOnly/i)
    assert.match(header, /Secure/i)
    assert.match(header, /SameSite=Lax/i)
    const cookie = header.split(';')[0]
    const html = await response.text()
    const asset = /src="([^"]+)"/.exec(html)?.[1]
    assert.ok(asset)
    versions.add(asset)
    if (asset === '/old.js') oldCookie = cookie
    for (let repeat = 0; repeat < 3; repeat++)
      assert.equal((await request(asset, cookie)).status, 200)
  }
  assert.equal(versions.size, 2)
  assert.ok(oldCookie)
  await configure(true, ['new'])
  compose('restart', 'proxy')
  origin = `http://${compose('port', 'proxy', '80')}`
  await until(async () => (await (await request('/', oldCookie)).text()).includes('/new.js'))
  const switched = await request('/', oldCookie)
  assert.ok(switched.headers.get('set-cookie')?.startsWith('domitsa_release='))
  assert.equal(
    (await request('/new.js', switched.headers.get('set-cookie').split(';')[0])).status,
    200,
  )
  console.log(
    JSON.stringify({
      withoutAffinityMissing: missing,
      stickySessions: 40,
      assetChecks: 120,
      removedBackendReassigned: true,
    }),
  )
} catch (error) {
  console.error(compose('logs', '--tail', '15'))
  throw error
} finally {
  // Удаляются только контейнеры и сеть этого уникального тестового проекта.
  compose('down')
}
