---
name: rtsio-codebase
description: Architecture reference for the rtsIo RTS game/engine — its deterministic simulation engine, lockstep networking, Three.js rendering layer, binary protocol, and conventions. Use when working anywhere in this repo to understand structure, data flow, where code lives, and the invariants that must not break.
---

# rtsIo codebase guide

A browser-based real-time strategy game. **TypeScript + Three.js (r0.176)**, bundled by **Vite**, with a separate **Node `ws` relay server** for multiplayer. The defining design choice is a strict split between a **deterministic, headless simulation engine** and the **Three.js rendering layer**, connected by lockstep networking over a hand-rolled binary protocol.

## Repo layout

```
shared/protocol.ts          binary wire format (commands + net messages); imported by BOTH client & relay
client/src/engine/          headless deterministic simulation — NO Three.js allowed here
  game.ts                   Game class: all state + update loop + command application + AI/combat
  types.ts                  entity interfaces (Fighter/Builder/Building/Resource/Player) + balance constants
  entities.ts               factory fns + updateMovable; resourceTotal/buildingPosition/setHealth helpers
  vec3.ts                   tiny immutable 3D vector
  lockstep.ts               LockstepManager: client-side networking, runs its own Game, applies turns
client/src/                 rendering layer
  index.ts                  entrypoint: loads GLB models, branches offline vs multiplayer, wires input/UI
  scene.ts                  Scene class — owns Three.js scene/camera/renderer; the engine→view bridge
  environment.ts            createGround() (procedural noise terrain) + createLights() factories
  guys.ts                   Knight/Builder visual units (cloned GLB models + selection halos)
  structures/building.ts    Building visual class (buildings AND resource nodes) + build-preview coloring
  lobby/lobby.ts            create/join/offline lobby screen
  types/models.ts           ModelsDict + visual BuildingType
relay/server.ts             relay: matchmaking + per-turn command broadcast (never simulates the game)
```

## The central invariant: determinism

Lockstep means **both clients run the full simulation locally** and only exchange *commands*. The engine MUST produce identical state from identical (seed + command stream). When touching `client/src/engine/`, never break this:

- **Entity IDs come from a monotonic counter** (`Game.newEntityID`), never `Math.random()`.
- **Resource placement uses a seeded LCG PRNG** (`Game.addResources`), seeded by the relay-assigned `seed`.
- **No wall-clock, no `Math.random()`, no iteration-order nondeterminism** in engine update/command paths. `Map` iteration order (insertion order) is relied upon — keep it stable.
- Rendering (`scene.ts`, `guys.ts`, etc.) may use `Math.random()` freely (e.g. terrain noise) — it never feeds back into simulation.

If you change engine logic, the same change runs on every client; desync = divergent games.

## Data flow

**Two run modes, same `Game` + `Scene`, differing only in how commands are routed and turns are driven** (`index.ts`):

- **Offline** (`?mode` absent): a local `Game`, a `setInterval` tick (every `TICK_MS = 10`) drains a local command queue → `game.applyCommand` → `game.update(DT)` → `scene.syncFromEngine(game)`. `DT = 0.05`.
- **Multiplayer** (`?mode=multiplayer&code=...&player=1|2`): commands go to `LockstepManager.sendCommand`. The relay broadcasts a `Turn` containing *both* players' commands; `lockstep.ts` applies p1 then p2 commands, calls `game.update(DT)`, then `onTurnApplied` → `scene.syncFromEngine`.

**The relay is intentionally dumb** (`relay/server.ts`): it matchmakes via 6-char codes, buffers each player's commands, and every `TURN_DURATION_MS = 10` broadcasts a `Turn`. It gates turn advancement on both players reporting equal `elapsedTime` (ack-based sync) and supports a 5s reconnect grace window. It holds NO game state beyond commands/turn counter.

## Binary protocol (`shared/protocol.ts`)

Hand-rolled, `DataView`-based. Single source of truth imported by both sides — edit it in one place. Two opcode enums:
- `NetOp` — network message types (Create/Join/Reconnect/Commands/Ack/Loaded ↔ Created/Joined/Reconnected/Start/Turn/Error/PlayerDisconnected).
- `CmdOp` — game commands (MoveUnit/PlaceBuilding/CreateKnight/CreateBuilder).

`encode*`/`decode*` pairs per message; `decodeMessage` returns a typed `NetMessage` union. To add a command: add a `CmdOp`, a `Command` variant, encode/decode cases, then handle it in `Game.applyCommand`.

## The rendering bridge (`scene.ts`)

`scene.ts` is the largest/most-coupled file (input + rendering + selection + placement + build previews). The key method is **`syncFromEngine(game)`**: it diffs engine entities against what's rendered and creates/moves/removes Three.js objects to match.

- **Single entity registry**: `entities: Map<number, Unit | Building>` keyed by engine entity ID is the *one* source of truth for rendered objects. (This replaced three overlapping registries — `unitsMap`, `buildings[]`, `renderedEntities`. Don't reintroduce parallel registries.) Discriminate with `instanceof Building`; `buildingViews()` filters the map for collision checks.
- Right-click issues `moveUnit` (passive/aggressive per `moveType`); left-drag selects your own units via Three.js `SelectionBox`. Ownership gates `isSelectable`/`isMoveable`.
- `Building` view class is reused for both buildings and resource nodes.

## Engine gameplay model (quick reference)

- **Players** hold `gold`/`stone`/`wood` and `Map`s of `fighters`/`builders`/`buildings`. Start with 1000 of each resource and a townhall.
- **Builders**: auto-mine nearest resource until carrying capacity (20), then deposit at primary townhall. Spawned by townhall.
- **Fighters (knights)**: auto-target closest enemy within `AGGRO_RADIUS`, hunt, attack on `attackDelay` cooldown. Spawned by barracks (on cooldown).
- **Buildings**: house / townhall / barracks, with costs/health/cooldown in `types.ts` constants.
- `Game.update(dt)` runs builder AI, combat (`huntDown`/`generalAttack`), building cooldowns, then `collectDeceased()` (which fills `game.deceased`, consumed by `scene.syncFromEngine` for removal).

## Conventions & gotchas

- **Indentation is tabs** throughout the TS source.
- Engine code is clean and Three.js-free; keep it that way. Rendering imports *from* engine, never the reverse.
- `.js.old` files (`scene.js.old`, `guys.js.old`, `building.js.old`) are pre-TypeScript-refactor remnants — ignore them; the live code is the `.ts` engine/rendering split.
- **Known unsynced state**: `syncFromEngine` only *creates* buildings — it never reflects building health/damage/cooldown changes; buildings only visually update on death. (Open item if you touch building visuals.)
- `removeUnit`/`moveUnit` early-return on unknown ids (safe against stale `deceased` ids).
- Cloned GLB geometries/materials are not `.dispose()`d on removal — a known GPU-memory leak over long matches.
- Relay URL: dev `ws://localhost:3001/`, prod `wss://rts.waterthegarden.com/relay/` (duplicated in `index.ts` and `lobby/lobby.ts`).

## Build / run

From `client/`: `npm run dev` (Vite dev server), `npm run build`, `npm run preview`. Typecheck with `npx tsc --noEmit`. The relay (`relay/`) is a separate Node `ws` server on port 3001.
