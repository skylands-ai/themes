// Builds Winter's models.glb from code, so the models can be rebuilt and
// reviewed as text. Run it from the repository's root:
//
//   npm run build
//
// Every model is low-poly and flat-shaded, with no normals in the file,
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
const scene = doc.createScene('winter')
doc.getRoot().setDefaultScene(scene)

const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

// ---- materials -------------------------------------------------------------

// Colors are written as the world takes them, the same numbers as the
// colors in theme.json.
const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]

function material(name, color, { glow = 0, emissive = color, rough = 0.9, both = false } = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...rgb(color), 1]).setRoughnessFactor(rough).setMetallicFactor(0)
  if (glow) m.setEmissiveFactor(rgb(emissive).map((c) => c * glow))
  if (both) m.setDoubleSided(true)
  return m
}

const M = {
  snow: material('snow', 0xe9f0f7),
  drift: material('snow-drift', 0xd2deeb),
  piste: material('piste', 0xffffff, { rough: 0.6 }),
  ice: material('ice', 0x9fd2ea, { rough: 0.15 }),
  icicle: material('icicle', 0xb9e1f3, { rough: 0.25, glow: 0.18, emissive: 0x8fd3f0 }),
  rock: material('rock', 0x5f6c7e),
  rockDark: material('rock-dark', 0x4a5465),
  pine: material('pine', 0x2f604b),
  pineDark: material('pine-dark', 0x24493a),
  bark: material('bark', 0x5a3c2a),
  wood: material('wood', 0x8c5b3b),
  roof: material('roof', 0x8e3a34),
  steel: material('steel', 0x56606e, { rough: 0.6 }),
  window: material('window', 0xffd48a, { glow: 0.9, emissive: 0xffae45 }),
  caneRed: material('cane-red', 0xd62f3b, { rough: 0.4 }),
  caneWhite: material('cane-white', 0xfbf6f0, { rough: 0.4 }),
  wire: material('wire', 0x1e3d2c),
  lineRed: material('line-red', 0xcf4a4a),
  lineBlue: material('line-blue', 0x4a72cc),
  coal: material('coal', 0x25272d),
  carrot: material('carrot', 0xf0872a),
  twig: material('twig', 0x6d4a30),
  gold: material('gold', 0xe6bb4c, { rough: 0.45 }),
  red: material('red', 0xc8303a),
  redDark: material('red-dark', 0x8e1f2a),
  green: material('green', 0x2f7d4b),
  white: material('white', 0xfaf7f2),
  skin: material('skin', 0xf1c7a5),
  tin: material('tin', 0x8f9aa6, { rough: 0.5 }),
  fur: material('fur', 0x8b5d3a),
  furLight: material('fur-light', 0xdcc09a),
  antler: material('antler', 0xd8bd8e),
  sack: material('sack', 0xa07a52),
  star: material('star', 0xfff0b5, { glow: 1, emissive: 0xffd36b }),
  sparkle: material('sparkle', 0xfff3c8, { glow: 1, emissive: 0xffe08a }),
  bauble: material('bauble', 0xe6bb4c, { glow: 0.3, rough: 0.4 }),
  snowball: material('snowball', 0xf4f9ff, { glow: 0.35, emissive: 0xc9ecff }),
  halo: material('halo', 0xffe08a),
  core: material('core', 0x9fe8ff),
  plaster: material('plaster', 0xece3d3),
  // The tops of the islands, inside their snow.
  frost: material('frost', 0x8fa98a),
  moss: material('moss', 0x6c8c70),
  straw: material('straw', 0xa39f7e),
  // The world tints these: provider in an agent's provider's color, repo
  // and repo-glow in a terrace's repo's color, repo-glow glowing too.
  provider: material('provider', 0xffffff, { both: true }),
  repo: material('repo', 0xffffff),
  repoGlow: material('repo-glow', 0xffffff, { glow: 0.85 }),
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

/** A hash of a point, the same for every vertex at that point, from 0 to 1. */
function hash(x, y, z, seed) {
  let h = seed * 374761393
  for (const v of [x, y, z]) {
    h = Math.imul(h ^ Math.round(v * 1000), 668265263)
    h ^= h >>> 15
  }
  return ((h >>> 0) % 100000) / 100000
}

/** A seeded random number generator, from 0 to 1. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

/**
 * Loose triangles, each turned to face away from a point inside the solid
 * it bounds, so none is culled from the side it is seen from.
 */
class Tris {
  constructor() {
    this.v = []
  }
  /** Adds triangle a b c, facing away from inside, a point or a function of the triangle's centroid. */
  add(a, b, c, inside) {
    if (inside) {
      const n = V().crossVectors(V().subVectors(b, a), V().subVectors(c, a))
      const g = V().add(a).add(b).add(c).multiplyScalar(1 / 3)
      const at = typeof inside === 'function' ? inside(g) : inside
      if (n.dot(V().subVectors(g, at)) < 0) [b, c] = [c, b]
    }
    for (const p of [a, b, c]) this.v.push(p.x, p.y, p.z)
    return this
  }
  get empty() {
    return this.v.length === 0
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.v, 3))
    return g
  }
}

/** Triangles facing up. */
const below = (g) => V(g.x, g.y - 1, g.z)

/** A triangular prism: a polygon in x and y, from z = -depth/2 to depth/2. */
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

/** A rod from a to b, radius thick, with sides faces round it. */
function rod(a, b, radius, sides = 4) {
  const A = V(...a)
  const B = V(...b)
  const len = A.distanceTo(B)
  const geo = new THREE.CylinderGeometry(radius, radius, len, sides)
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V().subVectors(B, A).normalize()))
  const mid = A.add(B).multiplyScalar(0.5)
  geo.translate(mid.x, mid.y, mid.z)
  return geo
}

/** A low-poly ball. */
const ball = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail)

/**
 * A tube through points, sides faces round, its frame carried along without
 * twisting. pick(s, k) puts each face, by its arc length s and its place k
 * round the tube, in one of buckets geometries, which it returns.
 */
function sweep(points, radius, sides, { pick = () => 0, buckets = 1, caps = true } = {}) {
  const P = points.map((p) => (p.isVector3 ? p.clone() : V(...p)))
  const n = P.length
  const s = [0]
  for (let i = 1; i < n; i++) s.push(s[i - 1] + P[i].distanceTo(P[i - 1]))
  const tan = P.map((_, i) => V().subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize())
  const nrm = Math.abs(tan[0].y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)
  const rings = []
  for (let i = 0; i < n; i++) {
    nrm.addScaledVector(tan[i], -nrm.dot(tan[i])).normalize()
    const bin = V().crossVectors(tan[i], nrm)
    const r = typeof radius === 'function' ? radius(s[i] / s[n - 1]) : radius
    const ring = []
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU
      ring.push(P[i].clone().addScaledVector(nrm, Math.cos(a) * r).addScaledVector(bin, Math.sin(a) * r))
    }
    rings.push(ring)
  }
  const out = Array.from({ length: buckets }, () => new Tris())
  for (let i = 0; i < n - 1; i++) {
    const axis = (g) => {
      // The point on the tube's axis nearest the face, which it faces away from.
      const d = V().subVectors(P[i + 1], P[i])
      const t = Math.max(0, Math.min(1, V().subVectors(g, P[i]).dot(d) / Math.max(d.lengthSq(), 1e-9)))
      return P[i].clone().addScaledVector(d, t)
    }
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides
      const [a, b, c, d] = [rings[i][k], rings[i + 1][k], rings[i + 1][k1], rings[i][k1]]
      out[pick(s[i] + (2 / 3) * (s[i + 1] - s[i]), k + 2 / 3)].add(a, b, c, axis)
      out[pick(s[i] + (1 / 3) * (s[i + 1] - s[i]), k + 1 / 3)].add(a, c, d, axis)
    }
  }
  if (caps) {
    for (const [i, back] of [
      [0, P[0].clone().add(tan[0])],
      [n - 1, P[n - 1].clone().sub(tan[n - 1])],
    ]) {
      for (let k = 0; k < sides; k++) out[pick(s[i], k)].add(P[i], rings[i][k], rings[i][(k + 1) % sides], back)
    }
  }
  return out.map((t) => (t.empty ? null : t.geometry()))
}

/** A five-pointed star in x and y, thick deep at its middle and thin at its points. */
function starGeometry(outer, inner, thick) {
  const t = new Tris()
  const front = V(0, 0, thick / 2)
  const back = V(0, 0, -thick / 2)
  const rim = []
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * TAU
    const r = i % 2 ? inner : outer
    rim.push(V(Math.cos(a) * r, Math.sin(a) * r, 0))
  }
  for (let i = 0; i < 10; i++) {
    const [a, b] = [rim[i], rim[(i + 1) % 10]]
    t.add(front, a, b, V(0, 0, -1))
    t.add(back, a, b, V(0, 0, 1))
  }
  return t.geometry()
}

