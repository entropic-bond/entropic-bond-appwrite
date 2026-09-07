# @entropic-bond/appwrite — Agent Guide

AppWrite plugins for Entropic Bond.

## Commands

| Action | Command |
|--------|---------|
| Test all | `npm test` (runs `vitest`) |
| Integration tests (requires Docker) | `npm run test:integration` |
| Build | `npm run build` (runs `vite build`) |
| Typecheck CLI scripts | `npm run typecheck:scripts` |
| AppWrite Cloud setup | `npm run setup:cloud -- --email you@example.com --password '****'` |

## Integration tests

The integration spec files require a running AppWrite instance. Use `npm run appwrite:up` (or `npm run test:integration`) to start the self-hosted AppWrite via Docker. The provisioning is handled by `src/test-support/setup.ts` (vitest `globalSetup`), which creates the project, database, collections, bucket, and API key. Integration specs are skipped when `APPWRITE_EMULATE` is not set.

## Dev environment note

Docker may not be available in the sandbox. The runnable unit tests (`appwrite-query.spec.ts`, `appwrite-auth.spec.ts`) run with plain `npm test`; the integration suites are skipped until an AppWrite instance is reachable (`APPWRITE_EMULATE=1`).
