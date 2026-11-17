import sharp from 'sharp'
const source = new URL('../public/icon.svg', import.meta.url)
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(source.pathname).resize(size, size).png().toFile(new URL(`../public/${name}`, import.meta.url).pathname)
}
