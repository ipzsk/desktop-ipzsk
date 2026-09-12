import { readFile } from 'node:fs/promises'

interface PunkStyle { id: string; name: string; kind: 'cover' | 'avatar' }
const root = new URL('../src/punk-source/', import.meta.url)

/** Read only bundled, allowlisted Skill documents; no network or generation. */
export async function readPunkSkill(styleId?: string): Promise<{ content: string }> {
  const catalog: PunkStyle[] = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'))
  if (!styleId) return { content: 'Choose one Punk style, then call punk_image_skill with its id.\n' + catalog.map(s => `${s.id}: ${s.name} (${s.kind})`).join('\n') }
  const style = catalog.find(s => s.id === styleId)
  if (!style) throw new Error('未知的 punk 风格，请先读取风格目录。')
  const paths = [
    `skills/punk-${style.kind}/SKILL.md`,
    `skills/punk-${style.kind}/references/${style.kind}-prompt-blueprint.md`,
    `styles/${style.id}/META.md`,
    `styles/${style.id}/STYLE.md`,
  ]
  if (style.id === 'surreal-pop-up-paper-landscape') paths.push(
    `styles/${style.id}/references/before-after.md`,
    `styles/${style.id}/references/final-artwork.md`,
  )
  const documents = await Promise.all(paths.map(async path => `## ${path}\n${await readFile(new URL(path, root), 'utf8')}`))
  return { content: 'Punk Skill reference material (adrianpunk, MIT). Apply it to the user’s image request. Use the installed generate_image/edit_image tools and configured IPZSK model. Respect the user’s explicit choices. Never claim a reference image or saved file exists without tool evidence.\n\n' + documents.join('\n\n') }
}
