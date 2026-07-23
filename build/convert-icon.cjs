const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const OUT = 'D:\\Drift\\build'
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

async function convert(inputPath) {
  fs.mkdirSync(OUT, { recursive: true })
  const imgs = []
  
  // Resize input image to 1024x1024 base PNG with sharp, applying a subtle corner rounding or clean crop if needed
  const baseImg = sharp(inputPath)

  for (const size of SIZES) {
    const data = await baseImg
      .clone()
      .resize(size, size, { kernel: sharp.kernel.nearest })
      .png({ compressionLevel: 9 })
      .toBuffer()
    imgs.push({ size, data })
  }
  
  const ico = packIco(imgs)
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico)
  
  await baseImg
    .clone()
    .resize(512, 512)
    .png()
    .toFile(path.join(OUT, 'icon.png'))
    
  console.log('Successfully updated icon.ico & icon.png from', inputPath)
}

const inputImage = process.argv[2]
if (!inputImage) {
  console.error('Please specify input image path')
  process.exit(1)
}

convert(inputImage).catch(err => {
  console.error(err)
  process.exit(1)
})
