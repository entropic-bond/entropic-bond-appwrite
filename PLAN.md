# Plan: `@entropic-bond/appwrite` — AppWrite plugin for Entropic Bond

## Status

- **Decisions locked**: Docker self-hosted AppWrite for tests · Client + server scope in a single package · name `@entropic-bond/appwrite`, directory `entropic-bond-appwrite/`.
- **Workflow**: TDD per `AGENTS.md` (failing test → minimal implementation → refactor). Notify via `paplay`/`ntfy.sh` on completion / before asking for input.

---

## 1. Overview

Create a new monorepo subproject `entropic-bond-appwrite/` that mirrors the structure and conventions of `@entropic-bond/firebase` (client) and `@entropic-bond/firebase-admin` (server), adapted to Appwrite.

The package exposes implementations of the four entropic-bond service abstractions plus the two helper classes and a barrel export:

| entropic-bond abstraction | Client (`appwrite`) | Server (`node-appwrite`) |
|---|---|---|
| `DataSource` | `AppWriteDatasource` | `AppWriteServerDatasource` |
| `AuthService` | `AppWriteAuth` | — |
| `ServerAuthService` | — | `AppWriteServerAuth` |
| `CloudStorage` | `AppWriteCloudStorage` | — |
| `CloudFunctionsService` | `AppWriteCloudFunctions` | — |
| helper | `AppWriteHelper` | `AppWriteServerHelper` |

Client module mirrors `@entropic-bond/firebase`; server module mirrors `@entropic-bond/firebase-admin` (server = datasource + ServerAuth + helper only).

## 2. Directory structure

```
entropic-bond-appwrite/
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── PLAN.md
├── package.json
├── tsconfig.json
├── tsconfig-build.json
├── vite.config.ts
├── .gitignore
├── .github/workflows/           # semantic-release CI on master (mirror firebase)
├── docker-compose.test.yml      # self-hosted Appwrite for integration tests
├── tests/
│   └── setup.ts                 # vitest globalSetup: provision resources
└── src/
    ├── index.ts                 # barrel: export * from every module
    ├── appwrite-helper.ts
    ├── appwrite-server-helper.ts
    ├── store/
    │   ├── appwrite-datasource.ts
    │   ├── appwrite-datasource.spec.ts
    │   ├── appwrite-server-datasource.ts
    │   └── appwrite-server-datasource.spec.ts
    ├── cloud-storage/
    │   ├── appwrite-cloud-storage.ts
    │   └── appwrite-cloud-storage.spec.ts
    ├── auth/
    │   ├── appwrite-auth.ts
    │   └── appwrite-auth.spec.ts
    ├── server-auth/
    │   ├── appwrite-server-auth.ts
    │   └── appwrite-server-auth.spec.ts
    ├── cloud-functions/
    │   ├── appwrite-cloud-functions.ts
    │   └── appwrite-cloud-functions.spec.ts
    └── mocks/
        ├── test-user.ts         # copied from @entropic-bond/firebase
        └── mock-data.json       # copied from @entropic-bond/firebase
```

## 3. Helpers

### 3.1 `AppWriteHelper` (client) — mirrors `FirebaseHelper`

```ts
export interface AppWriteConfig {
  endpoint: string      // e.g. 'http://localhost/v1'
  projectId: string
  databaseId: string
  bucketId?: string
}
```

- `static setConfig(config: AppWriteConfig)`.
- Singleton `instance`; throws if used before `setConfig`.
- `client()` → shared `Client` (`.setEndpoint(config.endpoint).setProject(config.projectId)`).
- `databases()`, `storage()`, `account()`, `functions()` — lazily created from the shared `Client`.
- `useSelfSigned()` → `client.setSelfSigned()` (needed for self-hosted HTTP / self-signed TLS).
- `static _instance`, `_config` statics.

### 3.2 `AppWriteServerHelper` (server) — mirrors `FirebaseAdminHelper`

```ts
export interface AppWriteServerConfig {
  endpoint: string
  projectId: string
  apiKey: string
  databaseId?: string
}
```

- `static setConfig(config: AppWriteServerConfig)`.
- Singleton `instance`.
- `client()` → `new Client().setEndpoint(...).setProject(...).setKey(...)`.
- `databases()`, `users()`, `storage()`.

## 4. Store

### 4.1 `AppWriteDatasource extends DataSource` (client, `appwrite`)
### 4.2 `AppWriteServerDatasource extends DataSource` (server, `node-appwrite`)