// ---- writing ---------------------------------------------------------------

// Every number written is rounded to a millionth first. Math.hypot and
// fractional powers can differ in their last bit between Node versions and
// machines, and CI checks that models.glb is exactly what this script
// builds; rounded, it is the same wherever it is built. Adding 0 makes -0 0.
const q = (v) => Math.round(v * 1e6) / 1e6 + 0
const qs = (list) => Array.from(list, q)

let triangles = 0

/**
 * Positions rounded, with each corner shared by faces written once, and the
 * index of each face's corners in them. With no normals the faces still
 * draw flat.
 */
function weld(geo) {
  const pos = geo.getAttribute('position')
  const seen = new Map()
  const corners = []
  const index = []
  for (let i = 0; i < geo.index.count; i++) {
    const v = geo.index.getX(i)
    const p = [q(pos.getX(v)), q(pos.getY(v)), q(pos.getZ(v))]
    const key = p.join(',')
    let n = seen.get(key)
    if (n === undefined) {
      n = corners.length / 3
      seen.set(key, n)
      corners.push(...p)
    }
    index.push(n)
  }
  return { corners, index }
}

/** A glTF mesh with one primitive per material, each from the geometries given for it. */
function mesh(name, parts) {
  const m = doc.createMesh(name)
  for (const [mat, list] of parts) {
    const geos = list.filter(Boolean)
    if (!geos.length) continue
    const { corners, index } = weld(mergeGeometries(geos.map((x) => prep(x.index ? x.toNonIndexed() : x))))
    const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(corners)).setBuffer(buffer)
    const n = corners.length / 3
    const idx = doc.createAccessor().setType('SCALAR').setArray(n < 65536 ? new Uint16Array(index) : new Uint32Array(index)).setBuffer(buffer)
    m.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mat))
    triangles += index.length / 3
  }
  return m
}

function node(name, { mesh: m, at = [0, 0, 0], rot, scale, children = [] } = {}) {
  const n = doc.createNode(name).setTranslation(qs(at))
  if (m) n.setMesh(m)
  if (rot) n.setRotation(qs(rot))
  if (scale) n.setScale(qs(scale))
  for (const c of children) n.addChild(c)
  return n
}

const tally = []

function model(n) {
  scene.addChild(n)
  tally.push([n.getName(), triangles])
  return n
}

const E = (x, y, z) => new THREE.Euler(x, y, z)
const quat = (x, y, z) => new THREE.Quaternion().setFromEuler(E(x, y, z)).toArray()

/**
 * A channel of a clip: how one node's translation, rotation, or scale goes
 * for t from 0 to 1, sampled steps times. Rotations are Eulers; the others
 * are [x, y, z].
 */
function track(target, path, value, steps = 24) {
  const values = []
  let last = null
  for (let i = 0; i <= steps; i++) {
    const v = value(i / steps)
    if (path === 'rotation') {
      const turn = new THREE.Quaternion().setFromEuler(v)
      // Each turn takes the short way from the one before.
      if (last && last.dot(turn) < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w)
      last = turn
      values.push(turn.x, turn.y, turn.z, turn.w)
    } else values.push(...v)
  }
  return { target, path, values, steps }
}

/** A looping clip of seconds, playing every track given. */
function clip(name, seconds, ...tracks) {
  const anim = doc.createAnimation(name)
  for (const tr of tracks) {
    const times = Array.from({ length: tr.steps + 1 }, (_, i) => (i / tr.steps) * seconds)
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(qs(times))).setBuffer(buffer)
    const output = doc
      .createAccessor()
      .setType(tr.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(new Float32Array(qs(tr.values)))
      .setBuffer(buffer)
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR')
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(tr.target).setTargetPath(tr.path).setSampler(sampler))
  }
  return anim
}

const wave = (t, phase = 0) => Math.sin(t * TAU + phase)

// ---- snowy pines, at any size -----------------------------------------------------

/**
 * A pine in tiers, each with snow on its top, about 1.45 tall at scale 1,
 * returned as [bark, needles, snow] geometries.
 */
function pineParts({ x = 0, y = 0, z = 0, s = 1, ry = 0, tiers = 3, sides = 7 } = {}) {
  const bark = [T(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 5), { y: 0.17 })]
  const needles = []
  const snow = []
  const levels = [
    [0.52, 0.62, 0.2],
    [0.4, 0.52, 0.56],
    [0.27, 0.42, 0.88],
  ].slice(3 - tiers)
  levels.forEach(([r, h, base], i) => {
    needles.push(T(new THREE.ConeGeometry(r, h, sides), { y: base + h / 2, ry: i * 0.5 }))
    // The same slope as the tier, so the snow lies on it as a layer.
    const k = 0.5
    snow.push(T(new THREE.ConeGeometry(r * k, h * k, sides), { y: base + h - (h * k) / 2 + 0.02, ry: i * 0.5 }))
  })
  for (const g of [...bark, ...needles, ...snow]) T(g, { s, ry, x, y, z })
  return [bark, needles, snow]
}

// ---- the citadel: a snowy mountain with a ski run and a chairlift -------------------

const CIT = {
  radius: 8.6,
  depth: 9.6,
  rings: 32,
  segments: 72,
  peak: { at: [-1.2, -1.2], height: 11.5, radius: 6.6, power: 1.35 },
  shoulders: [
    { at: [2.5, -3.0], height: 5.4, radius: 3.7, power: 1.4 },
    { at: [-4.4, 1.6], height: 4.2, radius: 3.4, power: 1.3 },
  ],
}

function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + (h * h * k) / 4
}

/** The mountain's height at x, z, before the surface's facets are jittered. */
function mountain(x, z) {
  const p = CIT.peak
  const d1 = Math.hypot(x - p.at[0], z - p.at[1]) / p.radius
  const a = Math.atan2(z - p.at[1], x - p.at[0])
  // Ridges round the peak, none at the summit itself.
  const ridge = 1 + d1 * (0.2 * Math.sin(5 * a + 0.7) + 0.1 * Math.sin(9 * a + 2.1))
  const h1 = d1 >= 1 ? 0 : p.height * (1 - d1) ** p.power * ridge
  let h = h1
  for (const q of CIT.shoulders) {
    const d2 = Math.hypot(x - q.at[0], z - q.at[1]) / q.radius
    h = smax(h, d2 >= 1 ? 0 : q.height * (1 - d2) ** q.power, 0.9) - 0.9 / 4 // smax lifts flat ground by k/4
  }
  return h
}

/**
 * The vertices of the citadel's top, ring by ring out from the peak, so its
 * facets run down the mountain's slopes. Each spoke reaches the round edge
 * of the top, wherever the peak is on it.
 */
function citadelGrid() {
  const [cx, cz] = CIT.peak.at
  const reach = (a) => {
    const cu = cx * Math.cos(a) + cz * Math.sin(a)
    return -cu + Math.sqrt(cu * cu - (cx * cx + cz * cz) + CIT.radius ** 2)
  }
  const grid = []
  for (let j = 0; j <= CIT.rings; j++) {
    const ring = []
    for (let i = 0; i < CIT.segments; i++) {
      const a = (i / CIT.segments) * TAU
      const d = (j / CIT.rings) * reach(a)
      const [x, z] = [cx + Math.cos(a) * d, cz + Math.sin(a) * d]
      let y = Math.max(0, mountain(x, z))
      if (y > 0.25 && j > 0) y += (hash(x, 0, z, 5) - 0.5) * 0.3
      ring.push(V(x, j === CIT.rings ? 0 : y, z))
      if (j === 0) break
    }
    grid.push(ring)
  }
  return grid
}

const GRID = citadelGrid()

/** The faces of the citadel's top, as [a, b, c] triangles. */
function citadelFaces() {
  const faces = []
  const at = (j, i) => (j === 0 ? GRID[0][0] : GRID[j][i % CIT.segments])
  for (let j = 0; j < CIT.rings; j++) {
    for (let i = 0; i < CIT.segments; i++) {
      if (j === 0) faces.push([at(0, 0), at(1, i), at(1, i + 1)])
      else {
        faces.push([at(j, i), at(j + 1, i), at(j + 1, i + 1)])
        faces.push([at(j, i), at(j + 1, i + 1), at(j, i + 1)])
      }
    }
  }
  return faces
}

const FACES = citadelFaces()

/** The height of the citadel's top as drawn, at x, z. */
function surfaceY(x, z) {
  for (const [a, b, c] of FACES) {
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
    if (Math.abs(d) < 1e-12) continue
    const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d
    const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d
    const wc = 1 - wa - wb
    if (wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6) return wa * a.y + wb * b.y + wc * c.y
  }
  return 0
}

/** A point at distance d from the peak, toward angle a. */
const fromPeak = (a, d) => [CIT.peak.at[0] + Math.cos(a) * d, CIT.peak.at[1] + Math.sin(a) * d]

