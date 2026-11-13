// Builds Paper Lanterns' models.glb from code, so the models can be
// rebuilt and reviewed as text. Run it from the repository's root:
//
//   npm run build
//
// Every model is folded paper: flat-shaded, with no normals in the file,
// which glTF says to draw flat, and no textures. Parts the world looks for
// are named as FORMAT.md says: core, halo, beacon, cap, and bag nodes, and
// provider, repo, and repo-glow materials.

import { writeFile } from 'node:fs/promises'
import { Document, NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const out = process.argv[2] ?? 'models.glb'

const doc = new Document()
const buffer = doc.createBuffer()
const scene = doc.createScene('paper-lanterns')
doc.getRoot().setDefaultScene(scene)

const TAU = Math.PI * 2

// ---- materials -------------------------------------------------------------

// Colors are written as the world takes them, the same numbers as the
// colors in theme.json.
const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]

function material(name, color, { glow = 0, emissive = color, rough = 0.88, both = false } = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...rgb(color), 1]).setRoughnessFactor(rough).setMetallicFactor(0)
  if (glow) m.setEmissiveFactor(rgb(emissive).map((c) => c * glow))
  if (both) m.setDoubleSided(true)
  return m
}

const M = {
  paper: material('paper', 0xefe4cf),
  kraft: material('kraft', 0xc39a70),
  kraftDark: material('kraft-dark', 0x8f6a4a),
  lacquer: material('lacquer', 0x3b2733),
  ink: material('ink', 0x2a2236),
  lantern: material('lantern', 0xffe2ad, { glow: 0.85, emissive: 0xff9a3c }),
  beacon: material('beacon', 0xfff1c4, { glow: 1, emissive: 0xffd27a }),
  halo: material('halo', 0xffd27a),
  core: material('core', 0x7fe0f0),
  ring: material('ring', 0xfff0d2, { glow: 0.8, emissive: 0xffb766 }),
  roof: material('roof', 0x514877),
  leaf: material('leaf', 0x6f9a5e),
  leafDark: material('leaf-dark', 0x587f4c),
  leafLight: material('leaf-light', 0x8fb27a),
  rose: material('rose', 0xe07a8f, { both: true }),
  gold: material('gold', 0xe9c46a, { both: true }),
  sage: material('sage', 0xa9c08f),
  peach: material('peach', 0xe8b896),
  lilac: material('lilac', 0xb9a7d1),
  beak: material('beak', 0xf0a030),
  // The world tints these: provider in an agent's provider's color, repo
  // and repo-glow in a terrace's repo's color, repo-glow glowing too.
  provider: material('provider', 0xffffff, { both: true }),
  repo: material('repo', 0xffffff),
  repoGlow: material('repo-glow', 0xffffff, { glow: 0.6 }),
}

// ---- geometry --------------------------------------------------------------

/** Scales, turns, then moves a geometry, in place. */
function T(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx = s, sy = s, sz = s } = {}) {
  geo.scale(sx, sy, sz)
  if (rx) geo.rotateX(rx)
  if (ry) geo.rotateY(ry)
  if (rz) geo.rotateZ(rz)
  geo.translate(x, y, z)
  return geo
}

/** Keeps only positions, with an index, which is all a flat-shaded model needs. */
function prep(geo) {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name)
  if (!geo.index) geo.setIndex([...Array(geo.getAttribute('position').count).keys()])
  return geo
}

/** A hash of a point, the same for every vertex at that point. */
function hash(x, y, z, seed) {
  let h = seed * 374761393
  for (const v of [x, y, z]) {
    h = Math.imul(h ^ Math.round(v * 1000), 668265263)
    h ^= h >>> 15
  }
  return ((h >>> 0) % 100000) / 100000
}

