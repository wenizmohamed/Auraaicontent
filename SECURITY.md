# Security policy

We take security seriously. RadixContent handles agency client data — campaign briefs, brand guidelines, generated content, and (post-Phase-2) Stripe billing.

## Reporting a vulnerability

Email: **security@radixmedia.com** (or hadi.chehayeb345@gmail.com if the security alias hasn't been provisioned yet).

Please include:
- A description of the issue and its potential impact
- Steps to reproduce
- Affected versions / commits if known
- Your contact info (so we can credit you in the fix announcement, if you want)

Do **not** open a public GitHub issue for a security report. Do **not** post to Slack/Discord.

## Response targets

- Acknowledgement: within 48 hours
- Triage + impact assessment: within 5 business days
- Fix released: 30 days for high/critical, 90 days for medium/low

## Scope

In scope:
- The Fastify API (`/opt/radix-v2/server/`)
- The desktop / web frontend (`/opt/radixcontent/apps/desktop/`)
- The hosted instance at `radix.synapseai-labs.com`
- Multi-tenancy isolation (cross-org data leaks are top priority)
- Authentication and authorization flows
- Stripe webhook handler (signature validation, replay protection)
- Public review-link endpoints (unauthenticated by token)

Out of scope:
- Theoretical attacks on Anthropic / Google / xAI / Moonshot infrastructure (report to those vendors)
- Issues requiring physical access to the VPS
- Findings purely about missing security headers on third-party-hosted assets

## Hall of fame

(Reserved for credited reporters.)