Shared translation logic; different SDK instances (web `Databases` vs server `Databases`). Each class keeps its own private cursor/limit state.

| entropic-bond | Appwrite mapping | Notes |
|---|---|---|
| `findById(id, col)` | `databases.getDocument(dbId, col, id)` | catch `AppwriteException` 404 → resolve `undefined` |
| `save(collections)` | `databases.upsertDocument(dbId, col, doc.id, data)` per document | upsert = create-or-update, matches Firebase `batch.set` overwrite semantics. `data` = document object as-is (includes `id`, `__className`, props). Strip `__rootCollections` defensively. |
| `find(query, col)` | translate ops → `Query[]` → `listDocuments(dbId, col, queries)` → map `$id` into `id` when `id` attribute absent | return `.documents.map(d => d as DocumentObject)` |
| `count(query, col)` | `listDocuments(dbId, col, queries).total` | build query **without** `Query.limit` |
| `delete(id, col)` | `databases.deleteDocument(dbId, col, id)` | |
| `next(limit)` | rebuild last query with `Query.limit(n)` + `Query.cursorAfter(lastDocId)` | store last document `$id`; return `[]` when none |
| `onCollectionChange` | client: `client.subscribe('databases.<db>.collections.<col>.documents', cb)` | server: throw `'Method not implemented.'` |
| `onDocumentChange` | client: `client.subscribe('databases.<db>.collections.<col>.documents.<id>', cb)` | server: throw |
| `onDocumentTemplateChange` | throw `'Method not implemented.'` | no subcollections |
| `resolveCollectionPaths` | throw `'Method not implemented.'` | same as client Firebase plugin |

**Query operator translation** (`toAppwriteQuery(operator)`):

| entropic-bond `QueryOperator` | Appwrite `Query` |
|---|---|
| `==` | `Query.equal(prop, value)` |
| `!=` | `Query.notEqual(prop, value)` |
| `<` | `Query.lessThan(prop, value)` |
| `<=` | `Query.lessThanEqual(prop, value)` |
| `>` | `Query.greaterThan(prop, value)` |
| `>=` | `Query.greaterThanEqual(prop, value)` |
| `contains` | `Query.contains(prop, value)` |
| `containsAny` | **no direct equivalent** — flag/throw or map via `Query.or` of `contains` when SDK supports it |

- Sort: `QueryObject.sort` → `Query.orderAsc(prop)` / `Query.orderDesc(prop)`.
- Limit: `QueryObject.limit` → `Query.limit(n)`.
- Use `DataSource.toPropertyPathOperations(operations)` first (as Firebase plugin does) so deep paths and searchable-array names are handled.
- **Cross-field OR** (`operation.aggregate`): Appwrite has no native cross-field OR (only OR across values of a single operator). Decision: translate `aggregate` on the same property into `Query.equal(prop, [v1, v2, ...])`; cross-field OR → throw a descriptive error. Document in README.

**Realtime mapping for `onCollectionChange` / `onDocumentChange`** (client only):
- Subscribe with the exact channel string for the pinned `appwrite` SDK version; verify against installed SDK (channel API changed across versions). Modern: `databases.{databaseId}.collections.{collectionId}.documents` and `...documents.{documentId}`.
- Payload events: `...create` / `...update` / `...delete`. Map to `DocumentChange<DocumentObject>` with `type` derived from the event name, `after`/`before` from payload (before typically unavailable → `undefined`), `collectionPath` from the collection id.
- Return an unsubscribe function (client `subscribe` already returns one).

## 5. Cloud Storage — `AppWriteCloudStorage extends CloudStorage` (client)

- `save(id, data, progress?)` → `storage.createFile(bucketId, id, file, undefined, undefined, onProgress)`.
  - Convert `StorableData` (`File | Blob | Uint8Array | ArrayBuffer`) → `File` for the browser SDK. Node/test path uses `InputFile.fromBuffer(...)` (see tests).
  - Wire `progress` → the SDK `onProgress` callback `(uploadedBytes, totalBytes)`; fall back to no progress where unsupported.
  - Return the file id on success.
- `getUrl(reference)` → `storage.getFileDownload(bucketId, reference)` (returns a URL string). Reject when reference empty (mirror Firebase).
- `delete(reference)` → `storage.deleteFile(bucketId, reference)`.
- `uploadControl()` → return control object; `pause`/`resume`/`cancel` are no-ops (Appwrite Web SDK does not expose them), `onProgress` wired to the createFile progress. Document this limitation.
- `@registerCloudStorage('AppWriteCloudStorage', () => new AppWriteCloudStorage())` decorator + `__className` (mirror Firebase) so `StoredFile.provider.className` reports `AppWriteCloudStorage`.

