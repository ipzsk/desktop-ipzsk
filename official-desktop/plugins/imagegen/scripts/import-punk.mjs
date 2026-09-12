/** Rebuild the bundled gallery from the reviewed src/punk-source snapshot. */
import { readFile, writeFile } from 'node:fs/promises'
const root = new URL('../src/punk-source/', import.meta.url)
const source = JSON.parse(await readFile(new URL('SOURCE.json', root)))
const previousImages = JSON.parse(await readFile(new URL('../src/templates/punk-images.json', import.meta.url)))
const cases = [], catalog = [], images = {}
for (const kind of ['cover', 'avatar']) {
  const text = await readFile(new URL(`skills/punk-${kind}/references/style-catalog.md`, root), 'utf8')
  for (const match of text.matchAll(/^\| ([^|]+) \| `([a-z0-9-]+)` \|/gm)) {
    const name = match[1].trim(), id = match[2]
    const meta = await readFile(new URL(`styles/${id}/META.md`, root), 'utf8')
    const outputs = meta.match(/outputs:\s*\[([^\]]+)\]/)?.[1] ?? ''
    if (kind === 'cover' && !/\b(cover|poster)\b/.test(outputs)) continue
    if (catalog.some(item => item.id === id)) continue
    let rules = await readFile(new URL(`styles/${id}/STYLE.md`, root), 'utf8')
    rules = rules.replace(/## 输入变量\n[\s\S]*?(?=\n## |$)/g, '').replace(/\{\{[^}]+\}\}/g, '（按用户需求和参考图确定）')
    const imageUrl = Object.values(previousImages).find(url => url.includes(`/punk-${kind}-styles/${id}.`))
    const n = cases.length + 1
    const image = imageUrl ? `case${n}.${imageUrl.split('.').at(-1)}` : ''
    if (imageUrl) images[image] = imageUrl
    const intro = kind === 'cover'
      ? '将用户主题或文章摘要提炼成简洁可读的封面标题，用一个准确的视觉隐喻表现核心观点。只生成一张封面，不把原文铺满画面。'
      : '基于用户上传的参考图制作头像，保留主体身份和辨识特征。不得凭空假装已看到参考图；需要先在图生图中上传参考图。'
    const prompt = intro + '\n将以下视觉规则融入完整画面，只使用这一种风格。比例以用户和面板设置为准。不要将说明、变量提示或风格名称印在画面上。\n\n' + rules
    const url = `https://github.com/${source.repository}/tree/${source.commit}/styles/${id}`
    cases.push({ id: n, title: name, category: kind === 'cover' ? '封面' : '头像', prompt, styles: [id], scenes: [kind], sourceLabel: 'adrianpunk · MIT', sourceUrl: url, githubUrl: url, image })
    catalog.push({ id, name, kind })
  }
}
await writeFile(new URL('catalog.json', root), JSON.stringify(catalog, null, 2) + '\n')
await writeFile(new URL('../src/templates/punk-cases.json', import.meta.url), JSON.stringify({ repository: source.repository, fetchedAt: '2026-09-07', cases }, null, 2) + '\n')
await writeFile(new URL('../src/templates/punk-images.json', import.meta.url), JSON.stringify(images, null, 2) + '\n')
console.log(`${cases.length} Punk styles imported`)
