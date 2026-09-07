# Entropic Bond for AppWrite

> AppWrite Plugins for Entropic Bond

Implements the Entropic Bond service abstractions on top of AppWrite:

- **Client** (`appwrite` Web SDK): `AppWriteDatasource`, `AppWriteAuth`, `AppWriteCloudStorage`, `AppWriteCloudFunctions`.
- **Server** (`node-appwrite`): `AppWriteServerDatasource`, `AppWriteServerAuth`.

## Installation

```bash
npm install @entropic-bond/appwrite
```

## Cloud setup (https://cloud.appwrite.io/)

The package ships a setup utility that provisions the AppWrite Cloud resources the
plugin needs: a project, a database, the entropic-bond collections (with schema
attributes), a storage bucket and a long-lived API key.

It requires Node.js >= 23.6 (native TypeScript support).

```bash
# Full setup: creates the project, an API key, database, collections and bucket
npm run setup:cloud -- --email you@example.com --password '****'

# Or reuse an existing project + API key (created in the Console)
npm run setup:cloud -- --project-id myproj --api-key 'standard_...' --output appwrite-config.json

# Custom collection schema
npm run setup:cloud -- --project-id myproj --api-key 'standard_...' \
  --collections ./my-collections.json --output appwrite-config.json
```

The utility prints (or writes with `--output`) a JSON config ready to use:

```json
{
  "client": { "endpoint": "https://cloud.appwrite.io/v1", "projectId": "...", "databaseId": "entropic-bond", "bucketId": "entropic-bond" },
  "server": { "endpoint": "https://cloud.appwrite.io/v1", "projectId": "...", "apiKey": "standard_...", "databaseId": "entropic-bond" }
}
```

If project or API-key auto-creation is not possible on your account, the utility
falls back to instructing you to create them in the Console and re-run with
`--project-id`/`--api-key`.

See `node scripts/setup-cloud.ts --help` for all options.

## Setup

### Client

```ts
import { AppWriteHelper, AppWriteDatasource } from '@entropic-bond/appwrite'
import { Store } from 'entropic-bond'

AppWriteHelper.setConfig({
  endpoint: 'https://cloud.appwrite.io/v1',
  projectId: 'YOUR_PROJECT_ID',
  databaseId: 'YOUR_DATABASE_ID',
  bucketId: 'YOUR_BUCKET_ID'
})

Store.useDataSource( new AppWriteDatasource() )
```

### Server

```ts
import { AppWriteServerHelper, AppWriteServerDatasource, AppWriteServerAuth } from '@entropic-bond/appwrite'
import { ServerAuth, Store } from 'entropic-bond'

AppWriteServerHelper.setConfig({
  endpoint: 'https://cloud.appwrite.io/v1',
  projectId: 'YOUR_PROJECT_ID',
  apiKey: 'YOUR_API_KEY',
  databaseId: 'YOUR_DATABASE_ID'
})

Store.useDataSource( new AppWriteServerDatasource() )
ServerAuth.useServerAuthService( new AppWriteServerAuth() )
```

## Known differences with Firestore

- AppWrite collections are **schema-typed**. Model attributes (`id`, `__className`, nested objects, arrays) must be pre-declared as collection attributes, or stored under a `json` attribute.
- **Subcollections are simulated with a root collection.** A logical path like `TestUser/{parentId}/SubClass` is stored in a dedicated AppWrite collection `TestUser_SubClass`; every document carries a `__parentId` attribute used to filter by parent. This collection must be pre-created with the model attributes plus a `__parentId` string attribute. `resolveCollectionPaths` and `onDocumentTemplateChange` are supported for the template `Parent/{id}/Sub` form.
- No cross-field `OR` in older AppWrite; `appwrite@26` provides `Query.or`/`Query.and`/`Query.containsAny`, which are used.
- No client-side X (Twitter) OAuth provider.
- Web SDK uploads expose progress but no pause/resume/cancel controls.
- Realtime is WebSocket-based (`client.subscribe`) instead of Firestore `onSnapshot`.
- `refreshToken`, `linkAdditionalProvider` and `unlinkProvider` are session-based / not natively supported.
- **`runTransaction` uses the native AppWrite transaction API** (`createTransaction` + staged `get`/`upsert`/`delete` operations + `updateTransaction` commit). It requires AppWrite server **1.8.0+** (the self-hosted test image is `appwrite/appwrite:1.8.0`). On commit conflict it rolls back and retries up to 5 attempts, then rejects with `TransactionConflictError`; callback errors (including a user-thrown `TransactionConflictError`) roll back and propagate as-is.

## Testing

Integration specs require a running AppWrite instance (self-hosted via Docker). See `AGENTS.md`.