/** Pushes vertices in and out from the y axis, by up to amount, except where keep says not to. */
function jitter(geo, amount, seed, keep = () => false) {
  const p = geo.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    if (keep(x, y, z)) continue
    const k = 1 + (hash(x, y, z, seed) - 0.5) * amount
    p.setXYZ(i, x * k, y + (hash(z, x, y, seed + 1) - 0.5) * amount * 0.3, z * k)
  }
  return geo
}

/** A triangular prism: a triangle in x and y, from z = -depth/2 to depth/2. */
function prism(pts, depth) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geo.translate(0, 0, -depth / 2)
  return geo
}

/** One flat polygon, from its corners in order. */
function polygon(pts) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3))
  const idx = []
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1)
  geo.setIndex(idx)
  return geo
}

/** A paper lantern's body: a barrel, height tall at its widest radius. */
function lanternBody(radius, height, segments = 8) {
  const prof = [
    [0.55, 0],
    [0.86, 0.13],
    [1, 0.37],
    [1, 0.63],
    [0.86, 0.87],
    [0.55, 1],
  ].map(([r, y]) => new THREE.Vector2(r * radius, y * height))
  return new THREE.LatheGeometry(prof, segments)
}

// ---- writing ---------------------------------------------------------------

/** A glTF mesh with one primitive per material, each from the geometries given for it. */
function mesh(name, parts) {
  const m = doc.createMesh(name)
  for (const [mat, geos] of parts) {
    const g = mergeGeometries(geos.map(prep))
    const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.getAttribute('position').array)).setBuffer(buffer)
    const n = g.getAttribute('position').count
    const idx = doc.createAccessor().setType('SCALAR').setArray(n < 65536 ? new Uint16Array(g.index.array) : new Uint32Array(g.index.array)).setBuffer(buffer)
    m.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mat))
  }
  return m
}

function node(name, { mesh: m, at = [0, 0, 0], rot, children = [] } = {}) {
  const n = doc.createNode(name).setTranslation(at)
  if (m) n.setMesh(m)
  if (rot) n.setRotation(rot)
  for (const c of children) n.addChild(c)
  return n
}

function model(n) {
  scene.addChild(n)
  return n
}

/** A looping clip that turns a node through rotation(t) for t from 0 to 1, over seconds. */
function clip(name, target, seconds, rotation, steps = 24) {
  const times = []
  const values = []
  const q = new THREE.Quaternion()
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    times.push(t * seconds)
    q.setFromEuler(rotation(t))
    values.push(q.x, q.y, q.z, q.w)
  }
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer)
  const output = doc.createAccessor().setType('VEC4').setArray(new Float32Array(values)).setBuffer(buffer)
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR')
  const channel = doc.createAnimationChannel().setTargetNode(target).setTargetPath('rotation').setSampler(sampler)
  doc.createAnimation(name).addSampler(sampler).addChannel(channel)
}

const E = (x, y, z) => new THREE.Euler(x, y, z)

// ---- the citadel: a great paper lantern on a folded platform ------------------