// The chairlift climbs straight toward the peak from the flat ground at its foot.
const LIFT_A = Math.PI / 4
const LIFT_BASE = fromPeak(LIFT_A, 7.3)
const LIFT_TOP = fromPeak(LIFT_A, 1.85)
const LIFT_ACROSS = [-Math.sin(LIFT_A), Math.cos(LIFT_A)]
const LIFT_GAP = 0.34

// Two runs wind down beside it.
const RUNS = [
  { width: 1.05, at: (t) => fromPeak(LIFT_A + 0.5 + 0.3 * Math.sin(2.6 * Math.PI * t + 0.2), 1.5 + 5.6 * t) },
  { width: 0.95, at: (t) => fromPeak(LIFT_A - 0.55 - 0.22 * Math.sin(2 * Math.PI * t + 0.4), 1.5 + 5.4 * t) },
].map((run) => ({ ...run, line: Array.from({ length: 61 }, (_, i) => run.at(i / 60)) }))

function distToLine(x, z, line) {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const [dx, dz] = [bx - ax, bz - az]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
  }
  return best
}

const onRun = (x, z, pad = 0) => RUNS.some((r) => distToLine(x, z, r.line) < r.width / 2 + pad)

const LODGE = { at: [6.1, 1.3], ry: -0.9 }

// The lift's huts: out past the bottom bullwheel, and beside the top one, along the slope.
const HUTS = [
  [LIFT_BASE[0] + Math.cos(LIFT_A) * 0.9, LIFT_BASE[1] + Math.sin(LIFT_A) * 0.9],
  [LIFT_TOP[0] - LIFT_ACROSS[0] * 1.05, LIFT_TOP[1] - LIFT_ACROSS[1] * 1.05],
]

// Where no pine grows: round the lodge, the lift's bottom, and its huts.
const CLEAR = [[...LODGE.at, 1.7], [...LIFT_BASE, 1.0], [...HUTS[0], 1.0], [...HUTS[1], 0.9]]

