import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { configureStorage } from '../src/storage-path.ts'
import { readPunkSkill } from '../src/punk-skills.ts'
import { listTemplates, refreshTemplates, readTemplateImage } from '../src/templates-store.ts'

const fixture = await mkdtemp(join(tmpdir(), 'ipzsk-imagegen-punk-'))
configureStorage(fixture)
after(() => rm(fixture, {recursive: true, force: true}))

test('bundled punk catalog has complete cover/avatar styles and no unresolved variables', async () => {
  const list = await listTemplates('punk')
  assert.equal(list.total, 38)
  assert.equal(list.origin, 'bundled')
  assert.deepEqual(new Set(list.cases.map(s => s.category)), new Set(['封面', '头像']))
  assert.equal(new Set(list.cases.map(s => s.id)).size, list.total)
  for (const item of list.cases) {
    assert.ok(item.prompt.length > 150)
    assert.ok(!item.prompt.includes('{{'))
    assert.ok(item.githubUrl.startsWith('https://github.com/adrianpunk/Punk-Skill/'))
  }
})
test('punk refresh stays offline and image route rejects unlisted paths', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => { throw new Error('unexpected network') }
  try {
    assert.equal((await refreshTemplates('punk')).total, 38)
    assert.equal(await readTemplateImage('punk', '../../LICENSE'), undefined)
    assert.equal(await readTemplateImage('punk', 'case99999.png'), undefined)
  } finally { globalThis.fetch = original }
})
test('Skill lookup is allowlisted and supplies the workflow and style blueprint', async () => {
  assert.match((await readPunkSkill()).content, /black-white-minimal-concept/)
  const cover = await readPunkSkill('black-white-minimal-concept')
  assert.match(cover.content, /cover-prompt-blueprint/)
  assert.match(cover.content, /META.md/)
  const avatar = await readPunkSkill('surreal-pop-up-paper-landscape')
  assert.match(avatar.content, /before-after.md/)
  assert.match(avatar.content, /final-artwork.md/)
  await assert.rejects(readPunkSkill('../../LICENSE'))
})
test('previews pin the same reviewed upstream commit', async () => {
  const source = JSON.parse(await readFile(new URL('../src/punk-source/SOURCE.json', import.meta.url)))
  const urls = JSON.parse(await readFile(new URL('../src/templates/punk-images.json', import.meta.url)))
  for (const url of Object.values(urls)) assert.ok(url.startsWith(`https://raw.githubusercontent.com/adrianpunk/Punk-Skill/${source.commit}/screenshots/`))
})
