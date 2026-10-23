# Publishing

## Before the first release

1. **npm account.** Sign up at npmjs.com and turn on two-factor authentication (Account → Two-Factor
   Authentication; a passkey or an authenticator app). npm requires 2FA for publishing.
2. **Check the name is still free:** `npm view vitest-shard-balancer` should answer `404`.
3. **GitHub repository** `sidorovpavel/vitest-shard-balancer`, public, with this tree pushed to
   `main`. In Settings → Environments create an environment named `npm` — the publish workflow
   runs in it, and you can add yourself as a required reviewer there so a release waits for a
   click.

## First release — by hand

Trusted publishing is configured on the package's page, so the package has to exist first.

```sh
npm login                      # opens the browser
pnpm install && pnpm lint && pnpm typecheck && pnpm test
npm pack --dry-run             # read the file list: dist/, src/, README, LICENSE, package.json
npm version 0.1.0 --no-git-tag-version
npm publish                    # runs prepack → build; asks for the 2FA code
git commit -am "chore: release 0.1.0" && git tag v0.1.0 && git push --follow-tags
```

Then open https://www.npmjs.com/package/vitest-shard-balancer and check the README rendered.

## Switch to trusted publishing

On npmjs.com: the package → Settings → Trusted Publisher → GitHub Actions:
- Organization or user: `sidorovpavel`
- Repository: `vitest-shard-balancer`
- Workflow filename: `publish.yml`
- Environment: `npm`

Then, on the same page, set Publishing access to "Require two-factor authentication and disallow
tokens". From now on only that workflow can publish, and no token exists anywhere to steal.

## Every later release

```sh
npm version patch   # or minor / major — bumps package.json, commits and tags vX.Y.Z
git push --follow-tags
```

Then create a GitHub release from the tag (`gh release create v0.1.1 --generate-notes`). The
`publish.yml` workflow checks the tag matches `package.json`, runs the checks, and publishes with
a provenance attestation — the package page then shows which commit and workflow built it.

## Versioning

Semver, starting at `0.x`: while the major is `0`, a minor bump may break the API. Move to
`1.0.0` once the options feel settled. A mistake is fixed with a new version: `npm unpublish` is
allowed only within 72 hours and only for packages nobody depends on, and a version number can
never be reused. `npm deprecate vitest-shard-balancer@0.1.0 "reason"` marks a bad one.