function citadel() {
  const snow = new Tris()
  const drift = new Tris()
  const piste = new Tris()
  const rock = new Tris()
  const rockDark = new Tris()
  for (const [a, b, c] of FACES) {
    const g = V().add(a).add(b).add(c).multiplyScalar(1 / 3)
    const n = V().crossVectors(V().subVectors(b, a), V().subVectors(c, a)).normalize()
    const up = Math.abs(n.y)
    const h = hash(g.x, g.y, g.z, 9)
    let to = h < 0.3 ? drift : snow
    if (g.y > 0.08 && onRun(g.x, g.z)) to = piste
    else if (up < 0.5 && h < 0.75) to = h < 0.35 ? rockDark : rock
    else if (up < 0.62 && g.y > 2.5 && h < 0.3) to = rock
    to.add(a, b, c, below)
  }

  // Under it, a floating rock with a lip of snow and icicles.
  const shell = underside({ edge: GRID[CIT.rings], depth: CIT.depth, lip: [0.24, 0.5], seed: 77, rough: 0.3, icicles: 54, icicleLen: [0.5, 1.4], icicleR: 0.13 })

  // Pines on the lower slopes and the flat ground, but not on the runs, under the lift, or by the buildings.
  const r = rng(4242)
  const trees = []
  const bark = []
  const needles = []
  const needlesDark = []
  const treeSnow = []
  const liftLine = [LIFT_BASE, LIFT_TOP]
  for (let tries = 0; tries < 6000 && trees.length < 230; tries++) {
    const a = r() * TAU
    const d = Math.sqrt(r()) * (CIT.radius - 0.5)
    const [x, z] = [Math.cos(a) * d, Math.sin(a) * d]
    const y = surfaceY(x, z)
    if (y > 6.4) continue
    if (onRun(x, z, 0.35)) continue
    if (distToLine(x, z, liftLine) < 0.75) continue
    if (CLEAR.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)) continue
    if (y < 0.05 && r() < 0.6) continue // fewer on the flat
    if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.42)) continue
    trees.push([x, z])
    const s = 0.38 + r() * 0.36 + (y < 3 ? 0.1 : 0)
    const [b, n, sn] = pineParts({ x, y: y - 0.06, z, s, ry: r() * TAU, tiers: 2 + (r() < 0.5 ? 1 : 0), sides: 5 })
    bark.push(...b)
    ;(trees.length % 3 ? needles : needlesDark).push(...n)
    treeSnow.push(...sn)
  }

  // The lodge at the foot of the runs.
  const lodge = chalet({ w: 1.9, d: 1.25, h: 0.95, at: LODGE.at, ry: LODGE.ry })

  // The chairlift: stations at each end, towers between, and the haul rope.
  const steel = []
  const wood = []
  const roof = []
  const roofSnow = []
  const windows = []
  const [bx, bz] = LIFT_BASE
  const [tx, tz] = LIFT_TOP
  const baseY = 1.35
  const topGround = surfaceY(tx, tz)
  const topY = topGround + 1.15
  const along = (t) => [bx + (tx - bx) * t, bz + (tz - bz) * t]
  // Each support's height: the straight line between the bullwheels, or higher where the slope comes near.
  const supports = [0, 0.19, 0.38, 0.57, 0.77, 1].map((t) => {
    const [x, z] = along(t)
    return { t, x, z, ground: surfaceY(x, z), y: baseY + (topY - baseY) * t }
  })
  for (const sp of supports.slice(1, -1)) sp.y = Math.max(sp.y, sp.ground + 1.75)
  const across = (x, z, side, y) => V(x + LIFT_ACROSS[0] * LIFT_GAP * side, y, z + LIFT_ACROSS[1] * LIFT_GAP * side)
  for (const sp of supports.slice(1, -1)) {
    steel.push(rod([sp.x, sp.ground - 0.3, sp.z], [sp.x, sp.y + 0.12, sp.z], 0.07, 5))
    steel.push(rod([...across(sp.x, sp.z, -1.25, sp.y + 0.1).toArray()], [...across(sp.x, sp.z, 1.25, sp.y + 0.1).toArray()], 0.05, 4))
  }
  // A bullwheel at each end, and a hut by it, level with the highest ground under it and on stilts where the slope falls away.
  for (const [[x, z, ground, wheelY], [hx, hz]] of [
    [[bx, bz, 0, baseY], HUTS[0]],
    [[tx, tz, topGround, topY], HUTS[1]],
  ]) {
    steel.push(rod([x, ground - 0.4, z], [x, wheelY + 0.05, z], 0.1, 6))
    steel.push(T(new THREE.CylinderGeometry(LIFT_GAP + 0.04, LIFT_GAP + 0.04, 0.07, 12), { x, y: wheelY + 0.02, z }))
    const feet = [
      [-0.4, -0.35],
      [0.4, -0.35],
      [0.4, 0.35],
      [-0.4, 0.35],
    ].map(([u, v]) => {
      const [fx, fz] = [hx + Math.cos(LIFT_A) * u + LIFT_ACROSS[0] * v, hz + Math.sin(LIFT_A) * u + LIFT_ACROSS[1] * v]
      return [fx, surfaceY(fx, fz), fz]
    })
    const bottom = Math.max(...feet.map((f) => f[1])) - 0.1
    const top = bottom + 0.85
    wood.push(T(new THREE.BoxGeometry(0.9, top - bottom, 0.8), { x: hx, y: (top + bottom) / 2, z: hz, ry: -LIFT_A }))
    for (const [fx, fy, fz] of feet) if (bottom - fy > 0.05) wood.push(rod([fx, fy - 0.15, fz], [fx, bottom + 0.05, fz], 0.05, 4))
    roof.push(T(prism([[-0.55, 0], [0.55, 0], [0, 0.38]], 1.0), { x: hx, y: top, z: hz, ry: -LIFT_A + Math.PI / 2 }))
    roofSnow.push(T(prism([[-0.48, 0.06], [0.48, 0.06], [0, 0.43]], 0.94), { x: hx, y: top, z: hz, ry: -LIFT_A + Math.PI / 2 }))
    // Lit windows, at each end of the hut.
    for (const side of [-1, 1]) windows.push(T(new THREE.BoxGeometry(0.06, 0.22, 0.5), { x: hx + Math.cos(LIFT_A) * 0.45 * side, y: top - 0.32, z: hz + Math.sin(LIFT_A) * 0.45 * side, ry: -LIFT_A }))
  }
  // The haul rope, up one side and down the other.
  const rope = []
  for (const side of [1, -1]) {
    for (let i = 0; i < supports.length - 1; i++) {
      const [p, q] = [supports[i], supports[i + 1]]
      rope.push(rod(across(p.x, p.z, side, p.y).toArray(), across(q.x, q.z, side, q.y).toArray(), 0.025, 3))
    }
  }

  // The chairs, going round: up on the +across side, round the top wheel, down, round the bottom.
  const loop = []
  for (const sp of supports) loop.push(across(sp.x, sp.z, 1, sp.y))
  for (let k = 1; k < 8; k++) {
    const a = (k / 8) * Math.PI
    const c = Math.cos(a)
    const s = Math.sin(a)
    // Round the top wheel, past the station on the uphill side.
    loop.push(V(tx + LIFT_ACROSS[0] * LIFT_GAP * c - Math.cos(LIFT_A) * LIFT_GAP * s, topY, tz + LIFT_ACROSS[1] * LIFT_GAP * c - Math.sin(LIFT_A) * LIFT_GAP * s))
  }
  for (const sp of [...supports].reverse()) loop.push(across(sp.x, sp.z, -1, sp.y))
  for (let k = 1; k < 8; k++) {
    const a = (k / 8) * Math.PI
    loop.push(V(bx - LIFT_ACROSS[0] * LIFT_GAP * Math.cos(a) + Math.cos(LIFT_A) * LIFT_GAP * Math.sin(a), baseY, bz - LIFT_ACROSS[1] * LIFT_GAP * Math.cos(a) + Math.sin(LIFT_A) * LIFT_GAP * Math.sin(a)))
  }
  loop.push(loop[0].clone())
  const lens = [0]
  for (let i = 1; i < loop.length; i++) lens.push(lens[i - 1] + loop[i].distanceTo(loop[i - 1]))
  const total = lens[lens.length - 1]
  const onLoop = (u) => {
    const s = (((u % 1) + 1) % 1) * total
    let i = 1
    while (lens[i] < s) i++
    const t = (s - lens[i - 1]) / (lens[i] - lens[i - 1])
    const p = loop[i - 1].clone().lerp(loop[i], t)
    const dir = V().subVectors(loop[i], loop[i - 1])
    return { p, yaw: Math.atan2(-dir.z, dir.x) }
  }
  const chairMesh = mesh('chair', [
    [M.steel, [T(new THREE.BoxGeometry(0.03, 0.5, 0.03), { y: -0.25 }), T(new THREE.BoxGeometry(0.03, 0.03, 0.46), { y: -0.5 }), T(new THREE.BoxGeometry(0.2, 0.025, 0.025), { x: 0.06, y: -0.3, z: 0 })]],
    [M.red, [T(new THREE.BoxGeometry(0.22, 0.04, 0.48), { x: 0.02, y: -0.55 }), T(new THREE.BoxGeometry(0.04, 0.2, 0.48), { x: -0.09, y: -0.44 })]],
  ])
  const CHAIRS = 14
  const LOOP_SECONDS = 70
  const chairs = []
  const chairTracks = []
  for (let c = 0; c < CHAIRS; c++) {
    const at = onLoop(c / CHAIRS)
    const chair = node(`citadel.chair.${c}`, { mesh: chairMesh, at: at.p.toArray(), rot: quat(0, at.yaw, 0) })
    chairs.push(chair)
    chairTracks.push(track(chair, 'translation', (t) => onLoop(t + c / CHAIRS).p.toArray(), 96))
    chairTracks.push(track(chair, 'rotation', (t) => E(0, onLoop(t + c / CHAIRS).yaw, 0), 96))
  }
  clip('citadel.chairlift', LOOP_SECONDS, ...chairTracks)

  // Two skiers carving down the runs, who vanish at the bottom and start again at the top.
  const skiers = RUNS.map((run, k) => {
    const jacket = [M.red, M.green][k]
    const body = mesh(`skier.${k}`, [
      [jacket, [T(new THREE.CylinderGeometry(0.07, 0.1, 0.3, 5), { y: 0.3, rz: 0.25 })]],
      [M.skin, [T(ball(0.07, 0), { x: 0.05, y: 0.5 })]],
      [M.coal, [T(new THREE.BoxGeometry(0.5, 0.02, 0.05), { y: 0.03, z: 0.07 }), T(new THREE.BoxGeometry(0.5, 0.02, 0.05), { y: 0.03, z: -0.07 }), rod([0.0, 0.28, 0.14], [-0.15, 0.02, 0.2], 0.01, 3), rod([0.0, 0.28, -0.14], [-0.15, 0.02, -0.2], 0.01, 3)]],
      [M.white, [T(new THREE.ConeGeometry(0.075, 0.1, 5), { x: 0.05, y: 0.58 })]],
    ])
    const n = node(`citadel.skier.${k}`, { mesh: body })
    // Down the run, swinging from side to side across it.
    const pose = (u) => {
      const t = Math.min(1, u)
      const [x, z] = run.at(t)
      const [x2, z2] = run.at(Math.min(1, t + 0.01))
      const dir = [x2 - x, z2 - z]
      const len = Math.hypot(...dir) || 1
      const side = [-dir[1] / len, dir[0] / len]
      const swing = Math.sin(t * Math.PI * 11) * run.width * 0.3
      const [px, pz] = [x + side[0] * swing, z + side[1] * swing]
      const carve = Math.cos(t * Math.PI * 11) * 0.7
      return { p: [px, surfaceY(px, pz) + 0.03, pz], yaw: Math.atan2(-dir[1], dir[0]) + carve }
    }
    // Most of the clip on the run; then shrunk away, moved to the top, and grown back.
    const RUN = 0.88
    const at = (t) => (t < RUN ? pose(t / RUN) : t < 0.93 ? pose(1) : pose(0))
    const size = (t) => {
      const k = t < RUN ? 1 : t < 0.97 ? 0.001 : Math.max(0.001, (t - 0.97) / 0.03)
      return [k, k, k]
    }
    const steps = 120
    clip(`citadel.skier.${k}`, 26 + k * 5, track(n, 'translation', (t) => at(t).p, steps), track(n, 'rotation', (t) => E(0, at(t).yaw, 0), steps), track(n, 'scale', size, steps))
    return n
  })

  // A star on the summit, which is the beacon.
  const [px, pz] = CIT.peak.at
  const summit = surfaceY(px, pz)
  const starY = summit + 1.35
  steel.push(rod([px, summit - 0.4, pz], [px, starY - 0.5, pz], 0.06, 5))
  const star = node('citadel.star', { mesh: mesh('star', [[M.star, [starGeometry(0.85, 0.36, 0.34)]]]) })
  clip('citadel.star', 12, track(star, 'rotation', (t) => E(0, t * TAU, 0), 12))
  const beacon = node('beacon', { at: [px, starY, pz], children: [star] })
  const halo = node('halo', { mesh: mesh('halo', [[M.halo, [new THREE.SphereGeometry(0.6, 14, 10)]]]), at: [px, starY, pz] })

  return model(
    node('citadel', {
      mesh: mesh('citadel', [
        [M.snow, [snow.geometry(), shell.snow, ...treeSnow, ...lodge.snow, ...roofSnow]],
        [M.drift, [drift.geometry()]],
        [M.piste, [piste.geometry()]],
        [M.rock, [rock.geometry(), shell.rock]],
        [M.rockDark, [rockDark.geometry(), shell.rockDark]],
        [M.icicle, [shell.icicles]],
        [M.bark, bark],
        [M.pine, needles],
        [M.pineDark, needlesDark],
        [M.wood, [...lodge.wood, ...wood]],
        [M.roof, [...lodge.roof, ...roof]],
        [M.window, [...lodge.windows, ...windows]],
        [M.steel, [...steel, ...rope]],
      ]),
      children: [beacon, halo, ...chairs, ...skiers, node('core', { mesh: mesh('core', [[M.core, [T(new THREE.OctahedronGeometry(0.9), { s: 1.7 })]]]), at: [0, -CIT.depth - 2.2, 0] })],
    }),
  )
}

/** A chalet: wooden walls, lit windows, a steep roof under snow, and a chimney. */
function chalet({ w, d, h, at: [x, z], ry, y = 0 }) {
  const place = (g) => T(g, { ry, x, y, z })
  const wood = [place(T(new THREE.BoxGeometry(w, h, d), { y: h / 2 })), place(T(new THREE.BoxGeometry(0.22, 0.6, 0.22), { x: w * 0.28, y: h + 0.55, z: d * 0.15 }))]
  const roof = [place(T(prism([[-d / 2 - 0.14, 0], [d / 2 + 0.14, 0], [0, d * 0.62]], w + 0.24), { y: h, ry: Math.PI / 2 }))]
  const snow = [
    place(T(prism([[-d / 2 - 0.02, 0.07], [d / 2 + 0.02, 0.07], [0, d * 0.62 + 0.09]], w + 0.12), { y: h, ry: Math.PI / 2 })),
    place(T(new THREE.BoxGeometry(0.27, 0.07, 0.27), { x: w * 0.28, y: h + 0.88, z: d * 0.15 })),
  ]
  const windows = []
  for (const wx of [-0.55, 0, 0.55].map((f) => f * w * 0.7)) {
    windows.push(place(T(new THREE.BoxGeometry(0.22, 0.28, 0.04), { x: wx, y: h * 0.52, z: d / 2 + 0.01 })))
    windows.push(place(T(new THREE.BoxGeometry(0.22, 0.28, 0.04), { x: wx, y: h * 0.52, z: -d / 2 - 0.01 })))
  }
  return { wood, roof, snow, windows }
}