## 6. Auth — `AppWriteAuth extends AuthService` (client)

| entropic-bond | Appwrite mapping |
|---|---|
| `signUp` email | `account.create(ID.unique(), email, password, name)`; then `createVerification(verificationLink)` when `verificationLink` provided |
| `signUp`/`login` google | `account.createOAuth2Session('google')` |
| `signUp`/`login` facebook | `account.createOAuth2Session('facebook')` |
| `login` email | `account.createEmailPasswordSession(email, password)` |
| `logout` | `account.deleteSession('current')` |
| `resetEmailPassword` | `account.createRecovery(email, url)` — requires a recovery URL (derive from `signData.verificationLink` pattern; add config default) |
| `resendVerificationEmail` | `account.createVerification(verificationLink)` after ensuring a session |
| `refreshToken` | `account.getSession('current')` (session-cookie based; no manual token refresh) |
| `onAuthStateChange` | realtime: `client.subscribe('account', cb)` → `account.get()` → `toUserCredentials` or `undefined` |
| `linkAdditionalProvider` | not natively supported — throw descriptive error |
| `unlinkProvider` | not natively supported — throw descriptive error |

- Provider registry mirrors Firebase's `credentialProviders` map (email-sign-up, email, google, facebook). **Twitter/X is not an Appwrite OAuth2 provider** → omit / throw.
- `toUserCredentials` maps `Models.User`:
  - `id: user.$id`
  - `email: user.email`
  - `name: user.name`
  - `emailVerified: user.emailVerification`
  - `phoneNumber: user.phone`
  - `pictureUrl: undefined` (Appwrite user has no photo field)
  - `customData: user.prefs`
  - `creationDate: Date.parse(user.registration)`
  - `lastLogin: Date.parse(user.accessedAt)`