function citadel() {
  const base = [
    T(new THREE.CylinderGeometry(8.6, 8.2, 1.2, 8), { y: -0.6, ry: Math.PI / 8 }),
  ]
  const top = [T(new THREE.CylinderGeometry(8.25, 8.25, 0.08, 8), { y: 0.04, ry: Math.PI / 8 })]
  // The folded rock under it, its rim kept where the platform meets it.
  const under = [jitter(T(new THREE.ConeGeometry(8.2, 9, 8, 3), { rx: Math.PI, y: -5.7, ry: Math.PI / 8 }), 0.35, 77, (_x, y) => y > -1.25)]

  // The lantern, on a stand, with bands, ribs at its folds, and caps.
  const L = { r: 3.7, h: 7, y: 1.1 }
  const body = [T(lanternBody(L.r, L.h), { y: L.y })]
  const dark = [
    T(new THREE.CylinderGeometry(2.3, 2.6, 1.02, 8), { y: 0.59 }),
    T(new THREE.CylinderGeometry(2.15, 2.15, 0.3, 8), { y: L.y + 0.1 }),
    T(new THREE.CylinderGeometry(2.05, 2.3, 0.45, 8), { y: L.y + L.h + 0.2 }),
    T(new THREE.ConeGeometry(0.85, 0.9, 8), { y: L.y + L.h + 0.87 }),
    T(new THREE.CylinderGeometry(L.r + 0.04, L.r + 0.04, 0.14, 8), { y: L.y + 0.37 * L.h }),
    T(new THREE.CylinderGeometry(L.r + 0.04, L.r + 0.04, 0.14, 8), { y: L.y + 0.63 * L.h }),
  ]
  const prof = [
    [0.55, 0],
    [0.86, 0.13],
    [1, 0.37],
    [1, 0.63],
    [0.86, 0.87],
    [0.55, 1],
  ]
  for (let i = 0; i < 8; i++) {
    const phi = (i / 8) * TAU
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, y0] = prof[j]
      const [r1, y1] = prof[j + 1]
      const a = new THREE.Vector3(r0 * L.r * Math.sin(phi), L.y + y0 * L.h, r0 * L.r * Math.cos(phi))
      const b = new THREE.Vector3(r1 * L.r * Math.sin(phi), L.y + y1 * L.h, r1 * L.r * Math.cos(phi))
      const len = a.distanceTo(b)
      const rib = new THREE.BoxGeometry(0.09, len + 0.06, 0.09)
      const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 0, 1))
      rib.rotateX(Math.PI / 2)
      rib.applyMatrix4(m)
      const mid = a.clone().add(b).multiplyScalar(0.5)
      rib.translate(mid.x, mid.y, mid.z)
      dark.push(rib)
    }
  }

  // Six small lanterns on posts round the platform's edge.
  const small = []
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 6
    const [x, z] = [Math.cos(a) * 6.6, Math.sin(a) * 6.6]
    dark.push(T(new THREE.CylinderGeometry(0.06, 0.08, 1.8, 6), { x, y: 0.98, z }))
    dark.push(T(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 6), { x, y: 1.9, z }))
    small.push(T(lanternBody(0.42, 0.75, 6), { x, y: 1.95, z }))
    dark.push(T(new THREE.ConeGeometry(0.3, 0.25, 6), { x, y: 2.82, z }))
  }
  // The string the crystal hangs from.
  const ink = [T(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 4), { y: -10.75 })]

  const beaconY = L.y + L.h + 1.85
  return model(
    node('citadel', {
      mesh: mesh('citadel', [
        [M.kraft, base],
        [M.paper, top],
        [M.kraftDark, under],
        [M.lantern, [...body, ...small]],
        [M.lacquer, dark],
        [M.ink, ink],
      ]),
      children: [
        node('beacon', { mesh: mesh('beacon', [[M.beacon, [new THREE.IcosahedronGeometry(0.55, 1)]]]), at: [0, beaconY, 0] }),
        node('halo', { mesh: mesh('halo', [[M.halo, [new THREE.SphereGeometry(0.6, 14, 10)]]]), at: [0, beaconY, 0] }),
        node('core', { mesh: mesh('core', [[M.core, [T(new THREE.OctahedronGeometry(0.9), { s: 1.7 })]]]), at: [0, -12.9, 0] }),
      ],
    }),
  )
}

// ---- islands: folded paper rocks, radius 1, top at 0, reaching down to -1 -----

const coreMesh = mesh('island-core', [[M.core, [new THREE.OctahedronGeometry(0.9)]]])

