#!/usr/bin/env node
/**
 * Entropic Bond — AppWrite Cloud setup utility.
 *
 * Creates (or reuses) the AppWrite Cloud resources the @entropic-bond/appwrite
 * plugin needs: a project, a database, entropic-bond collections (with schema
 * attributes), a storage bucket and a long-lived API key.
 *
 * Requirements:
 *   - Node.js >= 23.6 (native TypeScript type stripping)
 *   - An AppWrite Cloud account at https://cloud.appwrite.io/
 *
 * Usage:
 *   node scripts/setup-cloud.ts --email you@example.com --password '****'
 *   node scripts/setup-cloud.ts --project-id myproj --api-key '****' \
 *       --output appwrite-config.json
 *
 * Options:
 *   --email       Console account email (needed to create a project / API key)
 *   --password    Console account password
 *   --api-key     Existing API key (skips console login)
 *   --project-id  Project id ([a-z0-9-], max 36). If omitted and console
 *                 credentials are given, the project is created.
 *   --name        Project / resource name (default "Entropic Bond")
 *   --region      Project region (default "default")
 *   --database-id Database id (default "entropic-bond")
 *   --bucket-id   Storage bucket id (default "entropic-bond")
 *   --collections Path to a JSON file overriding the default collection schema:
 *                 { "CollectionId": [ { "key": "x", "type": "string|integer|boolean|json", "required": bool, "array": bool } ] }
 *   --endpoint    API endpoint (default https://cloud.appwrite.io/v1)
 *   --output      Write the resulting config JSON to this file (prints to stdout otherwise)
 *   --help        Show this help
 */

import { Client, Databases, ID, Storage } from 'node-appwrite'
import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_ENDPOINT = 'https://cloud.appwrite.io/v1'
const CONSOLE_PROJECT = 'console'

type AttributeType = 'string' | 'integer' | 'boolean' | 'json'

interface AttributeSpec {
	key: string
	type: AttributeType
	required?: boolean
	array?: boolean
}

type CollectionSpec = Record<string, AttributeSpec[]>

const DEFAULT_COLLECTIONS: CollectionSpec = {
	TestUser: [
		{ key: 'id', type: 'string', required: true },
		{ key: '__className', type: 'string', required: true },
		{ key: 'name', type: 'json' },
		{ key: 'age', type: 'integer' },
		{ key: 'admin', type: 'boolean' },
		{ key: 'skills', type: 'string', array: true },
		{ key: 'colleagues', type: 'json' },
		{ key: '__colleagues_searchable', type: 'string', array: true },
		{ key: 'salary', type: 'integer' },
		{ key: 'derived', type: 'json' },
		{ key: 'documentRef', type: 'json' },
		{ key: 'manyRefs', type: 'json' },
		{ key: 'manyDerived', type: 'json' }
	],
	SubClass: [
		{ key: 'id', type: 'string', required: true },
		{ key: '__className', type: 'string', required: true },
		{ key: 'year', type: 'integer' }
	],
	DerivedUser: [
		{ key: 'id', type: 'string', required: true },
		{ key: '__className', type: 'string', required: true },
		{ key: 'name', type: 'json' },
		{ key: 'age', type: 'integer' },
		{ key: 'admin', type: 'boolean' },
		{ key: 'skills', type: 'string', array: true },
		{ key: 'salary', type: 'integer' }
	],
	TestUser_SubClass: [
		{ key: 'id', type: 'string', required: true },
		{ key: '__className', type: 'string', required: true },
		{ key: '__parentId', type: 'string', required: true },
		{ key: 'year', type: 'integer' }
	]
}

const API_KEY_SCOPES = [
	'databases.read',
	'databases.write',
	'users.read',
	'users.write',
	'storage.read',
	'storage.write',
	'functions.read',
	'functions.write',
	'health.read'
]

interface Options {
	email?: string
	password?: string
	apiKey?: string
	projectId?: string
	name: string
	region: string
	databaseId: string
	bucketId: string
	collections: CollectionSpec
	endpoint: string
	output?: string
	help: boolean
}

function parseArgs( argv: string[] ): Options {
	const options: Options = {
		name: 'Entropic Bond',
		region: 'default',
		databaseId: 'entropic-bond',
		bucketId: 'entropic-bond',
		collections: DEFAULT_COLLECTIONS,
		endpoint: DEFAULT_ENDPOINT,
		help: false
	}

	const value = ( flag: string ): string | undefined => {
		const index = argv.indexOf( flag )
		return index >= 0 ? argv[ index + 1 ] : undefined
	}

	if ( argv.includes( '--help' ) || argv.includes( '-h' ) ) options.help = true

	options.email = value( '--email' )
	options.password = value( '--password' )
	options.apiKey = value( '--api-key' )
	options.projectId = value( '--project-id' )
	options.name = value( '--name' ) ?? options.name
	options.region = value( '--region' ) ?? options.region
	options.databaseId = value( '--database-id' ) ?? options.databaseId
	options.bucketId = value( '--bucket-id' ) ?? options.bucketId
	options.endpoint = value( '--endpoint' ) ?? options.endpoint
	options.output = value( '--output' )

	const collectionsFile = value( '--collections' )
	if ( collectionsFile ) {
		options.collections = loadJson( collectionsFile ) as CollectionSpec
	}

	return options
}

