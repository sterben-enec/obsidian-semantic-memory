# Security Policy

## Supported versions

This project is currently maintained on the latest `main` branch.

## Reporting a vulnerability

Please do **not** open public issues for secrets exposure, auth bypass, unsafe network exposure, or data-leak vulnerabilities.

Instead, report privately to:

- sterben.enec@gmail.com

Include:

- affected version / commit
- reproduction steps
- impact assessment
- whether the issue can expose note contents, facts, or local filesystem paths

## Security expectations

`obsidian-semantic-memory` is designed for local-first use:

- HTTP API binds to `127.0.0.1` by default
- MCP transport is stdio-only
- secrets and private notes should be excluded via `.semanticignore`
- local `.env` files should never be committed
