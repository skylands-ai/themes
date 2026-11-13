# Theme pack format 1

A theme pack draws the Skylands 3D world in a new look from data alone. It
holds no code: the world places every model, tags what a click on it means,
and plays only the motions this format offers. A pack changes how the world
is drawn and nothing else. It can't see host, repo, or file names, can't
change what a click does, and can't reach the network.

`skylands theme check <dir>` checks a pack exactly as a citadel will.

## Files

| File | What it is | At most |
| --- | --- | --- |
| `theme.json` | The manifest: what the pack is, its sky and building colors, and which model draws each thing | 64 KB |
| `models.glb` | Every model, as the root nodes of one glTF 2.0 binary's default scene | 4 MB |
| `LICENSE` | The license of the models, which `theme.json` names by its SPDX id | 64 KB |

Nothing else is part of a pack. Other files beside them, such as a README
or the source the models are built from, are left out when a pack is added.

A pack is pinned by its hash, the SHA-256 of what `sha256sum` prints for
its three files:

```sh
sha256sum LICENSE models.glb theme.json | sha256sum
```

## theme.json

```json
{
  "$schema": "../schema/theme-1.schema.json",
  "format": 1,
  "id": "paper-lanterns",
  "name": "Paper Lanterns",
  "version": "1.0.0",
  "description": "A world of folded paper, lit from inside, at dusk.",
  "author": "Skylands",
  "license": "Apache-2.0",
  "sky": { "top": "#11153a", "horizon": "#4b3a6c", "...": "..." },
  "buildings": { "rest": { "color": "#efe6d4" }, "...": "..." },
  "citadel": { "model": "citadel", "labelY": 12.8, "ringRadius": 10, "beacon": "#ffd27a" },
  "island": { "models": ["island.sage"], "scenery": [{ "model": "tree", "perRadius": 1.4, "pad": 0.7, "scale": [0.8, 1.3] }] },
  "ring": { "model": "ring", "spacing": 1.1, "spin": 0.25 },
  "terrace": { "plaza": "plaza", "post": "post", "postSpacing": 1.2, "postOut": 0.2, "glow": 0.6 },
  "building": { "model": "building" },
  "airship": { "model": "crane", "providers": { "codex": "boat" } },
  "visitor": { "model": "kite", "path": "glide", "duration": 9 }
}
```

A field this format doesn't define is refused, so a manifest never means
more than the world draws. Colors are `#rrggbb`.

| Field | What it is |
| --- | --- |
| `format` | `1` |
| `id` | 2 to 40 lowercase letters, digits, and single hyphens. Not `default` or `scifi`, the built-in themes |
| `name` | Up to 40 bytes, shown in the World theme list |
| `version` | `MAJOR.MINOR.PATCH` |
| `description`, `author` | Optional; the description shows under the list |
| `license` | An SPDX license expression for the models |
| `sky` | The sky, or `null` to follow the page's light or dark colors as the default theme does. `top` and `horizon` color the sky; `fog`, `fogNear`, and `fogFar` its fog; `stars` is their opacity from 0 to 1, and `starsAround` puts them below the horizon too; `clouds` shows the world's clouds; `hemiSky`, `hemiGround`, and `hemiIntensity` are the ambient light, and `sun` and `sunIntensity` the sunlight |
| `buildings` | What a building wears at `rest`, while an agent reads (`read`) or edits (`edit`) its file, with two sessions on it at once (`conflict`), and while `selected`, whose glow the world makes breathe. Each is a `color`, and optionally an `emissive` color, an `emissiveIntensity` from 0 to 4, and a `roughness` and `metalness` from 0 to 1. No two may look the same, since the world tells the states apart by them |
| `citadel` | The citadel's `model`, how high over its origin its label floats (`labelY`), the radius of its selection ring (`ringRadius`, 2 to 20), and the color of its beacon's light (`beacon`) |
| `island` | One to eight `models`, one picked for each island, and up to eight kinds of `scenery` |
| `ring` | The piece repeated round a selection ring (`model`), about `spacing` apart, and how fast the ring turns (`spin`, in radians a second) |
| `terrace` | The terrace's `plaza` and the `post` repeated round it, about `postSpacing` apart and `postOut` outside the plaza's edge, and how brightly its `repo-glow` material glows at rest (`glow`) |
| `building` | The `model` of one file's building |
| `airship` | The `model` every agent's airship is drawn with, and optionally one per provider (`claude`, `codex`, `gemini`, `goose`, `local`) in `providers` |
| `visitor` | Optional: what crosses the sky now and then (`model`), along which `path` (`glide`), in how many seconds (`duration`, 2 to 30) |

