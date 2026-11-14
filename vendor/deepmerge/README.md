# deepmerge (patched, vendored)

Copy of [deepmerge](https://github.com/TehShrike/deepmerge) 4.3.1 (`dist/cjs.js`), MIT licensed (see license.txt).

jest (`jest-config`) depends on it. Upstream is unmaintained and has no fix for
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) (prototype poisoning in `mergeObject`),
so the `overrides` in the root `package.json` point every `deepmerge` at this folder.

The only change: `mergeObject` skips `__proto__` keys on both the target and the source side.

Delete this folder and the override once upstream (or jest) ships a fixed version.