function island(name, { sides, top, seed, rough }) {
  // One radius per corner, shared by the slab and the rock's rim, so they meet.
  const corner = (x, z) => {
    const i = Math.round((Math.atan2(z, x) / TAU) * sides + sides) % sides
    return 1 + (hash(i, 0, 0, seed) - 0.5) * 0.22
  }
  const radial = (geo) => {
    const p = geo.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const k = corner(p.getX(i), p.getZ(i))
      p.setX(i, p.getX(i) * k)
      p.setZ(i, p.getZ(i) * k)
    }
    return geo
  }
  const slab = radial(T(new THREE.CylinderGeometry(1, 0.97, 0.12, sides), { y: -0.06 }))
  const rock = jitter(radial(T(new THREE.ConeGeometry(0.97, 0.88, sides, 3), { rx: Math.PI, y: -0.56 })), rough, seed, (_x, y) => y > -0.125)
  return model(
    node(name, {
      mesh: mesh(name, [
        [top, [slab]],
        [M.kraft, [rock]],
      ]),
      children: [node('core', { mesh: coreMesh, at: [0, -1.25, 0] })],
    }),
  )
}

// ---- scenery ------------------------------------------------------------------

function tree() {
  const leaves = [
    T(new THREE.ConeGeometry(0.45, 0.55, 4), { y: 0.62 }),
    T(new THREE.ConeGeometry(0.27, 0.42, 4), { y: 1.18, ry: Math.PI / 4 }),
  ]
  const dark = [T(new THREE.ConeGeometry(0.36, 0.5, 4), { y: 0.9, ry: Math.PI / 8 })]
  return model(
    node('tree', {
      mesh: mesh('tree', [
        [M.kraftDark, [T(new THREE.BoxGeometry(0.08, 0.5, 0.08), { y: 0.25 })]],
        [M.leaf, leaves],
        [M.leafDark, dark],
      ]),
    }),
  )
}

function pinwheel() {
  const rose = []
  const gold = []
  for (let i = 0; i < 4; i++) {
    const blade = polygon([
      [0, 0, 0],
      [0, 0.34, 0.02],
      [0, 0.2, 0.22],
    ])
    blade.rotateX((i * Math.PI) / 2)
    ;(i % 2 ? gold : rose).push(blade)
  }
  const blades = node('blades', {
    mesh: mesh('blades', [
      [M.rose, rose],
      [M.gold, gold],
    ]),
    at: [0.04, 1, 0],
  })
  clip('pinwheel.spin', blades, 2.4, (t) => E(t * TAU, 0, 0), 8)
  return model(
    node('pinwheel', {
      mesh: mesh('pinwheel', [[M.lacquer, [T(new THREE.CylinderGeometry(0.025, 0.025, 1, 5), { y: 0.5 })]]]),
      children: [blades],
    }),
  )
}

function fold() {
  return model(node('fold', { mesh: mesh('fold', [[M.leafLight, [T(new THREE.ConeGeometry(1, 0.55, 5), { y: 0.275 })]]]) }))
}

// ---- the selection ring's piece: a paper diamond, its long side along the ring ----

function ringPiece() {
  return model(node('ring', { mesh: mesh('ring', [[M.ring, [T(new THREE.OctahedronGeometry(1), { sx: 0.1, sy: 0.03, sz: 0.32 })]]]) }))
}

// ---- terraces -------------------------------------------------------------------

function plaza() {
  return model(
    node('plaza', {
      mesh: mesh('plaza', [
        [M.repo, [T(new THREE.BoxGeometry(1, 0.35, 1), { y: 0.175 })]],
        [M.paper, [T(new THREE.BoxGeometry(0.92, 0.03, 0.92), { y: 0.35 })]],
      ]),
    }),
  )
}

function post() {
  const lantern = node('lantern', {
    mesh: mesh('post-lantern', [
      [M.ink, [T(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 3), { y: -0.06 })]],
      [M.repoGlow, [T(lanternBody(0.12, 0.22, 6), { y: -0.34 })]],
      [M.lacquer, [T(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 6), { y: -0.12 }), T(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 6), { y: -0.34 })]],
    ]),
    at: [0.17, 0.9, 0],
  })
  clip('post.sway', lantern, 3.2, (t) => E(0.08 * Math.sin(t * TAU + 1), 0, 0.14 * Math.sin(t * TAU)))
  return model(
    node('post', {
      mesh: mesh('post', [
        [M.lacquer, [T(new THREE.CylinderGeometry(0.025, 0.032, 0.95, 6), { y: 0.475 }), T(new THREE.BoxGeometry(0.22, 0.025, 0.025), { x: 0.09, y: 0.92 })]],
      ]),
      children: [lantern],
    }),
  )
}