- Auth spec kept minimal/placeholder (mirror Firebase's disabled auth spec) because OAuth flows are not automatable against self-hosted Appwrite without a browser.

## 7. Server Auth — `AppWriteServerAuth extends ServerAuthService` (server)

| entropic-bond | Appwrite mapping |
|---|---|
| `getUser(userId)` | `users.get(userId)`; catch `AppwriteException` 404 → `undefined` |
| `setCustomCredentials(userId, prefs)` | `users.updatePrefs(userId, prefs)` |
| `updateUser(userId, credentials)` | dispatch partial updates: `updateName`, `updateEmail`, `updatePhone`, `updatePrefs` per present field; return `convertToUserCredentials(updatedUser)` |
| `deleteUser(userId)` | `users.delete(userId)`; catch 404 → resolve (no-op) |

- `convertToUserCredentials` reuses the same `Models.User` mapping as §6.

## 8. Cloud Functions — `AppWriteCloudFunctions implements CloudFunctionsService` (client)

- `retrieveFunction<P, R>(name)` → returns a `CloudFunction<P, R>` that calls `functions.createExecution(name, JSON.stringify(params), false)` (synchronous execution).
- `callFunction(func, params)` → `func(params)`; extract result from `execution.response` (JSON string) → `JSON.parse(...)`.
- Note: AppWrite executes functions server-side; `execute` permission must be granted to the client role.

## 9. Barrel (`src/index.ts`)

```ts
export * from './appwrite-helper'
export * from './appwrite-server-helper'
export * from './store/appwrite-datasource'
export * from './store/appwrite-server-datasource'
export * from './cloud-storage/appwrite-cloud-storage'
export * from './auth/appwrite-auth'
export * from './server-auth/appwrite-server-auth'
export * from './cloud-functions/appwrite-cloud-functions'
```

## 10. Tooling

### `package.json`
- `name: "@entropic-bond/appwrite"`, `type: module`, `version: 1.0.0`.
- `main`/`module`/`exports`/`types` → `./lib/...` (vite lib output `entropic-bond-appwrite`).
- `files: ["lib"]`, `publishConfig` (public, master), `release` plugins (semantic-release standard set) — mirror firebase.
- `scripts`:
  - `"test": "docker compose -f docker-compose.test.yml up -d && vitest && docker compose -f docker-compose.test.yml down"`
  - `"build": "vite build"`, `"prepare": "npm run build"`.
- `dependencies`: `entropic-bond`, `appwrite`, `node-appwrite`.
- `devDependencies`: `vitest`, `vite`, `vite-plugin-dts`, `typescript`, `semantic-release` + plugins, `@types/node`.
- `allowScripts` entries as needed (mirror firebase pattern).

### `tsconfig.json` / `tsconfig-build.json` / `vite.config.ts`
Copied and adapted from `@entropic-bond/firebase` (`tsconfig-build.json` excludes `*.spec.ts`; `vite.config.ts` lib entry `src/index.ts`, name `entropic-bond-appwrite`, dts plugin).

## 11. Testing infrastructure (Docker)

### 11.1 `docker-compose.test.yml`
- `appwrite/appwrite` image, `_APP_ENV=development`, ports (e.g. `80:80` or `9500:9500`), volume for data. Healthcheck on the endpoint.
- Appwrite self-hosted needs first-boot admin setup; the provisioning step below uses the root/system credentials.

### 11.2 `tests/setup.ts` (vitest `globalSetup`)
Provisions once, before the test suite:
1. Wait for the Appwrite endpoint to be ready.
2. Create (or reuse) a project.
3. Create the database.
4. Create collections for `TestUser`, `SubClass`, `DerivedUser` with typed attributes matching the model (incl. `id` string, `__className` string, nested `name`, arrays `skills`, `colleagues`, searchable array `__colleagues_searchable`; use `json` attribute where schema is awkward).
5. Create a storage bucket.
6. Create an API key (for server datasource / provisioning).
7. Publish the config (endpoint, projectId, databaseId, bucketId, apiKey) via a shared global (e.g. `globalThis.__APPWRITE_TEST__` or an env-derived module).

### 11.3 Specs
- `appwrite-datasource.spec.ts`: port of firebase's `firebase-datasource.spec.ts` (CRUD, generic/compound queries, searchable array, references, operations/limit/sort/count/cursors, listeners where supported). `beforeEach` loads `mock-data.json`; `afterEach` wipes the collections.
- `appwrite-server-datasource.spec.ts`: port of `firebase-admin-datasource.spec.ts` (CRUD + queries; listeners skipped/`not implemented`).
- `appwrite-cloud-storage.spec.ts`: port of `firebase-cloud-storage.spec.ts` using `InputFile.fromBuffer` for uploads; assert save/getUrl/delete/provider.className.
- `appwrite-server-auth.spec.ts`: port of `firebase-server-auth.spec.ts` (getUser, setCustomCredentials/updatePrefs, updateUser, deleteUser).
- `appwrite-auth.spec.ts`: placeholder (mirror firebase disabled auth spec).
- `appwrite-cloud-functions.spec.ts`: requires a deployed function; keep `describe.skip` port of the firebase spec (deploy function in provisioning if desired, else skip).

### 11.4 Mocks
- `src/mocks/test-user.ts` and `src/mocks/mock-data.json` copied verbatim from `@entropic-bond/firebase` to keep test parity.

## 12. CI / Release
- `.github/workflows/`: mirror firebase plugin — on `master`, `npm ci && npm test && npm run build && npx semantic-release`.

## 13. Known Appwrite vs Firestore differences (document in README)
- Collections are **schema-typed**; model attributes (`id`, `__className`, nested objects) must be pre-declared or use the `json` attribute type.
- No subcollections → `resolveCollectionPaths` / `onDocumentTemplateChange` / server listeners unsupported.
- No cross-field `OR`; `containsAny` unsupported.
- No client-side X (Twitter) OAuth provider.
- No upload pause/resume on the Web SDK; only progress.
- Realtime uses WebSocket channels, not Firestore `onSnapshot`.
- `refreshToken`/`linkAdditionalProvider`/`unlinkProvider` diverge (session-based / unsupported).

## 14. Implementation order (TDD)
1. Scaffold: `package.json`, `tsconfig*`, `vite.config.ts`, `AGENTS.md`, `README.md`, `.gitignore`, `.github/workflows`.
2. Helpers: `appwrite-helper.ts`, `appwrite-server-helper.ts`.
3. Mocks: copy `test-user.ts`, `mock-data.json`.
4. Docker compose + `tests/setup.ts` provisioning.
5. Store: write failing `appwrite-datasource.spec.ts` → implement `AppWriteDatasource`.
6. Server store: failing spec → `AppWriteServerDatasource`.
7. Cloud storage: failing spec → `AppWriteCloudStorage`.
8. Server auth: failing spec → `AppWriteServerAuth`.
9. Cloud functions: spec → `AppWriteCloudFunctions` (skip if no function deployed).
10. Auth: placeholder spec → `AppWriteAuth` (basic email path; OAuth documented as untestable).
11. Barrel `index.ts`; run full `npm test` + `npm run build`; CI workflow.

## 15. Implementation notes / deviations

Implemented as of 2026-08-26.

- **`runTransaction` (native AppWrite transactions)**: `AppWriteDatasource` and `AppWriteServerDatasource` implement `runTransaction` using the AppWrite transaction API — `createTransaction`, staged `getDocument`/`upsertDocument`/`deleteDocument` calls threaded with the `transactionId`, and `updateTransaction(commit: true)`. Commit conflicts (Appwrite `409`) roll back and are retried up to 5 attempts, then reject with `TransactionConflictError`; callback errors roll back and propagate as-is. **Requires AppWrite server ≥ 1.8.0** — the self-hosted test image in `docker-compose.test.yml` was bumped from `1.6.1` to `1.8.0`. Behavior is unit-tested with a mocked SDK (`appwrite-transaction.spec.ts`, `appwrite-server-transaction.spec.ts`) and integration-tested in the datasource specs. Reads inside a transaction use the `transactionId` (read-your-writes); subcollection paths are mapped through `mapCollectionPath` as usual.
- **AppWrite SDK v26 confirmed APIs**: `Query.or`, `Query.and` and `Query.containsAny` DO exist in `appwrite@26`. So the cross-field `OR` (`aggregate`) and `containsAny` are fully translated (see `buildQueryConstraints` in `appwrite-datasource.ts`) and unit-tested in `appwrite-query.spec.ts`.
- **`getFileDownload` returns a plain string** (not a promise) in v26 — `AppWriteCloudStorage.getUrl` wraps it in `Promise.resolve`.
- **`node-appwrite@28` has no `createJsonAttribute`** — the provisioning script creates `json` attributes via raw REST (`POST .../attributes/json`).
- **Docker unavailable in the sandbox**: integration suites are gated behind `APPWRITE_EMULATE=1` (see `src/test-support/test-config.ts` `describeIntegration`). Runnable unit tests: `appwrite-query.spec.ts` (14 tests) and `appwrite-auth.spec.ts` (credential conversion). Run integration with `npm run test:integration` (starts Docker Compose + provisions via `src/test-support/setup.ts`).
- **Test helpers live in `src/test-support/`** (not `tests/`) so they stay inside tsconfig `rootDir: "src"`. `tests/` only holds the generated `.appwrite-config.json`.
- **Deep-property queries on nested objects** (`name.firstName`, `orderByDeepProp('name.firstName')`) are skipped in the integration specs: AppWrite cannot filter/sort on subfields of a `json` attribute.
- **Auth**: email sign-up/login implemented (`account.create`, `account.createEmailPasswordSession`); OAuth providers (`google`/`facebook`) throw a descriptive error because AppWrite uses a redirect flow with no promise resolution. `resetEmailPassword` requires `resetPasswordUrl` in the config.
- **Subcollection simulation**: AppWrite has no native subcollections. `mapCollectionPath` (in `src/store/collection-mapper.ts`) maps a logical path `Parent/{parentId}/Sub` onto a dedicated root AppWrite collection `Parent_Sub`; saved documents store a `__parentId` attribute and queries filter by it. `resolveCollectionPaths` and `onDocumentTemplateChange` are implemented for the `Parent/{id}/Sub` template form. The simulated root collection must declare the model attributes plus a `__parentId` string attribute (the test provisioning does this for `TestUser_SubClass`).
- **Cloud setup utility**: `scripts/setup-cloud.ts` (Node >= 23.6 native TS) provisions an AppWrite Cloud project, database, collections, bucket and API key. It authenticates against the Console API (`POST /account/sessions/email` with `X-Appwrite-Project: console`) to create the project and a long-lived API key, then uses `node-appwrite` with the key to create the data resources. Project/API-key auto-creation is best-effort; on failure it instructs the user to create them in the Console and re-run with `--project-id`/`--api-key`. Exposed via the `entropic-bond-appwrite-setup` bin and `npm run setup:cloud`. Type-checked by `tsconfig.scripts.json` (`npm run typecheck:scripts`).