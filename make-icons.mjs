import zlib from 'node:zlib'
import fs from 'node:fs'

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function writePNG(path, w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  fs.writeFileSync(
    path,
    Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]),
  )
}

function inRoundedRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r)
  const cy = Math.min(Math.max(y, r), h - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

const TOP = [0x6f, 0xa8, 0xff]
const BOT = [0x3f, 0x6f, 0xe6]
const GLYPH = [0xff, 0xff, 0xff]

function render(S) {
  const SS = 4
  const rgba = Buffer.alloc(S * S * 4)
  const r = S * 0.22
  const barX0 = 0.22 * S, barX1 = 0.78 * S, barY0 = 0.24 * S, barY1 = 0.385 * S
  const stemX0 = 0.43 * S, stemX1 = 0.57 * S, stemY0 = 0.24 * S, stemY1 = 0.76 * S

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let inside = 0, rr = 0, gg = 0, bb = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          if (!inRoundedRect(px, py, S, S, r)) continue
          inside++
          const inGlyph =
            (px >= barX0 && px <= barX1 && py >= barY0 && py <= barY1) ||
            (px >= stemX0 && px <= stemX1 && py >= stemY0 && py <= stemY1)
          if (inGlyph) {
            rr += GLYPH[0]; gg += GLYPH[1]; bb += GLYPH[2]
          } else {
            const t = py / S
            rr += TOP[0] + (BOT[0] - TOP[0]) * t
            gg += TOP[1] + (BOT[1] - TOP[1]) * t
            bb += TOP[2] + (BOT[2] - TOP[2]) * t
          }
        }
      }
      const idx = (y * S + x) * 4
      const a = inside / (SS * SS)
      if (inside > 0) {
        rgba[idx] = Math.round(rr / inside)
        rgba[idx + 1] = Math.round(gg / inside)
        rgba[idx + 2] = Math.round(bb / inside)
      }
      rgba[idx + 3] = Math.round(a * 255)
    }
  }
  return rgba
}

fs.mkdirSync('src/icons', { recursive: true })
for (const S of [16, 48, 128]) {
  writePNG(`src/icons/icon${S}.png`, S, S, render(S))
  console.log(`src/icons/icon${S}.png`)
}