/**
 * The underside of an island or the citadel: a lip of snow over the edge,
 * a jagged rock below, streaked with snow, and icicles hanging from the lip.
 * edge is the top's rim, its points in order round the y axis at y = 0.
 */
function underside({ edge, depth, lip: [out, drop], seed, rough, icicles, icicleLen, icicleR }) {
  const segments = edge.length
  /** The rim's i'th point moved d out from the y axis, at height y. */
  const off = (i, d, y, k = 1) => {
    const e = edge[((i % segments) + segments) % segments]
    const r = Math.hypot(e.x, e.z)
    const f = ((r + d) / r) * k
    return V(e.x * f, y, e.z * f)
  }
  const snow = new Tris()
  const rock = new Tris()
  const rockDark = new Tris()
  const axis = (g) => V(0, g.y, 0)
  // The lip: from the top's edge, out and down, then back in under it.
  const rim = (i) => off(i, 0, 0)
  const bulge = (i) => off(i, out, -drop * 0.35)
  const under = (i) => off(i, -out * 0.3, -drop)
  for (let i = 0; i < segments; i++) {
    for (const [p, q] of [
      [rim, bulge],
      [bulge, under],
    ]) {
      snow.add(p(i), q(i), q(i + 1), axis)
      snow.add(p(i), q(i + 1), p(i + 1), axis)
    }
  }
  // The rock, in rings narrowing to a point.
  const levels = [
    [1, -drop],
    [0.86, -drop - (depth - drop) * 0.22],
    [0.66, -drop - (depth - drop) * 0.47],
    [0.38, -drop - (depth - drop) * 0.75],
  ]
  const rings = levels.map(([k, y], j) =>
    Array.from({ length: segments }, (_, i) => {
      if (j === 0) return under(i)
      const wob = 1 + (hash(i, j, 0, seed) - 0.5) * rough
      return off(i, -out * 0.3, y + (hash(j, i, 1, seed) - 0.5) * rough * (depth / 6), k * wob)
    }),
  )
  const tip = V(0, -depth, 0)
  const face = (a, b, c, j) => {
    const g = V().add(a).add(b).add(c).multiplyScalar(1 / 3)
    const h = hash(g.x, g.y, g.z, seed + 2)
    const to = j < 2 && h < 0.22 ? snow : h < 0.45 ? rockDark : rock
    to.add(a, b, c, axis)
  }
  for (let j = 0; j < rings.length; j++) {
    for (let i = 0; i < segments; i++) {
      const i1 = (i + 1) % segments
      if (j === rings.length - 1) face(rings[j][i], tip, rings[j][i1], j)
      else {
        face(rings[j][i], rings[j + 1][i], rings[j + 1][i1], j)
        face(rings[j][i], rings[j + 1][i1], rings[j][i1], j)
      }
    }
  }
  // Icicles along the lip, of different lengths.
  const ice = []
  for (let k = 0; k < icicles; k++) {
    const f = ((k + hash(k, 3, 0, seed) * 0.6) / icicles) * segments
    const i = Math.floor(f)
    const p = off(i, -out * 0.1, 0).lerp(off(i + 1, -out * 0.1, 0), f - i)
    const len = icicleLen[0] + (icicleLen[1] - icicleLen[0]) * hash(k, 4, 0, seed)
    ice.push(T(new THREE.ConeGeometry(icicleR, len, 4), { rx: Math.PI, x: p.x, y: -drop * 0.6 - len / 2, z: p.z }))
  }
  return { snow: snow.geometry(), rock: rock.geometry(), rockDark: rockDark.geometry(), icicles: mergeGeometries(ice.map(prep)) }
}

// ---- islands: radius 1, top at 0, reaching down to -1, with snow round the edge -------

const coreMesh = mesh('island-core', [[M.core, [new THREE.OctahedronGeometry(0.9)]]])

function island(name, { sides, top, seed, rough }) {
  const segments = sides * 4
  // One radius per corner, shared by the top and the rock, so they meet.
  const corner = (c) => 1 + (hash(c, 0, 0, seed) - 0.5) * 0.2
  const radius = (i) => {
    const f = (i / segments) * sides
    const c = Math.floor(f)
    const t = f - c
    return corner(c % sides) * (1 - t) + corner((c + 1) % sides) * t
  }
  const at = (i, k) => {
    const a = (i / segments) * TAU
    const r = radius(i % segments) * k
    return V(Math.cos(a) * r, 0, Math.sin(a) * r)
  }
  // The snow comes in from the edge by a different amount at each step round.
  const reach = (i) => 0.76 + 0.12 * hash(i % segments, 1, 0, seed)
  const ground = new Tris()
  const snow = new Tris()
  const drift = new Tris()
  const mid = V(0, 0, 0)
  for (let i = 0; i < segments; i++) {
    const i1 = i + 1
    ground.add(mid, at(i, 0.45), at(i1, 0.45), below)
    ground.add(at(i, 0.45), at(i, reach(i)), at(i1, reach(i1)), below)
    ground.add(at(i, 0.45), at(i1, reach(i1)), at(i1, 0.45), below)
    const to = hash(i, 2, 0, seed) < 0.3 ? drift : snow
    to.add(at(i, reach(i)), at(i, 1), at(i1, 1), below)
    to.add(at(i, reach(i)), at(i1, 1), at(i1, reach(i1)), below)
  }
  const shell = underside({ edge: Array.from({ length: segments }, (_, i) => at(i, 1)), depth: 1, lip: [0.03, 0.06], seed, rough, icicles: segments, icicleLen: [0.03, 0.12], icicleR: 0.013 })
  return model(
    node(name, {
      mesh: mesh(name, [
        [top, [ground.geometry()]],
        [M.snow, [snow.geometry(), shell.snow]],
        [M.drift, [drift.geometry()]],
        [M.rock, [shell.rock]],
        [M.rockDark, [shell.rockDark]],
        [M.icicle, [shell.icicles]],
      ]),
      children: [node('core', { mesh: coreMesh, at: [0, -1.25, 0] })],
    }),
  )
}

// ---- scenery ------------------------------------------------------------------

function pine() {
  const [bark, needles, snow] = pineParts()
  return model(
    node('pine', {
      mesh: mesh('pine', [
        [M.bark, bark],
        [M.pine, needles],
        [M.snow, snow],
      ]),
    }),
  )
}

function drift() {
  const mound = jitter(T(new THREE.SphereGeometry(0.5, 9, 4, 0, TAU, 0, Math.PI / 2), { sx: 1, sy: 0.32, sz: 0.7 }), 0.25, 3, (_x, y) => y < 0.01)
  const small = jitter(T(new THREE.SphereGeometry(0.28, 7, 3, 0, TAU, 0, Math.PI / 2), { sy: 0.35, x: 0.45, z: 0.25 }), 0.25, 4, (_x, y) => y < 0.01)
  return model(node('drift', { mesh: mesh('drift', [[M.snow, [mound, small]]]) }))
}

function boulder() {
  const stone = jitter(T(new THREE.DodecahedronGeometry(0.4, 0), { sy: 0.7, y: 0.18 }), 0.35, 6)
  const cap = jitter(T(new THREE.SphereGeometry(0.33, 7, 3, 0, TAU, 0, Math.PI / 2), { sy: 0.4, y: 0.38 }), 0.2, 7, (_x, y) => y < 0.385)
  return model(
    node('boulder', {
      mesh: mesh('boulder', [
        [M.rock, [stone]],
        [M.snow, [cap]],
      ]),
    }),
  )
}

/** A snowman on the ground, facing +x, with a top hat and a red scarf. */
function snowmanScenery() {
  const body = [T(ball(0.24), { y: 0.21 }), T(ball(0.18), { y: 0.55 }), T(ball(0.13), { y: 0.82 })]
  const coal = [
    T(ball(0.022, 0), { x: 0.115, y: 0.86, z: 0.045 }),
    T(ball(0.022, 0), { x: 0.115, y: 0.86, z: -0.045 }),
    T(ball(0.025, 0), { x: 0.178, y: 0.6 }),
    T(ball(0.025, 0), { x: 0.18, y: 0.5 }),
    T(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 10), { y: 0.93 }),
    T(new THREE.CylinderGeometry(0.09, 0.095, 0.17, 10), { y: 1.02 }),
  ]
  return model(
    node('snowman', {
      mesh: mesh('snowman', [
        [M.snow, body],
        [M.coal, coal],
        [M.carrot, [T(new THREE.ConeGeometry(0.03, 0.17, 5), { rz: -Math.PI / 2, x: 0.2, y: 0.82 })]],
        [M.red, [T(new THREE.TorusGeometry(0.115, 0.035, 5, 12), { rx: Math.PI / 2, y: 0.7 }), T(new THREE.BoxGeometry(0.03, 0.2, 0.07), { x: 0.07, y: 0.6, z: 0.11, rx: 0.2 })]],
        [M.twig, [rod([0, 0.6, 0.15], [0.05, 0.78, 0.42], 0.012, 3), rod([0.04, 0.73, 0.35], [0.1, 0.8, 0.4], 0.008, 3), rod([0, 0.6, -0.15], [0.05, 0.75, -0.42], 0.012, 3)]],
      ]),
    }),
  )
}

