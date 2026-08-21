# Known lint errors (pre-existing, not blocking)

Found during final verification before the 2026-08-21 production-readiness merge (`7a81d0c`).
All 12 are pre-existing — confirmed none are in files touched during that audit session, and
several were already present on `main` before that work started. They make `pnpm lint` /
GitHub Actions CI fail, but do **not** affect `pnpm typecheck`, `pnpm test`, or `pnpm build` —
all of those pass clean, and the app builds and runs correctly. Left unfixed deliberately rather
than hastily patched under deploy pressure, especially since 4 of them sit in the two largest,
highest-risk files in the dashboard (`ThemesSection.tsx` / `LayoutsSection.tsx`, 4,000+ and
1,800+ lines, zero test coverage).

**Status key:** ⬜ not started · ✅ fixed

---

## apps/dashboard (11 errors)

### ⬜ 1. `LayoutsSection.tsx:285` — setState directly in a useEffect
```
useEffect(() => {
  setSelectedZoneId(null);
}, [editing]);
```
`react-hooks/set-state-in-effect`. Resets selection when `editing` changes. Fixable by deriving
`selectedZoneId` differently (e.g. computed from `editing` instead of stored+reset), but that's a
real behavior-shape change in a file this size — needs care, not a blind rule-silencing.

### ⬜ 2. `LayoutsSection.tsx:308` — setState directly in a useEffect
```
useEffect(() => {
  setZoom(1);
}, [editing]);
```
Same rule, same file. Resets zoom on the same `editing` transition as #1 — likely wants the same
fix approach as #1, ideally addressed together.

### ⬜ 3. `ThemesSection.tsx:84` — unused import
`'MediaCrop' is defined but never used` (`@typescript-eslint/no-unused-vars`). Straightforward —
either it's genuinely dead and safe to drop, or something that meant to use it doesn't yet.
Worth a quick check of git history/intent before deleting.

### ⬜ 4. `ThemesSection.tsx:1527` — floating promise
`Promises must be awaited, end with a .catch, or be marked with void`
(`@typescript-eslint/no-floating-promises`). An un-awaited async call with no error handling —
worth checking whether a rejection here fails silently.

### ⬜ 5. `ThemesSection.tsx:1920` — promise-returning handler where void expected
`@typescript-eslint/no-misused-promises`. Likely an `onClick`/similar prop given an `async`
function directly — usually fixed by wrapping in `() => { void handler(); }`.

### ⬜ 6. `screens/page.tsx:8` — unused import
`'PlaylistSummary' is defined but never used` (`@typescript-eslint/no-unused-vars`).

### ⬜ 7. `screens/page.tsx:8` — unused import
`'Layout' is defined but never used` (`@typescript-eslint/no-unused-vars`). Same import line as #6.

### ⬜ 8. `screens/page.tsx:8` — unused import
`'Theme' is defined but never used` (`@typescript-eslint/no-unused-vars`). Same import line as
#6/#7 — likely a quick single-line fix removing all three unused type imports at once.

### ⬜ 9. `hooks/useEditorHistory.ts:18` — setState directly in a useEffect
```
useEffect(() => {
  setHistory({ past: [], future: [] });
  pendingCaptureRef.current = null;
}, [sessionKey]);
```
`react-hooks/set-state-in-effect`. Resets undo/redo history when the edit session changes.

### ⬜ 10. `hooks/useEditorHistory.ts:53` — ref mutated during render
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

### ⬜ 11. `hooks/useEditorHistory.ts:54` — ref mutated during render
Same issue as #10, second line of the same pair — fix both together.

---

## apps/worker (1 error)

### ⬜ 12. `apps/worker/src/app.module.ts:41` — prefer `??=`
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