// ---- buildings: a paper box, which the world stretches, under a pitched roof ------

function building() {
  const roof = prism(
    [
      [-0.56, 0],
      [0.56, 0],
      [0, 0.34],
    ],
    1.12,
  )
  return model(
    node('building', {
      mesh: mesh('building', [[M.paper, [new THREE.BoxGeometry(1, 1, 1)]]]),
      children: [node('cap', { mesh: mesh('roof', [[M.roof, [roof]]]) })],
    }),
  )
}

// ---- airships, facing +x, their undersides at y = -0.6 ----------------------------

const bagMesh = mesh('bag', [[M.paper, [new THREE.IcosahedronGeometry(0.11, 0)]]])

function bags() {
  return [
    [-0.25, 0.15],
    [0.25, 0.15],
    [-0.25, -0.15],
    [0.25, -0.15],
  ].map(([x, z]) => node('bag', { mesh: bagMesh, at: [x, -0.6, z] }))
}

/** A wing on one side, its root along the body, from a pivot that flaps it. */
function wing(name, side, span, sweep) {
  return node(name, {
    mesh: mesh(name, [
      [
        M.provider,
        [
          polygon([
            [0.38, 0, 0],
            [-0.3, 0, 0],
            [sweep, 0.05, side * span],
          ]),
        ],
      ],
    ]),
    at: [0, 0.12, side * 0.08],
  })
}

function bird(name, { neck, wingSpan, body, beak }) {
  const l = wing(`${name}.wing.l`, 1, wingSpan, -0.12)
  const r = wing(`${name}.wing.r`, -1, wingSpan, -0.12)
  const flap = 1.3
  clip(`${name}.flap.l`, l, flap, (t) => E(-0.45 * Math.sin(t * TAU), 0, 0))
  clip(`${name}.flap.r`, r, flap, (t) => E(0.45 * Math.sin(t * TAU), 0, 0))
  const parts = [
    T(new THREE.OctahedronGeometry(1), { sx: body[0], sy: body[1], sz: body[2] }),
    // neck up and forward, head, and tail up and back
    T(new THREE.ConeGeometry(0.06, neck, 4), { rz: -0.6, x: 0.5 + neck * 0.28, y: 0.12 + neck * 0.4 }),
    T(new THREE.ConeGeometry(0.06, 0.22, 4), { rz: -Math.PI / 2, x: 0.62 + neck * 0.62, y: 0.12 + neck * 0.82 }),
    T(new THREE.ConeGeometry(0.07, 0.55, 4), { rz: 0.9, x: -0.72, y: 0.28 }),
  ]
  const own = [[M.provider, parts]]
  if (beak) own.push([M.beak, [T(new THREE.ConeGeometry(0.05, 0.16, 4), { rz: -Math.PI / 2, x: 0.78 + neck * 0.62, y: 0.1 + neck * 0.82 })]])
  return model(node(name, { mesh: mesh(name, own), children: [l, r, ...bags()] }))
}

function boat() {
  const hull = prism(
    [
      [-0.75, 0.15],
      [0.75, 0.15],
      [0.42, -0.25],
      [-0.42, -0.25],
    ],
    0.5,
  )
  const sail = prism(
    [
      [-0.42, 0.15],
      [0.42, 0.15],
      [0, 0.8],
    ],
    0.06,
  )
  const body = node('boat.hull', { mesh: mesh('boat', [[M.provider, [hull, sail]]]), at: [0, -0.1, 0] })
  clip('boat.rock', body, 3.4, (t) => E(0.09 * Math.sin(t * TAU), 0, 0.04 * Math.sin(t * TAU + 2)))
  return model(node('boat', { children: [body, ...bags()] }))
}