## models.glb

Each model is a root node of the default scene, named as `theme.json`
names it. Inside a model, the world finds the parts it needs by name. A
part's name is compared up to its first dot, so `core.001`, as Blender
names a second `core`, is a `core` too.

The world's units are about a meter; y is up. An island's walkable top is
about 6.5 to 10 across from its center, a building's lot is 0.7 wide, and
an airship is about 2 long.

| Model | How it is drawn, and its parts |
| --- | --- |
| Citadel | Drawn around its origin, which floats over the middle of the world. Parts: `core`, the marker of the world's NATS server, which the world turns while the server is up and colors by its state, and where tethers end; `halo`, a mesh the world swells and fades while anything waits on a person; and `beacon`, where the world puts the beacon's light |
| Island | Drawn at radius 1 with its walkable top at y = 0, reaching down to y = -1. The world stretches it to each island's radius and depth, and turns it by the island's seed. Part: `core`, the marker of the island's daemon, which the world moves to where it falls on the stretched island and keeps at its own size |
| Scenery | Stands at its origin. The world scatters `perRadius` of each kind per unit of an island's radius, at random sizes from `scale[0]` to `scale[1]`, and hides any a terrace covers, with `pad` room around it |
| Ring piece | Drawn at its origin with +x pointing out from the ring's center. The world repeats it round the ring, turns the ring, and shows it only while what it rings is selected. A ring piece can't be clicked |
| Plaza | A unit square, x and z from -0.5 to 0.5, with its top at y = 0.35, where buildings stand. The world stretches x and z to the terrace's size |
| Post | Stands at its origin, on the island, with +x pointing out from the plaza |
| Building | One mesh of one material: a unit block, -0.5 to 0.5 on each axis, which the world stretches to its lot, 0.7 wide, and to a height from the file's size, and dresses in the `buildings` materials. A child named `cap` is drawn for a unit footprint with its base at y = 0; the world stands it on the roof and keeps its proportions. Other children stretch with the block |
| Airship | Faces +x, with its underside, where a beam drops from while it waits on a person, at y = -0.6. Parts: up to four `bag`s, hung one per quarter of the agent's context used |
| Visitor | Faces +z, the way it moves |

### Materials the world colors

| Material name | What the world does |
| --- | --- |
| `provider` | Colors it in the airship's provider's color, with a faint glow of it |
| `repo` | Colors it in the terrace's repo's color |
| `repo-glow` | Colors it and its glow in the repo's color, glowing at `terrace.glow`, brighter while the terrace is selected |

Material names are compared up to their first dot too.

### Motion

The world plays, looping, every animation clip that moves only nodes inside
one model, on each copy of that model, starting copies at different points
so they don't move in step. Clips move translation, rotation, and scale.
They play on the citadel, islands, scenery, ring pieces, posts, airships,
and the visitor; not on plazas or buildings. Nothing moves for a person who
asked for reduced motion.

### Color and shading

Colors are taken as written, as the world takes its own: a base color
factor of 1, 0.5, 0 is about `#ff8000`. A primitive with no normals is drawn flat,
as glTF says, which suits folded and faceted models and keeps files small.

### What a pack can't hold

The citadel refuses a `models.glb` that has any of these:

- A URI anywhere, including `data:` URIs: everything is in the file's binary chunk.
- A glTF extension, or any `extensions` object.
- Cameras, skins, morph targets, or sparse accessors.
- A primitive that isn't triangles.
- More than 100,000 triangles, 4,096 nodes, 64 animations, or 16 images.
- An image that isn't PNG or JPEG, or is over 1,024 pixels on a side.

## Where packs run

`skylands theme add` checks a pack and stores it in the world's NATS, in
the `skylands-themes` bucket. Every citadel checks it again as it reads it,
serves its files from its own address under the pack's hash, and lists it
under World theme, where each browser picks its own theme. A browser loads
the pack's files only from the citadel, under a Content-Security-Policy
that lets the page reach nothing else. If a pack can't be drawn, the world
shows Default and says why.
