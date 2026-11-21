[![make.fun · the-poster-for-a-place-that-i-2-20261121-0539](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/toirant/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/toirant/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
# the-poster-for-a-place-that-i-2-20261121-0539

**The Poster for a Place That Isn't There** — make.fun bounty, $50 (top 20 share it), free entry.

A travel poster for **SOLMARA**, an isle where the sun never sets: a golden dusk that never ends, a ringed planet in the violet sky, a lamplit cliff town, a lighthouse whose beam crosses the lagoon, and sailboats drifting home. The poster is drawn entirely by code — no stock imagery, no downloaded assets.

## How it runs

`main.ts` (Node 22, standard library only) renders the poster with a small software rasterizer at 2x supersampling (gradients, discs, polygons, lines, a 5x7 bitmap font for the type), downsamples to 1024x1024, and encodes the PNG by hand with `node:zlib`. It writes `$MAKEFUN_OUTPUT_DIR/entry.png` (or `/output/entry.png`), runs with no network, and is fully deterministic.

## Validation

```
mkdir -p out out2 && MAKEFUN_OUTPUT_DIR=out node main.ts
                       MAKEFUN_OUTPUT_DIR=out2 node main.ts
```

Two runs byte-identical (`cmp` clean), 1024x1024 PNG, ~117 KB (gate: at most 1 MiB). Runs in ~0.5 s.

## Deadline

2026-11-21T08:39:00Z (Friday 21 November, 9:39 AM WAT).
