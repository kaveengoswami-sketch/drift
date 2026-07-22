// Generates D:\Drift\build\icon.ico (+ icon.png) from inline SVG.
// Two artwork variants: detail is dropped at small sizes so the glyph still
// reads at 16px instead of turning to mush.
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = 'D:\\Drift\\build'

const bg = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0"    stop-color="#FFB25A"/>
      <stop offset="0.48" stop-color="#F2506E"/>
      <stop offset="1"    stop-color="#7B4DFF"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF3E0"/>
      <stop offset="1" stop-color="#FFD9C2"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="232" fill="url(#bg)"/>`

// >= 48px: two stacked cards, full scene
const detailed = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${bg}
  <defs>
    <clipPath id="c1"><rect x="330" y="330" width="404" height="364" rx="52"/></clipPath>
  </defs>
  <g transform="rotate(-11 512 512)">
    <rect x="292" y="302" width="404" height="364" rx="52" fill="#ffffff" opacity="0.42"/>
  </g>
  <rect x="330" y="330" width="404" height="364" rx="52" fill="#ffffff"/>
  <g clip-path="url(#c1)">
    <rect x="330" y="330" width="404" height="364" fill="url(#sky)"/>
    <circle cx="447" cy="428" r="44" fill="#FFA92E"/>
    <path d="M330 694 L474 486 L590 640 L648 566 L734 668 L734 694 Z" fill="#6E5BD8" opacity="0.55"/>
    <path d="M330 694 L436 546 L556 694 Z" fill="#2F9E6B"/>
    <path d="M470 694 L604 520 L734 694 Z" fill="#268A5C"/>
  </g>
  <rect x="330" y="330" width="404" height="364" rx="52" fill="none" stroke="#ffffff" stroke-width="10"/>
</svg>`

// <= 32px: single big card, chunky shapes, no stroke
const simple = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${bg}
  <defs>
    <clipPath id="c2"><rect x="236" y="266" width="552" height="492" rx="76"/></clipPath>
  </defs>
  <rect x="236" y="266" width="552" height="492" rx="76" fill="#ffffff"/>
  <g clip-path="url(#c2)">
    <rect x="236" y="266" width="552" height="492" fill="url(#sky)"/>
    <circle cx="386" cy="404" r="66" fill="#FFA92E"/>
    <path d="M236 758 L404 520 L560 758 Z" fill="#2F9E6B"/>
    <path d="M470 758 L628 536 L788 758 Z" fill="#268A5C"/>
  </g>
</svg>`

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function packIco(imgs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(imgs.length, 4)
  const dir = Buffer.alloc(16 * imgs.length)
  let offset = 6 + 16 * imgs.length
  imgs.forEach((im, i) => {
    const e = 16 * i
    // 256 is encoded as 0 in the ICONDIRENTRY byte fields
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, e)
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, e + 1)
    dir.writeUInt8(0, e + 2)
    dir.writeUInt8(0, e + 3)
    dir.writeUInt16LE(1, e + 4)   // planes
    dir.writeUInt16LE(32, e + 6)  // bpp
    dir.writeUInt32LE(im.data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += im.data.length
  })
  return Buffer.concat([header, dir, ...imgs.map((i) => i.data)])
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const imgs = []
  for (const size of SIZES) {
    const src = Buffer.from(size <= 32 ? simple : detailed)
    const data = await sharp(src, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
    imgs.push({ size, data })
  }
  const ico = packIco(imgs)
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico)
  // electron-builder also likes a 512 png for non-win targets / installer art
  await sharp(Buffer.from(detailed), { density: 384 }).resize(512, 512).png().toFile(path.join(OUT, 'icon.png'))
  console.log('icon.ico bytes:', ico.length, '| sizes:', imgs.map((i) => `${i.size}:${i.data.length}`).join(' '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
