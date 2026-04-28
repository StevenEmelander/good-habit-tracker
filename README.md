# Good Habit Tracker

Single-page **habit tracker** (vanilla HTML/JS) with **AWS CDK** infrastructure: CloudFront, S3, Lambda@Edge (cookie / unlock-link gate), Lambda function URL + DynamoDB for sync. Mobile-first dark UI.

**License:** [MIT](./LICENSE) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md) · **Security:** [SECURITY.md](./SECURITY.md) · **Contributing:** [CONTRIBUTING.md](./CONTRIBUTING.md)

## Features

- User-defined categories and habits, points per habit, 14-day cycles (length is configurable)
- Entry / trends / plan tabs
- Cloud-only persistence via per-item REST (`/api/cycles`, `/api/entries`); no tracker data in `localStorage`
- DynamoDB: cycles row + per-day entries; reads are partition-targeted Query / GetItem (no Scans, no date-range parameters)

## Repository layout

| Path | Purpose |
|------|---------|
| `app/tracker.html` | Entire web app (inline CSS + JS) |
| `infrastructure/` | CDK app, sync + auth Lambda sources |
| `deploy.sh` / `deploy.ps1` | Install deps and run `cdk deploy` |

## Requirements

- Node.js 18+
- AWS credentials for the target account
- Route 53 **hosted zone** for your apex domain (the sample stacks use `vexom.io` and hostname `ght.vexom.io` — change for your fork; see [CONTRIBUTING.md](./CONTRIBUTING.md))

## Deploy

Set a long random **unlock token** (deploy secret). It is hashed for Lambda@Edge; the raw token is **not** written to CloudFormation outputs. After deploy, the scripts print a one-line unlock URL.

**Bash**

```bash
export UNLOCK_TOKEN='your-long-random-secret'
# optional: export BASE_URL='https://your.hostname'   # default https://ght.vexom.io
./deploy.sh
```

**PowerShell**

```powershell
$env:UNLOCK_TOKEN = 'your-long-random-secret'
# optional: $env:BASE_URL = 'https://your.hostname'
.\deploy.ps1
```

Stacks: `GoodHabitTrackerCert` (us-east-1 — ACM + Lambda@Edge) and `GoodHabitTracker` (us-west-2 — app + API). CDK orders them by dependency.

## Local synth (no deploy)

```bash
cd infrastructure
npm install
npm run build
npx cdk synth --context unlock_token=dummy-token-for-synth-only
```

## Maintainer

Steven Emelander

[CLAUDE.md](./CLAUDE.md) describes schema, auth flow, and editing constraints for this repo.

## Disclaimer

This software is provided as-is. It is not a substitute for professional medical or therapeutic advice. Use and deploy at your own risk.


