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
  copy('src/popup/index.html', `${outdir}/popup.html`)
  copy('src/popup/popup.css', `${outdir}/popup.css`)
  copy('src/options/index.html', `${outdir}/options.html`)
  copy('src/options/options.css', `${outdir}/options.css`)
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
  { in: 'src/popup/popup.ts', out: `${outdir}/popup.js` },
  { in: 'src/options/options.ts', out: `${outdir}/options.js` },
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
