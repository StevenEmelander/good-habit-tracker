# Contributing

Thanks for your interest in this project.

## Principles

- Keep the app in a **single file**: `app/tracker.html` (inline CSS/JS, no frameworks or CDN assets).
- Prefer **small, focused changes** over drive-by refactors.
- Do not commit **secrets**: `unlock_token` is only passed at deploy time (`--context unlock_token=...` or `UNLOCK_TOKEN` in the deploy scripts). Never paste real tokens into issues or PRs.

## Local checks

From `infrastructure/`:

```bash
npm install
npm run build
npx cdk synth --context unlock_token=dummy-token-for-synth-only
```

The first `synth` / deploy that uses `HostedZone.fromLookup` may create `cdk.context.json` (ignored by git). That is expected.

## Forking and your own domain

The CDK stacks assume a Route 53 hosted zone and DNS names wired in code:

- `infrastructure/lib/cert-stack.ts` — ACM certificate domain, auth asset generation
- `infrastructure/lib/stack.ts` — CloudFront alternate domain, Route 53 `A` record name

Update those to match your zone and hostname before deploying. Search the repo for `ght.vexom.io` and `vexom.io` as a starting point.

## Maintainer notes

See [CLAUDE.md](./CLAUDE.md) for architecture, data schema, and editing conventions shared with automation tools.
