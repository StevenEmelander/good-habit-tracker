# Security

## Reporting a vulnerability

If you believe you have found a security issue, please **do not** open a public GitHub issue with exploit details. Contact the repository maintainers privately (for example via GitHub Security Advisories if enabled for the repo, or email if listed in the repo profile).

## Deploy secrets

- **`unlock_token`** — used only at deploy/synth time. A SHA-256 digest is baked into the Lambda@Edge viewer function; the raw token must not be committed to git or stored in CloudFormation outputs.
- **CloudFront → sync Lambda** — uses a derived shared secret header; treat your deploy token as sensitive.

## Threat model

This stack is intended for **low-volume personal use** behind a simple cookie gate, not multi-tenant SaaS. Do not rely on it for high-sensitivity data without your own threat review and hardening.
