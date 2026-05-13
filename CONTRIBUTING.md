# Contributing

Thanks for your interest in contributing! This project is small and friendly to outside contributions — bug reports, feature requests, and pull requests are all welcome.

## Reporting issues

Before opening a new issue, please:

1. Search [existing issues](https://github.com/mirkostanic/obsidian-lego/issues) to avoid duplicates.
2. For bugs, include:
   - Obsidian version and OS.
   - The plugin version (see `manifest.json`).
   - Steps to reproduce, expected vs. actual behavior.
   - Any relevant console output.
3. For feature requests, describe the use case.

## Development setup

```bash
git clone https://github.com/mirkostanic/obsidian-lego.git
cd obsidian-lego
npm install
```

Common commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch-mode build for local development. |
| `npm run build` | Type-check (`tsc -noEmit`) and produce a production bundle. |
| `npm test` | Run the unit test suite (vitest). |
| `npm run test:watch` | Watch-mode tests. |
| `npm run test:coverage` | Tests with v8 coverage report. |
| `npm run lint` | ESLint over `src/`. |
| `npm run lint:fix` | ESLint with auto-fix. |

To test against a real vault, symlink (or copy) `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/brickset-lego/` and reload Obsidian.

## Code style

- TypeScript strict mode — avoid `any`. Brickset's JSON responses are typed in [`src/types.ts`](src/types.ts); add or extend an interface rather than reaching for `any`.
- Narrow `catch (error)` bindings with `error instanceof Error ? error.message : String(error)` before reading `.message`.
- Use Obsidian's popout-window-aware globals (`activeWindow.setTimeout`, `activeWindow.setInterval`, etc.) instead of the bare versions.
- Prefer Obsidian's `requestUrl` over `fetch` so the plugin keeps working on mobile.
- Comments should explain *why*, not *what*; obvious comments will be removed during review.

## Pull requests

1. Branch from `master` with a descriptive name (e.g. `fix/sync-back-debounce`, `feat/wishlist-section`).
2. Keep PRs focused — one logical change per PR is much easier to review.
3. Run `npm run lint`, `npm test`, and `npm run build` locally before pushing.
4. Add or update tests under `src/__tests__/` for any behavior change.
5. Open the PR against `master` and fill in the description: what changed, why, and how it was verified.

## Release flow

Maintainers cut releases by bumping the version and pushing to `master`:

```bash
npm version <patch|minor|major>   # updates package.json, manifest.json, versions.json
git push --follow-tags origin master
```

The [`release` GitHub Actions workflow](.github/workflows/release.yml) runs `npm ci`, the test suite, and the production build, then publishes a GitHub Release with `main.js`, `manifest.json`, and `styles.css` plus build provenance attestations.