function loadJson( filePath: string ): unknown {
	return JSON.parse( readFileSync( filePath, 'utf-8' ) )
}

function log( message: string ) {
	console.log( `[setup] ${ message }` )
}

function fail( message: string ): never {
	console.error( `[setup] ERROR: ${ message }` )
	process.exit( 1 )
}

// ---------------------------------------------------------------------------
// Console (project / API key) helpers — require an authenticated console session
// ---------------------------------------------------------------------------

async function consoleLogin( endpoint: string, email: string, password: string ): Promise<string> {
	log( 'Signing in to the AppWrite Console...' )
	const res = await fetch( `${ endpoint }/account/sessions/email`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Appwrite-Project': CONSOLE_PROJECT
		},
		body: JSON.stringify({ email, password })
	})

	if ( !res.ok ) {
		const body = await res.text()
		fail( `Console login failed (${ res.status }): ${ body }` )
	}

	const cookies = res.headers.getSetCookie?.() ?? []
	const sessionCookie = cookies.join( '; ' )
	if ( !sessionCookie ) fail( 'Console login succeeded but no session cookie was returned' )
	return sessionCookie
}

async function consoleRequest( endpoint: string, path: string, session: string, method: string = 'GET', body?: unknown ): Promise<any> {
	const res = await fetch( `${ endpoint }${ path }`, {
		method,
		headers: {
			'content-type': 'application/json',
			'X-Appwrite-Project': CONSOLE_PROJECT,
			cookie: session
		},
		body: body ? JSON.stringify( body ) : undefined
	})

	const text = await res.text()
	const data = text ? JSON.parse( text ) : {}

	if ( !res.ok ) {
		throw new Error( `${ method } ${ path } failed (${ res.status }): ${ text }` )
	}
	return data
}

async function findOrCreateTeam( endpoint: string, session: string ): Promise<string> {
	try {
		const { teams } = await consoleRequest( endpoint, '/teams', session )
		if ( teams && teams.length > 0 ) return teams[ 0 ].$id as string
	}
	catch {
		// fall through to creating a team
	}

	const team = await consoleRequest( endpoint, '/teams', session, 'POST', {
		teamId: ID.unique(),
		name: 'Entropic Bond'
	})
	return team.$id as string
}

async function ensureProject( options: Options, session: string ): Promise<string> {
	if ( options.projectId ) return options.projectId

	const projectId = options.name.toLowerCase().replace( /[^a-z0-9-]/g, '-' ).slice( 0, 36 ) || 'entropic-bond'
	log( `Creating project "${ options.name }" (${ projectId })...` )

	try {
		const teamId = await findOrCreateTeam( options.endpoint, session )
		const project = await consoleRequest( options.endpoint, '/projects', session, 'POST', {
			projectId,
			name: options.name,
			teamId,
			region: options.region
		})
		return project.$id as string
	}
	catch( error ) {
		console.warn( `[setup] WARN: could not create the project automatically: ${ ( error as Error ).message }` )
		fail( 'Create the project in the AppWrite Console (https://cloud.appwrite.io/console), then re-run with --project-id.' )
	}
}

async function ensureApiKey( endpoint: string, session: string, projectId: string ): Promise<string> {
	log( `Creating an API key for project ${ projectId }...` )
	try {
		const key = await consoleRequest( endpoint, `/projects/${ projectId }/keys`, session, 'POST', {
			name: 'Entropic Bond',
			scopes: API_KEY_SCOPES
		})
		return key.secret as string
	}
	catch( error ) {
		console.warn( `[setup] WARN: could not create the API key automatically: ${ ( error as Error ).message }` )
		fail( 'Create a long-lived API key in the AppWrite Console (Project > Integration > API keys), then re-run with --api-key.' )
	}
}

// ---------------------------------------------------------------------------
// Data resource helpers — authenticated with the project API key
// ---------------------------------------------------------------------------

async function ensureDatabase( databases: Databases, databaseId: string ) {
	try {
		await databases.get( databaseId )
		log( `Database "${ databaseId }" already exists.` )
	}
	catch {
		await databases.create( databaseId, 'Entropic Bond' )
		log( `Created database "${ databaseId }".` )
	}
}

