// Writes index.json, the list of every pack here that "skylands theme
// search" shows and "skylands theme add <id>" installs from: each pack's
// id, name, version, description, author, license, directory, and sha256,
// which the files skylands downloads must have. Run it from the
// repository's root after adding or changing a pack:
//
//   npm run index

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'

const FILES = ['LICENSE', 'models.glb', 'theme.json']
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

const packs = []
const dirs = (await readdir('.', { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
for (const dir of dirs.map((d) => d.name).sort()) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(`${dir}/theme.json`, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') continue // not a pack
    throw new Error(`${dir}/theme.json: ${err.message}`)
  }
  if (manifest.id !== dir) throw new Error(`${dir}/theme.json says its id is ${manifest.id}; a pack's directory is named for its id`)
  // The same hash skylands pins a pack by: sha256sum LICENSE models.glb theme.json | sha256sum
  const list = (await Promise.all(FILES.map(async (f) => `${sha256(await readFile(`${dir}/${f}`))}  ${f}\n`))).join('')
  const { id, name, version, description, author, license } = manifest
  packs.push({ id, name, version, description, author, license, sha256: sha256(list), path: dir })
}

await writeFile('index.json', JSON.stringify({ format: 1, packs }, null, 2) + '\n')
console.log(`wrote index.json: ${packs.map((p) => p.id).join(', ')}`)