// ---- the selection ring's piece: a snowball that bobs ---------------------------------

function ringPiece() {
  const snowball = node('ring.snowball', { mesh: mesh('ring', [[M.snowball, [jitter(ball(0.2, 1), 0.18, 8)]]]) })
  clip('ring.bob', 2.6, track(snowball, 'translation', (t) => [0, 0.07 * wave(t), 0]), track(snowball, 'rotation', (t) => E(0.3 * wave(t, 1), t * TAU, 0)))
  return model(node('ring', { children: [snowball] }))
}

// ---- terraces: an ice rink, ringed by candy canes strung with lights ----------------

/** A rounded rectangle, half-size h, its corners round by r, as a three.js path. */
function roundRect(h, r, path = new THREE.Shape()) {
  path.moveTo(-h + r, -h)
  path.lineTo(h - r, -h)
  path.quadraticCurveTo(h, -h, h, -h + r)
  path.lineTo(h, h - r)
  path.quadraticCurveTo(h, h, h - r, h)
  path.lineTo(-h + r, h)
  path.quadraticCurveTo(-h, h, -h, h - r)
  path.lineTo(-h, -h + r)
  path.quadraticCurveTo(-h, -h, -h + r, -h)
  return path
}

/** A shape in x and z, extruded up from y0 to y1. */
function slab(shape, y0, y1) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y0, 0)
  return geo
}

function ringShape(outer, outerR, inner, innerR) {
  const s = roundRect(outer, outerR)
  s.holes.push(roundRect(inner, innerR, new THREE.Path()))
  return s
}

function plaza() {
  const ice = slab(roundRect(0.47, 0.09), 0, 0.35)
  const boards = slab(ringShape(0.5, 0.12, 0.468, 0.09), 0, 0.43)
  const rail = slab(ringShape(0.505, 0.125, 0.462, 0.085), 0.43, 0.455)
  const paint = 0.352
  const red = [
    T(new THREE.BoxGeometry(0.014, 0.003, 0.93), { y: paint }),
    slab(ringShape(0.09, 0.09, 0.078, 0.078), paint - 0.0015, paint + 0.0015),
  ]
  const blue = [T(new THREE.BoxGeometry(0.012, 0.003, 0.93), { x: 0.17, y: paint }), T(new THREE.BoxGeometry(0.012, 0.003, 0.93), { x: -0.17, y: paint })]
  return model(
    node('plaza', {
      mesh: mesh('plaza', [
        [M.ice, [ice]],
        [M.repo, [boards]],
        [M.white, [rail]],
        [M.lineRed, red],
        [M.lineBlue, blue],
      ]),
    }),
  )
}

// A candy cane, its hook curling along the edge toward +z. The world hangs
// the lights from the top of the hook to the next cane's, at ROPE_AT, as
// theme.json's terrace.rope says.
const CANE = { H: 0.72, R: 0.09 }
const ROPE_AT = [0, CANE.H + CANE.R + 0.01, CANE.R]

function post() {
  const { H, R } = CANE
  const path = []
  for (let y = 0; y < H; y += 0.06) path.push([0, y, 0])
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI
    path.push([0, H + Math.sin(a) * R, R - Math.cos(a) * R])
  }
  path.push([0, H - 0.06, 2 * R])
  const pitch = 0.2
  const sides = 6
  const [white, red] = sweep(path, 0.032, sides, {
    buckets: 2,
    pick: (s, k) => (((Math.floor((s / pitch - k / sides) * 2) % 2) + 2) % 2),
  })
  return model(
    node('post', {
      mesh: mesh('post', [
        [M.caneWhite, [white]],
        [M.caneRed, [red]],
      ]),
    }),
  )
}

/** A light bulb, the bead the world strings along the rope: a socket on the wire and a bulb hanging under it, glowing in the repo's color. */
function bulb() {
  return model(
    node('bulb', {
      mesh: mesh('bulb', [
        [M.wire, [T(new THREE.CylinderGeometry(0.013, 0.013, 0.025, 4), { y: -0.012 })]],
        [M.repoGlow, [T(new THREE.OctahedronGeometry(0.03, 0), { sy: 1.5, y: -0.06 })]],
      ]),
    }),
  )
}

// ---- buildings: a block, which the world stretches, under a snowy chalet roof ------

function building() {
  const roof = prism(
    [
      [-0.6, 0],
      [0.6, 0],
      [0, 0.4],
    ],
    1.14,
  )
  const snow = [
    prism(
      [
        [-0.52, 0.06],
        [0.52, 0.06],
        [0, 0.46],
      ],
      1.08,
    ),
    T(new THREE.BoxGeometry(0.16, 0.05, 0.16), { x: 0.22, y: 0.5, z: 0.22 }),
  ]
  const chimney = [T(new THREE.BoxGeometry(0.13, 0.32, 0.13), { x: 0.22, y: 0.34, z: 0.22 })]
  const icicles = []
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const len = 0.05 + 0.07 * hash(k, side, 0, 21)
      icicles.push(T(new THREE.ConeGeometry(0.018, len, 4), { rx: Math.PI, x: side * 0.58, y: 0.01 - len / 2, z: -0.42 + k * 0.21 }))
    }
  }
  return model(
    node('building', {
      mesh: mesh('building', [[M.plaster, [new THREE.BoxGeometry(1, 1, 1)]]]),
      children: [
        node('cap', {
          mesh: mesh('roof', [
            [M.roof, [roof]],
            [M.snow, snow],
            [M.wood, chimney],
            [M.icicle, icicles],
          ]),
        }),
      ],
    }),
  )
}

// ---- airships: snowman dirigibles, facing +x, their undersides at y = -0.6 ----------

const baubleMesh = mesh('bauble', [[M.bauble, [T(ball(0.06, 1), { y: -0.07 }), T(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 3), { y: -0.0 })]]])

function bags() {
  return [
    [-0.12, 0.12],
    [0.12, 0.12],
    [-0.12, -0.12],
    [0.12, -0.12],
  ].map(([x, z]) => node('bag', { mesh: baubleMesh, at: [x + 0.15, -0.5, z] }))
}

const HEAD = { x: 0.6, y: 0.08, r: 0.25 }

/** A point on the head, az round from the front and el up from its middle. */
const onHead = (az, el, out = 0) => {
  const r = HEAD.r + out
  return { x: HEAD.x + r * Math.cos(el) * Math.cos(az), y: HEAD.y + r * Math.sin(el), z: r * Math.cos(el) * Math.sin(az) }
}

/** Hats, each on top of the head: [material, geometries] parts and, if it moves, a node of its own. */
const HATS = {
  tophat: () => ({
    parts: [
      [M.coal, [T(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 12), { y: 0.0 }), T(new THREE.CylinderGeometry(0.125, 0.135, 0.28, 12), { y: 0.14 })]],
      [M.provider, [T(new THREE.CylinderGeometry(0.139, 0.139, 0.055, 12), { y: 0.045 })]],
    ],
    lean: 0.18,
  }),
  beanie: () => ({
    parts: [
      [M.provider, [T(new THREE.SphereGeometry(0.2, 10, 5, 0, TAU, 0, Math.PI / 2), { sy: 0.9, y: -0.04 })]],
      [M.white, [T(new THREE.CylinderGeometry(0.205, 0.21, 0.07, 12), { y: -0.04 }), T(ball(0.07, 1), { y: 0.17 })]],
    ],
    lean: 0.1,
  }),
  pail: () => ({
    parts: [[M.tin, [T(new THREE.CylinderGeometry(0.12, 0.165, 0.22, 10), { y: 0.09 }), T(new THREE.TorusGeometry(0.15, 0.008, 3, 10, Math.PI), { y: 0.05, rx: 0.4 })]]],
    lean: -0.25,
  }),
  stocking: (name) => {
    const tip = node(`${name}.stocking.tip`, {
      mesh: mesh(`${name}.stocking.tip`, [
        [M.provider, [T(new THREE.ConeGeometry(0.11, 0.3, 8), { y: 0.13 })]],
        [M.white, [T(ball(0.06, 1), { y: 0.29 })]],
      ]),
      at: [0, 0.18, 0],
      rot: quat(0, 0, 0.9),
    })
    clip(`${name}.stocking`, 2.8, track(tip, 'rotation', (t) => E(0.15 * wave(t), 0, 0.95 + 0.18 * wave(t, 1))))
    return {
      parts: [
        [M.provider, [T(new THREE.CylinderGeometry(0.12, 0.19, 0.2, 10), { y: 0.1 })]],
        [M.white, [T(new THREE.CylinderGeometry(0.2, 0.205, 0.06, 12), { y: 0.0 })]],
      ],
      children: [tip],
      lean: 0,
    }
  },
  earmuffs: () => ({
    parts: [
      [M.steel, [T(new THREE.TorusGeometry(0.27, 0.018, 4, 14, Math.PI), { y: -0.2, rx: 0, ry: Math.PI / 2 })]],
      [M.provider, [T(ball(0.08, 1), { sz: 0.6, y: -0.2, z: 0.26 }), T(ball(0.08, 1), { sz: 0.6, y: -0.2, z: -0.26 })]],
    ],
    lean: 0,
  }),
}