function balloon() {
  const globe = node('balloon.globe', { mesh: mesh('balloon', [[M.provider, [T(lanternBody(0.62, 0.95, 8), { y: -0.2 })]]]) })
  clip('balloon.turn', globe, 9, (t) => E(0, t * TAU, 0), 8)
  const rig = [T(new THREE.BoxGeometry(0.32, 0.16, 0.32), { y: -0.42 }), T(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), { y: -0.2 }), T(new THREE.CylinderGeometry(0.22, 0.28, 0.08, 8), { y: 0.76 })]
  return model(node('balloon', { mesh: mesh('balloon-rig', [[M.lacquer, rig]]), children: [globe, ...bags()] }))
}

function dart() {
  const wings = [
    polygon([
      [0.9, 0.05, 0],
      [-0.6, 0.1, 0.02],
      [-0.55, 0.12, 0.55],
    ]),
    polygon([
      [0.9, 0.05, 0],
      [-0.6, 0.1, -0.02],
      [-0.55, 0.12, -0.55],
    ]),
    polygon([
      [0.9, 0.05, 0],
      [-0.6, 0.1, 0],
      [-0.5, -0.22, 0],
    ]),
  ]
  const body = node('dart.body', { mesh: mesh('dart', [[M.provider, wings]]) })
  clip('dart.roll', body, 2.6, (t) => E(0.18 * Math.sin(t * TAU), 0, 0.05 * Math.sin(t * TAU + 1)))
  return model(node('dart', { children: [body, ...bags()] }))
}

// ---- the visitor: a kite, facing +z, its face toward the side it passes ---------------

function kite() {
  const half = (sign, mat) => [
    mat,
    [
      polygon([
        [0, 1.1, 0],
        [0, 0, sign * 0.65],
        [0, -1.3, 0],
      ]),
    ],
  ]
  const tail = []
  for (let i = 0; i < 4; i++) {
    tail.push(T(new THREE.OctahedronGeometry(0.12), { sx: 0.3, sz: 1.6, y: -1.5 - i * 0.42, z: Math.sin(i) * 0.1 }))
  }
  const ribbon = node('kite.tail', { mesh: mesh('kite-tail', [[M.gold, tail]]) })
  clip('kite.tail', ribbon, 1.6, (t) => E(0.2 * Math.sin(t * TAU), 0, 0.06 * Math.sin(t * TAU + 1)))
  const kiteBody = node('kite.body', {
    mesh: mesh('kite', [half(1, M.rose), half(-1, M.gold), [M.lacquer, [T(new THREE.BoxGeometry(0.03, 2.4, 0.03), { y: -0.1 }), T(new THREE.BoxGeometry(0.03, 0.03, 1.3))]]]),
    children: [ribbon],
    rot: new THREE.Quaternion().setFromEuler(E(-0.5, 0, 0)).toArray(),
  })
  return model(node('kite', { children: [kiteBody] }))
}

// ---- everything -------------------------------------------------------------------

citadel()
island('island.sage', { sides: 9, top: M.sage, seed: 11, rough: 0.45 })
island('island.peach', { sides: 11, top: M.peach, seed: 23, rough: 0.35 })
island('island.lilac', { sides: 8, top: M.lilac, seed: 37, rough: 0.5 })
tree()
pinwheel()
fold()
ringPiece()
plaza()
post()
building()
bird('crane', { neck: 0.6, wingSpan: 0.95, body: [0.62, 0.22, 0.2] })
bird('goose', { neck: 0.8, wingSpan: 0.7, body: [0.6, 0.3, 0.3], beak: true })
boat()
balloon()
dart()
kite()

const glb = await new NodeIO().writeBinary(doc)
await writeFile(out, glb)
console.log(`wrote ${out}: ${glb.byteLength} bytes`)