async function ensureCollection( databases: Databases, endpoint: string, projectId: string, apiKey: string, databaseId: string, collectionId: string, attributes: AttributeSpec[] ) {
	try {
		await databases.getCollection( databaseId, collectionId )
		log( `Collection "${ collectionId }" already exists.` )
		return
	}
	catch {
		// create it below
	}

	await databases.createCollection( databaseId, collectionId, collectionId )

	for ( const attribute of attributes ) {
		switch ( attribute.type ) {
			case 'string':
				await databases.createStringAttribute( databaseId, collectionId, attribute.key, 256, !!attribute.required, undefined, attribute.array )
				break
			case 'integer':
				await databases.createIntegerAttribute( databaseId, collectionId, attribute.key, !!attribute.required, undefined, undefined, undefined, attribute.array )
				break
			case 'boolean':
				await databases.createBooleanAttribute( databaseId, collectionId, attribute.key, !!attribute.required, undefined, attribute.array )
				break
			case 'json':
				await createJsonAttribute( endpoint, projectId, apiKey, databaseId, collectionId, attribute.key, !!attribute.required, !!attribute.array )
				break
		}
	}

	log( `Created collection "${ collectionId }" with ${ attributes.length } attributes.` )
}

async function createJsonAttribute( endpoint: string, projectId: string, apiKey: string, databaseId: string, collectionId: string, key: string, required: boolean, array: boolean ) {
	const res = await fetch( `${ endpoint }/databases/${ databaseId }/collections/${ collectionId }/attributes/json`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Appwrite-Project': projectId,
			'X-Appwrite-Key': apiKey
		},
		body: JSON.stringify({ key, required, array })
	})

	if ( !res.ok && res.status !== 409 ) {
		throw new Error( `Failed to create json attribute ${ key }: ${ res.status } ${ await res.text() }` )
	}
}

async function ensureBucket( storage: Storage, bucketId: string ) {
	try {
		await storage.getBucket( bucketId )
		log( `Bucket "${ bucketId }" already exists.` )
	}
	catch {
		await storage.createBucket( bucketId, 'Entropic Bond', [ 'read("any")', 'create("any")', 'update("any")', 'delete("any")' ] )
		log( `Created bucket "${ bucketId }".` )
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const options = parseArgs( process.argv.slice( 2 ) )

	if ( options.help ) {
		console.log( `Entropic Bond AppWrite Cloud setup utility

Usage:
  node scripts/setup-cloud.ts --email you@example.com --password '****' [options]
  node scripts/setup-cloud.ts --project-id myproj --api-key '****' [options]

Options:
  --email, --password   Console credentials (needed to create a project / API key)
  --api-key             Existing API key (skips console login)
  --project-id          Project id (lowercase letters, digits and hyphens, max 36)
  --name                Project / resource name (default "Entropic Bond")
  --region              Project region (default "default")
  --database-id         Database id (default "entropic-bond")
  --bucket-id           Storage bucket id (default "entropic-bond")
  --collections         Path to a JSON collection-spec file (overrides defaults)
  --endpoint            API endpoint (default ${ DEFAULT_ENDPOINT })
  --output              Write the config JSON to this file
  --help                Show this help` )
		return
	}

	if ( !options.email && !options.apiKey ) {
		fail( 'Provide either --email/--password (console) or --api-key. Run with --help for usage.' )
	}
	if ( options.email && !options.password ) fail( '--password is required when using --email.' )

	const endpoint = options.endpoint

	let apiKey = options.apiKey
	let projectId = options.projectId
	let session: string | undefined

	if ( !apiKey ) {
		if ( !options.email || !options.password ) fail( 'Console credentials are required to create an API key.' )
		session = await consoleLogin( endpoint, options.email, options.password )
		projectId = await ensureProject( options, session )
		apiKey = await ensureApiKey( endpoint, session, projectId )
	}

	if ( !projectId ) fail( 'A --project-id is required when using --api-key.' )

	log( `Provisioning resources for project "${ projectId }"...` )
	const client = new Client().setEndpoint( endpoint ).setProject( projectId ).setKey( apiKey )
	const databases = new Databases( client )
	const storage = new Storage( client )

	await ensureDatabase( databases, options.databaseId )

	for ( const [ collectionId, attributes ] of Object.entries( options.collections ) ) {
		await ensureCollection( databases, endpoint, projectId, apiKey, options.databaseId, collectionId, attributes )
	}

	await ensureBucket( storage, options.bucketId )

	const config = {
		client: {
			endpoint,
			projectId,
			databaseId: options.databaseId,
			bucketId: options.bucketId
		},
		server: {
			endpoint,
			projectId,
			apiKey,
			databaseId: options.databaseId
		}
	}

	const output = JSON.stringify( config, null, 2 )
	if ( options.output ) {
		writeFileSync( options.output, output + '\n' )
		log( `Configuration written to ${ options.output }` )
	}
	else {
		log( 'Setup complete. Configuration:' )
		console.log( output )
	}
}

main().catch( error => {
	console.error( `[setup] ERROR: ${ ( error as Error ).message ?? String( error ) }` )
	process.exit( 1 )
})