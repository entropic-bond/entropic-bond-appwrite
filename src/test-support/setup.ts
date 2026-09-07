import { Client, Databases, ID, Storage } from 'node-appwrite'
import { writeTestConfig } from './test-config'

type AttributeSpec = {
	key: string
	type: 'string' | 'integer' | 'boolean' | 'json'
	required?: boolean
	array?: boolean
}

const COLLECTION_ATTRIBUTES: Record<string, AttributeSpec[]> = {
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
	TestUser_SubClass: [
		{ key: 'id', type: 'string', required: true },
		{ key: '__className', type: 'string', required: true },
		{ key: '__parentId', type: 'string', required: true },
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
	]
}

export default async function setup() {
	if ( process.env.APPWRITE_EMULATE !== '1' ) return

	const endpoint = process.env.APPWRITE_ENDPOINT || 'http://localhost/v1'
	await waitForAppWrite( endpoint )

	let projectId = process.env.APPWRITE_PROJECT_ID || ''
	let apiKey = process.env.APPWRITE_API_KEY || ''

	if ( !projectId || !apiKey ) {
		const onboarding = await ensureProjectAndKey( endpoint )
		projectId = onboarding.projectId
		apiKey = onboarding.apiKey
	}

	const client = new Client().setEndpoint( endpoint ).setProject( projectId ).setKey( apiKey )
	const databases = new Databases( client )
	const storage = new Storage( client )

	const databaseId = process.env.APPWRITE_DATABASE_ID || 'entropic-bond-test'
	const bucketId = process.env.APPWRITE_BUCKET_ID || 'entropic-bond-bucket'

	await ensureDatabase( databases, databaseId )
	for ( const collectionId of Object.keys( COLLECTION_ATTRIBUTES ) ) {
		await ensureCollection( databases, endpoint, projectId, apiKey, databaseId, collectionId )
	}
	await ensureBucket( storage, bucketId )

	writeTestConfig({ endpoint, projectId, databaseId, bucketId, apiKey })
}

async function ensureDatabase( databases: Databases, databaseId: string ) {
	try {
		await databases.get( databaseId )
	}
	catch {
		await databases.create( databaseId, 'Entropic Bond Test' )
	}
}

async function ensureCollection( databases: Databases, endpoint: string, projectId: string, apiKey: string, databaseId: string, collectionId: string ) {
	try {
		await databases.getCollection( databaseId, collectionId )
		return
	}
	catch {
		// collection does not exist yet, create it below
	}

	await databases.createCollection( databaseId, collectionId, collectionId )

	for ( const attribute of COLLECTION_ATTRIBUTES[ collectionId ]! ) {
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

	await waitForAttributes( databases, databaseId, collectionId )
}

async function createJsonAttribute( endpoint: string, projectId: string, apiKey: string, databaseId: string, collectionId: string, key: string, required: boolean, array: boolean ) {
	const res = await fetch( `${ endpoint }/databases/${ databaseId }/collections/${ collectionId }/attributes/json`, {
		method: 'POST',
		headers: {
			'X-Appwrite-Project': projectId,
			'X-Appwrite-Key': apiKey,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ key, required, array })
	})

	if ( !res.ok && res.status !== 409 ) {
		throw new Error( `Failed to create json attribute ${ key }: ${ res.status } ${ await res.text() }` )
	}
}

async function waitForAttributes( databases: Databases, databaseId: string, collectionId: string ) {
	const expected = COLLECTION_ATTRIBUTES[ collectionId ]!.map( attribute => attribute.key )

	for ( let attempt = 0; attempt < 60; attempt++ ) {
		const { attributes } = await databases.listAttributes( databaseId, collectionId )
		const keys = attributes.map( attribute => attribute.key )
		if ( expected.every( key => keys.includes( key ) ) ) return
		await new Promise( resolve => setTimeout( resolve, 1000 ) )
	}

	throw new Error( `Attributes for collection ${ collectionId } were not created in time` )
}

async function ensureBucket( storage: Storage, bucketId: string ) {
	try {
		await storage.getBucket( bucketId )
	}
	catch {
		await storage.createBucket( bucketId, 'Entropic Bond Test', [ 'read("any")', 'create("any")', 'update("any")', 'delete("any")' ] )
	}
}

async function waitForAppWrite( endpoint: string ) {
	for ( let attempt = 0; attempt < 120; attempt++ ) {
		try {
			const res = await fetch( `${ endpoint }/health` )
			if ( res.ok ) return
		}
		catch {
			// server not up yet
		}
		await new Promise( resolve => setTimeout( resolve, 1000 ) )
	}
	throw new Error( `AppWrite server at ${ endpoint } did not become ready in time` )
}

/**
 * Best-effort first-boot provisioning of a project and API key.
 * On a fresh self-hosted AppWrite (development mode) the console setup
 * endpoint can be used to create the root account, a project and an API key.
 * Provide APPWRITE_ADMIN_EMAIL / APPWRITE_ADMIN_PASSWORD to override defaults.
 */
async function ensureProjectAndKey( endpoint: string ): Promise<{ projectId: string; apiKey: string }> {
	const email = process.env.APPWRITE_ADMIN_EMAIL || 'root@appwrite.io'
	const password = process.env.APPWRITE_ADMIN_PASSWORD || 'password'
	const projectId = ID.unique()

	const setupRes = await fetch( `${ endpoint }/console/setup`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: 'Root',
			email,
			password,
			terms: true,
			locale: 'en'
		})
	})

	if ( !setupRes.ok && setupRes.status !== 409 ) {
		throw new Error( `AppWrite first-boot setup failed (${ setupRes.status }): ${ await setupRes.text() }. Provide APPWRITE_PROJECT_ID and APPWRITE_API_KEY instead.` )
	}

	// Get a session to call the console API
	const sessionRes = await fetch( `${ endpoint }/console/account/sessions/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password })
	})
	if ( !sessionRes.ok ) {
		throw new Error( `Could not create a console session: ${ sessionRes.status } ${ await sessionRes.text() }` )
	}
	const cookies = sessionRes.headers.getSetCookie?.() ?? []

	const projectRes = await fetch( `${ endpoint }/console/projects`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			cookie: cookies.join( '; ' )
		},
		body: JSON.stringify({
			projectId,
			name: 'Entropic Bond Test',
			teamId: ID.unique(),
			locale: 'en'
		})
	})
	if ( !projectRes.ok ) {
		throw new Error( `Could not create the test project: ${ projectRes.status } ${ await projectRes.text() }` )
	}

	const keyRes = await fetch( `${ endpoint }/console/projects/${ projectId }/keys`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			cookie: cookies.join( '; ' )
		},
		body: JSON.stringify({
			name: 'Test Key',
			scopes: [
				'databases.read',
				'databases.write',
				'users.read',
				'users.write',
				'storage.read',
				'storage.write',
				'projects.read',
				'projects.write'
			]
		})
	})
	if ( !keyRes.ok ) {
		throw new Error( `Could not create the API key: ${ keyRes.status } ${ await keyRes.text() }` )
	}
	const keyData = await keyRes.json() as { secret: string }

	return { projectId, apiKey: keyData.secret }
}