/**
 * A snowman as a dirigible: three snowballs end to end, the head in front
 * with coal eyes, a carrot nose and a smile; a scarf in the provider's color
 * round its neck, stick arms for fins, a propeller behind, a gondola under
 * it, and up to four baubles hanging from that.
 */
function snowman(name, hat) {
  const snow = [T(ball(0.42, 2), { x: -0.42, y: 0.04 }), T(ball(0.34, 2), { x: 0.16, y: 0.06 }), T(ball(HEAD.r, 2), { x: HEAD.x, y: HEAD.y })]
  const coal = []
  for (const side of [-1, 1]) {
    const e = onHead(side * 0.38, 0.32, -0.01)
    coal.push(T(ball(0.034, 0), { x: e.x, y: e.y, z: e.z }))
  }
  for (const az of [-0.42, -0.21, 0, 0.21, 0.42]) {
    const p = onHead(az, -0.38 + 0.55 * az * az, -0.005)
    coal.push(T(ball(0.019, 0), { x: p.x, y: p.y, z: p.z }))
  }
  const nose = T(new THREE.ConeGeometry(0.045, 0.28, 6), { rz: -Math.PI / 2, x: HEAD.x + HEAD.r + 0.12, y: HEAD.y })
  const twig = []
  for (const side of [-1, 1]) {
    const root = [0.14, 0.08, side * 0.3]
    const elbow = [0.02, 0.2, side * 0.62]
    const hand = [-0.1, 0.36, side * 0.82]
    twig.push(rod(root, elbow, 0.018, 4), rod(elbow, hand, 0.014, 4))
    twig.push(rod(hand, [-0.04, 0.46, side * 0.88], 0.01, 3), rod(hand, [-0.2, 0.42, side * 0.9], 0.01, 3))
  }
  // Fins round the tail, and a gondola below.
  const fins = [
    prism(
      [
        [-0.66, 0.3],
        [-0.9, 0.27],
        [-0.97, 0.5],
      ],
      0.035,
    ),
    T(
      prism(
        [
          [-0.66, 0.3],
          [-0.9, 0.27],
          [-0.97, 0.48],
        ],
        0.035,
      ),
      { rx: Math.PI / 2 + 0.3, y: 0.04 },
    ),
    T(
      prism(
        [
          [-0.66, 0.3],
          [-0.9, 0.27],
          [-0.97, 0.48],
        ],
        0.035,
      ),
      { rx: -Math.PI / 2 - 0.3, y: 0.04 },
    ),
  ]
  const gondola = [T(new THREE.BoxGeometry(0.42, 0.1, 0.24), { x: 0.15, y: -0.44 }), T(new THREE.BoxGeometry(0.5, 0.03, 0.3), { x: 0.15, y: -0.375 })]
  const ropes = [
    [-0.03, -0.11],
    [0.33, -0.11],
    [-0.03, 0.11],
    [0.33, 0.11],
  ].map(([x, z]) => rod([x, -0.38, z], [0.16 + (x - 0.15) * 0.6, -0.2, z * 0.6], 0.007, 3))

  // The scarf's tail streams back from its knot, and flutters.
  const scarfTail = node(`${name}.scarf`, {
    mesh: mesh(`${name}.scarf`, [[M.provider, [T(new THREE.BoxGeometry(0.34, 0.025, 0.08), { x: -0.17 }), T(new THREE.BoxGeometry(0.28, 0.025, 0.08), { x: -0.16, z: 0.07, ry: -0.35, y: -0.02 })]]]),
    at: [0.4, 0.24, 0.12],
    rot: quat(0.3, 0, -0.25),
  })
  clip(`${name}.scarf`, 1.7, track(scarfTail, 'rotation', (t) => E(0.3 + 0.25 * wave(t), 0.15 * wave(t, 2), -0.25 + 0.2 * wave(t, 1))))

  const prop = node(`${name}.prop`, {
    mesh: mesh(`${name}.prop`, [
      [M.wood, [T(new THREE.BoxGeometry(0.03, 0.42, 0.06), { rx: 0.4 })]],
      [M.red, [T(new THREE.ConeGeometry(0.05, 0.1, 6), { rz: Math.PI / 2, x: -0.03 })]],
    ]),
    at: [-0.9, 0.04, 0],
  })
  clip(`${name}.prop`, 0.5, track(prop, 'rotation', (t) => E(t * TAU, 0, 0), 8))

  const h = HATS[hat](name)
  const hatNode = node(`${name}.hat`, {
    mesh: mesh(`${name}.hat`, h.parts),
    at: [HEAD.x - 0.03, HEAD.y + HEAD.r - 0.03, 0],
    rot: quat(0, 0, h.lean),
    children: h.children ?? [],
  })

  return model(
    node(name, {
      mesh: mesh(name, [
        [M.snow, snow],
        [M.coal, coal],
        [M.carrot, [nose]],
        [M.twig, [...twig, ...ropes]],
        [M.provider, [T(new THREE.TorusGeometry(0.205, 0.055, 6, 14), { ry: Math.PI / 2, x: 0.41, y: 0.075 }), ...fins]],
        [M.wood, [gondola[0], T(rod([-0.86, 0.04, 0], [-0.78, 0.04, 0], 0.025, 5), {})]],
        [M.redDark, [gondola[1]]],
      ]),
      children: [hatNode, scarfTail, prop, ...bags()],
    }),
  )
}

// ---- the visitor: a sleigh pulled by reindeer, facing +z ------------------------------

/** A reindeer, facing +z, galloping through the air. */
function reindeer(name, at, phase) {
  const body = [T(ball(0.2, 1), { sx: 0.68, sy: 0.75, sz: 1.75 })]
  const neck = [rod([0, 0.06, 0.26], [0, 0.36, 0.46], 0.065, 5)]
  const head = [T(new THREE.BoxGeometry(0.15, 0.15, 0.3), { y: 0.4, z: 0.55, rx: 0.3 })]
  const light = [T(ball(0.1, 0), { sx: 0.65, sz: 1.5, y: -0.07, z: 0.02 }), T(ball(0.06, 0), { y: 0.06, z: -0.36 }), T(new THREE.BoxGeometry(0.11, 0.08, 0.09), { y: 0.35, z: 0.7, rx: 0.3 })]
  const antler = []
  for (const side of [-1, 1]) {
    const base = [side * 0.05, 0.44, 0.48]
    const tip = [side * 0.2, 0.78, 0.36]
    antler.push(rod(base, tip, 0.016, 3))
    antler.push(rod([side * 0.1, 0.56, 0.44], [side * 0.18, 0.66, 0.54], 0.012, 3))
    antler.push(rod([side * 0.15, 0.68, 0.4], [side * 0.27, 0.74, 0.46], 0.012, 3))
    antler.push(rod([side * 0.18, 0.74, 0.38], [side * 0.15, 0.86, 0.33], 0.011, 3))
    light.push(T(new THREE.ConeGeometry(0.035, 0.09, 4), { x: side * 0.08, y: 0.45, z: 0.42, rz: side * -1.1 }))
  }
  const harness = [T(new THREE.TorusGeometry(0.11, 0.025, 4, 10), { x: 0, y: 0.13, z: 0.3, rx: 0.9 })]
  const bells = [T(ball(0.035, 0), { y: 0.02, z: 0.38 })]

  const legMesh = mesh(`${name}.leg`, [
    [M.fur, [T(new THREE.BoxGeometry(0.06, 0.36, 0.07), { y: -0.18 })]],
    [M.coal, [T(new THREE.BoxGeometry(0.065, 0.05, 0.08), { y: -0.37 })]],
  ])
  const legs = []
  const tracks = []
  for (const [lx, lz, front] of [
    [0.09, 0.26, 1],
    [-0.09, 0.26, 1],
    [0.09, -0.26, 0],
    [-0.09, -0.26, 0],
  ]) {
    const leg = node(`${name}.leg.${legs.length}`, { mesh: legMesh, at: [lx, -0.08, lz] })
    legs.push(leg)
    // Front legs reach forward and hind legs back, as a reindeer flies.
    const lag = lx > 0 ? 0.5 : 0
    tracks.push(track(leg, 'rotation', (t) => E(front ? -0.75 + 0.45 * wave(t, phase + lag) : 0.75 + 0.45 * wave(t, phase + lag + Math.PI), 0, 0), 12))
  }
  const deer = node(name, {
    mesh: mesh(name, [
      [M.fur, [...body, ...neck, ...head]],
      [M.furLight, light],
      [M.antler, antler],
      [M.red, harness],
      [M.gold, bells],
    ]),
    at,
    children: legs,
  })
  tracks.push(track(deer, 'translation', (t) => [at[0], at[1] + 0.06 * wave(t, phase), at[2]], 12))
  tracks.push(track(deer, 'rotation', (t) => E(-0.08 * wave(t, phase + 1), 0, 0), 12))
  clip(name, 0.8, ...tracks)
  return deer
}

