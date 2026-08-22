# Known lint errors (pre-existing, not blocking)

Found during final verification before the 2026-08-21 production-readiness merge (`7a81d0c`).
All 12 are pre-existing — confirmed none are in files touched during that audit session, and
several were already present on `main` before that work started. They make `pnpm lint` /
GitHub Actions CI fail, but do **not** affect `pnpm typecheck`, `pnpm test`, or `pnpm build` —
all of those pass clean, and the app builds and runs correctly.

**Update 2026-08-21: all 12 fixed.** `pnpm --filter dashboard lint` and
`pnpm --filter worker lint` both pass clean (typecheck/test/build reverified too). See each
item below for what changed.

**Status key:** ⬜ not started · ✅ fixed

---

## apps/dashboard (11 errors)

### ✅ 1. `LayoutsSection.tsx:285` — setState directly in a useEffect
```
useEffect(() => {
  setSelectedZoneId(null);
}, [editing]);
```
`react-hooks/set-state-in-effect`. Resets selection when `editing` changes. Fixable by deriving
`selectedZoneId` differently (e.g. computed from `editing` instead of stored+reset), but that's a
real behavior-shape change in a file this size — needs care, not a blind rule-silencing.

Fixed: replaced the effect with a render-time "adjust state when a prop changes" reset
(compare `editing` to a `prevEditing` state, reset+update inline during render instead of in
a post-commit effect) — combined with #2 into one block, since both reset on the same
`editing` transition.

### ✅ 2. `LayoutsSection.tsx:308` — setState directly in a useEffect
```
useEffect(() => {
  setZoom(1);
}, [editing]);
```
Same rule, same file. Resets zoom on the same `editing` transition as #1 — likely wants the same
fix approach as #1, ideally addressed together.

Fixed together with #1 — folded into the same render-time reset block.

### ✅ 3. `ThemesSection.tsx:84` — unused import
`'MediaCrop' is defined but never used` (`@typescript-eslint/no-unused-vars`). Straightforward —
either it's genuinely dead and safe to drop, or something that meant to use it doesn't yet.
Worth a quick check of git history/intent before deleting.

Fixed: confirmed `CropEditor` itself is still used (line 3854) and its `onSave` callback's
`crop` param is inferred rather than annotated — the `MediaCrop` type import was genuinely
unused. Dropped just the type import, kept `CropEditor`.

### ✅ 4. `ThemesSection.tsx:1527` — floating promise
`Promises must be awaited, end with a .catch, or be marked with void`
(`@typescript-eslint/no-floating-promises`). An un-awaited async call with no error handling —
worth checking whether a rejection here fails silently.

Fixed: `loadImage()` does reject on an image load error, and it was failing silently. Added
`.catch((err) => console.error(...))`.

### ✅ 5. `ThemesSection.tsx:1920` — promise-returning handler where void expected
`@typescript-eslint/no-misused-promises`. Likely an `onClick`/similar prop given an `async`
function directly — usually fixed by wrapping in `() => { void handler(); }`.

Fixed exactly as predicted: `onClick={handleEyedropper}` → `onClick={() => { void handleEyedropper(); }}`.

### ✅ 6. `screens/page.tsx:8` — unused import
`'PlaylistSummary' is defined but never used` (`@typescript-eslint/no-unused-vars`).

### ✅ 7. `screens/page.tsx:8` — unused import
`'Layout' is defined but never used` (`@typescript-eslint/no-unused-vars`). Same import line as #6.

### ✅ 8. `screens/page.tsx:8` — unused import
`'Theme' is defined but never used` (`@typescript-eslint/no-unused-vars`). Same import line as
#6/#7 — likely a quick single-line fix removing all three unused type imports at once.

Fixed 6/7/8 together: confirmed all three only ever appeared in that one import (not used
elsewhere, not even in a comment referencing real usage) and removed them in one edit.

### ✅ 9. `hooks/useEditorHistory.ts:18` — setState directly in a useEffect
```
useEffect(() => {
  setHistory({ past: [], future: [] });
  pendingCaptureRef.current = null;
}, [sessionKey]);
```
`react-hooks/set-state-in-effect`. Resets undo/redo history when the edit session changes.

Fixed: split the two resets. `setHistory` moved to a render-time adjustment (track
`prevSessionKey` in state, reset inline when it differs from `sessionKey`) — same pattern as
#1/#2. The ref reset couldn't join it (refs can't be touched during render, see #10/#11) so it
stayed in a small effect on `[sessionKey]`, which is fine since only the *setState* half of the
original effect was the lint violation.

### ✅ 10. `hooks/useEditorHistory.ts:53` — ref mutated during render
```
const undoRef = useRef(undo);
const redoRef = useRef(redo);
undoRef.current = undo;   // line 53
redoRef.current = redo;   // line 54
```
`react-hooks/refs`. Classic "ref mirrors latest closure" pattern (keeps a stable keydown listener
calling the current `undo`/`redo` without resubscribing) — functionally fine in practice today,
but not technically allowed during render per the stricter newer rule. Straightforward fix: move
both assignments into a `useEffect(() => { undoRef.current = undo; redoRef.current = redo; }, [undo, redo])`.

Fixed exactly as predicted.

### ✅ 11. `hooks/useEditorHistory.ts:54` — ref mutated during render
Same issue as #10, second line of the same pair — fix both together.

Fixed together with #10.

---

## apps/worker (1 error)

### ✅ 12. `apps/worker/src/app.module.ts:41` — prefer `??=`
```
if (process.env[key] === undefined) {
  process.env[key] = value;
}
```
`@typescript-eslint/prefer-nullish-coalescing`. This is the exact same hand-rolled `.env` file
parser that `apps/api/src/app.module.ts` had — already replaced there with the real `dotenv`
package (see the production-readiness audit's M12 fix, `report.md`). The same replacement
(`dotenv.config({ path: [...], quiet: true })`) applies directly here; worth doing as one fix
across both apps rather than just silencing this one line.

Fixed exactly as predicted: swapped the hand-rolled parser for `dotenv.config({ path: [...],
quiet: true })`, mirroring `apps/api/src/app.module.ts` verbatim (same candidate path list,
same `override: false` semantics). Added `dotenv` (`^17.4.2`, matching the api app's version)
to `apps/worker/package.json` dependencies and ran `pnpm install`. Verified at runtime that it
resolves and parses `apps/worker/.env` correctly.

---

## Also found during verification (not in original 12, not fixed)

`pnpm lint` at the repo root also surfaces 7 pre-existing errors + 1 warning in **apps/player**
(`ThemeRenderer.tsx`, `ZonePlayer.tsx`, `PairingPage.tsx`, `PlayerPage.tsx` — dot-notation,
a missing `@next/next` rule definition, and several `no-misused-promises` on async handlers).
Confirmed pre-existing: no player files were touched while fixing the 12 above, and `git log`
shows the flagged lines predate this session. Out of scope for this pass — flagging here so
they don't get lost, same spirit as the original list.
