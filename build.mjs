import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const watch = process.argv.includes('--watch')
const outdir = 'dist'

function loadEnv() {
  try {
    const txt = fs.readFileSync('.env', 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
      }
    }
  } catch {
    /* no .env — key comes from the options page */
  }
}

loadEnv()
const bakedKey = process.env.ANTHROPIC_API_KEY || ''

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function copyStatic() {
  copy('manifest.json', `${outdir}/manifest.json`)
  copy('src/dashboard/index.html', `${outdir}/dashboard.html`)
  copy('src/dashboard/dashboard.css', `${outdir}/dashboard.css`)
  copy('src/popup/popup.html', `${outdir}/popup.html`)
  copy('src/popup/popup.css', `${outdir}/popup.css`)
  for (const s of [16, 48, 128]) {
    copy(`src/icons/icon${s}.png`, `${outdir}/icons/icon${s}.png`)
  }
}

const shared = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  define: { __BAKED_API_KEY__: JSON.stringify(bakedKey) },
  logLevel: 'info',
}

const entries = [
  { in: 'src/background/background.ts', out: `${outdir}/background.js` },
  { in: 'src/dashboard/dashboard.ts', out: `${outdir}/dashboard.js` },
  { in: 'src/popup/popup.ts', out: `${outdir}/popup.js` },
]

async function run() {
  copyStatic()
  const contexts = await Promise.all(
    entries.map((e) =>
      esbuild.context({ ...shared, entryPoints: [e.in], outfile: e.out }),
    ),
  )
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()))
    fs.watch('src', { recursive: true }, (_e, f) => {
      if (f && (f.endsWith('.html') || f.endsWith('.css'))) copyStatic()
    })
    console.log('watching…')
  } else {
    await Promise.all(
      contexts.map(async (c) => {
        await c.rebuild()
        await c.dispose()
      }),
    )
    console.log('build complete → dist/')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})