function sleigh() {
  // The body's side, in z and y, extruded across x: a low middle, a high back, and a curl in front.
  const side = [
    [-0.95, -0.28],
    [0.5, -0.28],
    [0.78, -0.05],
    [0.8, 0.18],
    [0.62, 0.25],
    [0.62, 0.1],
    [0.35, 0.02],
    [-0.45, 0.06],
    [-0.62, 0.48],
    [-0.98, 0.5],
  ]
  const bodyGeo = T(prism(side, 0.8), { ry: -Math.PI / 2 })
  const trim = [T(new THREE.BoxGeometry(0.84, 0.04, 0.06), { y: 0.5, z: -0.8 }), T(new THREE.BoxGeometry(0.84, 0.04, 0.06), { y: 0.06, z: -0.1 })]
  // Runners: a rail on each side, curling up in front.
  const runners = []
  for (const x of [-0.36, 0.36]) {
    const curve = [
      [x, -0.5, -1.0],
      [x, -0.52, -0.6],
      [x, -0.52, 0.5],
      [x, -0.47, 0.8],
      [x, -0.32, 0.98],
      [x, -0.16, 0.95],
      [x, -0.14, 0.82],
    ]
    runners.push(...sweep(curve, 0.028, 4).filter(Boolean))
    for (const z of [-0.7, 0.0, 0.42]) runners.push(rod([x, -0.52, z], [x, -0.27, z], 0.02, 4))
  }
  const seat = [T(new THREE.BoxGeometry(0.74, 0.1, 0.4), { y: 0.0, z: -0.25 }), T(new THREE.BoxGeometry(0.74, 0.35, 0.08), { y: 0.2, z: -0.5 })]
  // A sack of presents behind the seat.
  const sack = [jitter(T(ball(0.28, 1), { sy: 1.2, y: 0.45, z: -0.72 }), 0.2, 12)]
  const presents = [
    [M.green, T(new THREE.BoxGeometry(0.2, 0.18, 0.2), { x: -0.18, y: 0.62, z: -0.68, ry: 0.4 })],
    [M.red, T(new THREE.BoxGeometry(0.16, 0.16, 0.16), { x: 0.16, y: 0.66, z: -0.75, ry: -0.3, rz: 0.2 })],
    [M.white, T(new THREE.BoxGeometry(0.14, 0.2, 0.14), { x: 0.0, y: 0.74, z: -0.82, ry: 0.8 })],
  ]
  // The driver, in red, with a white beard and a hat.
  const coat = [T(new THREE.CylinderGeometry(0.14, 0.22, 0.4, 7), { y: 0.25, z: -0.25 }), rod([0.12, 0.35, -0.2], [0.14, 0.22, 0.08], 0.045, 4), rod([-0.12, 0.35, -0.2], [-0.14, 0.22, 0.08], 0.045, 4), T(new THREE.ConeGeometry(0.1, 0.2, 6), { y: 0.72, z: -0.25, rx: -0.3 })]
  const trimWhite = [T(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 8), { y: 0.63, z: -0.25 }), T(ball(0.04, 0), { y: 0.82, z: -0.3 }), T(new THREE.ConeGeometry(0.09, 0.16, 6), { rx: Math.PI + 0.3, y: 0.48, z: -0.17 })]
  const face = [T(ball(0.09, 1), { y: 0.56, z: -0.24 })]
  const belt = [T(new THREE.CylinderGeometry(0.175, 0.175, 0.05, 7), { y: 0.2, z: -0.25 })]

  const body = node('sleigh.body', {
    mesh: mesh('sleigh', [
      [M.red, [bodyGeo, ...coat, presents[1][1]]],
      [M.gold, [...runners, ...trim]],
      [M.redDark, seat],
      [M.sack, sack],
      [M.green, [presents[0][1]]],
      [M.white, [presents[2][1], ...trimWhite]],
      [M.skin, face],
      [M.coal, belt],
    ]),
  })
  clip('sleigh.bob', 1.6, track(body, 'translation', (t) => [0, 0.05 * wave(t), 0]), track(body, 'rotation', (t) => E(0.04 * wave(t, 1), 0, 0.03 * wave(t, 2))))

  // Two pairs of reindeer ahead, on traces from the sleigh.
  const deer = [
    reindeer('sleigh.deer.0', [0.3, -0.05, 1.65], 0),
    reindeer('sleigh.deer.1', [-0.3, -0.05, 1.65], 0.9),
    reindeer('sleigh.deer.2', [0.3, 0.0, 2.75], 1.9),
    reindeer('sleigh.deer.3', [-0.3, 0.0, 2.75], 2.8),
  ]
  const traces = mesh('sleigh.traces', [
    [
      M.coal,
      [
        rod([0.3, -0.1, 0.75], [0.3, 0.05, 1.32], 0.012, 3),
        rod([-0.3, -0.1, 0.75], [-0.3, 0.05, 1.32], 0.012, 3),
        rod([0.3, 0.05, 1.95], [0.3, 0.1, 2.42], 0.012, 3),
        rod([-0.3, 0.05, 1.95], [-0.3, 0.1, 2.42], 0.012, 3),
        rod([0.14, 0.22, 0.08], [0.28, 0.2, 1.36], 0.008, 3),
        rod([-0.14, 0.22, 0.08], [-0.28, 0.2, 1.36], 0.008, 3),
      ],
    ],
  ])
  // A trail of sparkles behind.
  const sparkles = [0, 1, 2, 3, 4].map((i) => {
    const s = node(`sleigh.sparkle.${i}`, { mesh: mesh(`sleigh.sparkle.${i}`, [[M.sparkle, [new THREE.OctahedronGeometry(0.09 - i * 0.012, 0)]]]), at: [(i % 2 ? 0.25 : -0.25) * (1 + i * 0.3), -0.45 + i * 0.03, -1.25 - i * 0.45] })
    return s
  })
  clip(
    'sleigh.sparkle',
    0.9,
    ...sparkles.map((s, i) =>
      track(
        s,
        'scale',
        (t) => {
          const k = 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI + i * 0.7))
          return [k, k, k]
        },
        12,
      ),
    ),
  )
  return model(node('sleigh', { scale: [1.2, 1.2, 1.2], children: [body, node('sleigh.harness', { mesh: traces }), ...deer, ...sparkles] }))
}

// ---- everything -------------------------------------------------------------------

citadel()
island('island.frost', { sides: 9, top: M.frost, seed: 11, rough: 0.45 })
island('island.moss', { sides: 11, top: M.moss, seed: 23, rough: 0.35 })
island('island.straw', { sides: 8, top: M.straw, seed: 37, rough: 0.5 })
pine()
drift()
boulder()
snowmanScenery()
ringPiece()
plaza()
post()
bulb()
building()
snowman('dirigible.tophat', 'tophat')
snowman('dirigible.beanie', 'beanie')
snowman('dirigible.pail', 'pail')
snowman('dirigible.stocking', 'stocking')
snowman('dirigible.earmuffs', 'earmuffs')
sleigh()

let prev = 0
for (const [name, n] of tally) {
  console.log(`${name.padEnd(18)} ${String(n - prev).padStart(6)} triangles`)
  prev = n
}
console.log(`terrace.rope.at: [${ROPE_AT.map((v) => +v.toFixed(3)).join(', ')}]`)
console.log(`${'all'.padEnd(18)} ${String(triangles).padStart(6)} triangles, ${doc.getRoot().listAnimations().length} animations, ${doc.getRoot().listNodes().length} nodes`)

const glb = await new NodeIO().writeBinary(doc)
await writeFile(out, glb)
console.log(`wrote ${out}: ${glb.byteLength} bytes`)
