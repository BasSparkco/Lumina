# Known pre-existing errors — apps/api test typings

**Status:** fixed 2026-08-26 (during designer.md Phase 12 hardening work). See
[Resolution](#resolution) below. Left in place as a record of what happened and why, per this
project's convention of documenting rather than silently fixing/ignoring cross-cutting issues.

## Summary (as originally filed)

`cd apps/api && npx tsc --noEmit -p tsconfig.json` reported **94 errors**, all confined to 5
`*.spec.ts` files. Zero errors existed outside test files — every actual source file in
`apps/api` (and every other workspace) typechecked clean.

```
9   src/common/guards/super-admin.guard.spec.ts
5   src/common/org-scoped.service.spec.ts
41  src/modules/player/player.service.spec.ts
24  src/modules/playlists/playlists.service.spec.ts
15  src/modules/screens/screens.service.spec.ts
---
94 total
```

By error code:

```
62  TS2304  Cannot find name 'expect' / 'jest'
29  TS2593  Cannot find name 'describe' / 'it' (jest/mocha type-defs hint)
 2  TS7031  Binding element implicitly has an 'any' type (knock-on: no jest types means callback params can't be inferred)
 1  TS7006  Parameter implicitly has an 'any' type (same knock-on cause)
```

TypeScript couldn't see the ambient Jest globals (`describe`, `it`, `expect`, `jest`) inside these
spec files, even though `@types/jest@30.0.0` was installed and correctly resolved from
`apps/api/node_modules/@types/jest`.

## How this was found

Surfaced mid-session during designer.md Phase 11 (Player Runtime Integration, 2026-08-26) after a
routine `pnpm install`. Confirmed unrelated to that phase's own changes via `git stash`/`git stash
pop` — the errors reproduced identically with zero of that session's code applied.

## Root cause (confirmed)

A `pnpm install` non-deterministically hoists different `ts-jest`/`typescript` peer combinations
across installs — the workspace root hoists `typescript@6.0.3`, and evidence in the pnpm store
showed two differently-hashed `ts-jest@29.4.12` installs (diverging peer sets). With no explicit
`"types"` array in `apps/api/tsconfig.json`, TypeScript's automatic `@types/*` inclusion depended
on which peer set won a given install — sometimes it picked up `@types/jest`, sometimes not.

This was **purely a `tsc --noEmit` type-check problem**, confirmed via `pnpm --filter api test`:
`jest` itself ran all suites successfully throughout, because `apps/api/jest.config.ts` pins its
own `ts-jest` transform options independently of the plain-`tsc` compile pass.

A second, separate bug was found and fixed in the same session while adding new spec coverage:
TypeScript 6's stricter `rootDir` inference broke `ts-jest`'s per-file isolated-module transpile
(`TS5011: The common source directory of 'tsconfig.json' is './src/modules/<x>'...`) for *every*
spec file — this one *did* block `jest` itself from running at all, not just `tsc --noEmit`. Fixed
in `apps/api/jest.config.ts` by passing `rootDir: '.'` through ts-jest's own `tsconfig` transform
option, alongside the existing `types: ['jest', 'node']` override there.

## Resolution

Added an explicit `"types": ["jest", "node"]` to `apps/api/tsconfig.json`'s `compilerOptions` —
the alternative from the original "To fix" plan below, chosen over pinning `typescript` at the
workspace root because it fixes the actual proximate cause (auto-inclusion depending on hoisting
order) without touching every other workspace's dependency resolution.

**Verified this didn't narrow type coverage elsewhere**: an explicit `types` array stops
TypeScript's *automatic* inclusion of every `@types/*` package (not just the ones listed), which
raised a real concern — `apps/api` uses ambient global augmentations from `@types/express` and
`@types/multer` (`Express.Multer.File`, used throughout `assets.controller.ts`/`assets.service.ts`)
that aren't reached via explicit imports. Tested empirically before committing to this fix: with
`types: ["jest", "node"]` in place, `tsc --noEmit` produced **zero** new errors outside spec files
— the explicit imports of `@nestjs/platform-express` etc. pull in what's needed regardless of the
`types` array, so this was safe.

**Full verification sweep**, all clean:
- `cd apps/api && npx tsc --noEmit -p tsconfig.json` — 0 errors (was 94; grew to 154 mid-session
  after a 6th spec file was added, then to 0 after this fix).
- `cd apps/api && npx jest` — 6 suites, 29 tests, all passing.
- `cd apps/api && npx nest build` — clean.
- `pnpm --filter dashboard exec tsc --noEmit` / `pnpm --filter player exec tsc --noEmit` — both
  clean, confirming the fix (scoped to `apps/api/tsconfig.json` only) didn't affect other
  workspaces.

If this regresses after a future `pnpm install` (e.g. a `typescript`/`ts-jest` upgrade changes
what `types: ["jest", "node"]` resolves to), re-run the verification sweep above before assuming
the cause is the same one described here.
