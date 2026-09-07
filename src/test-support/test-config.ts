import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AppWriteTestConfig {
	endpoint: string
	projectId: string
	databaseId: string
	bucketId: string
	apiKey: string
}

const configFilePath = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../../tests/.appwrite-config.json'
)

export function readTestConfig(): AppWriteTestConfig | undefined {
	if ( process.env.APPWRITE_EMULATE !== '1' ) return undefined

	let fileConfig: Partial<AppWriteTestConfig> = {}
	if ( fs.existsSync( configFilePath ) ) {
		fileConfig = JSON.parse( fs.readFileSync( configFilePath, 'utf-8' ) ) as Partial<AppWriteTestConfig>
	}

	const config: AppWriteTestConfig = {
		endpoint: process.env.APPWRITE_ENDPOINT || fileConfig.endpoint || 'http://localhost/v1',
		projectId: process.env.APPWRITE_PROJECT_ID || fileConfig.projectId || '',
		databaseId: process.env.APPWRITE_DATABASE_ID || fileConfig.databaseId || '',
		bucketId: process.env.APPWRITE_BUCKET_ID || fileConfig.bucketId || '',
		apiKey: process.env.APPWRITE_API_KEY || fileConfig.apiKey || ''
	}

	if ( !config.projectId || !config.databaseId || !config.bucketId ) return undefined
	return config
}

export function writeTestConfig( config: AppWriteTestConfig ) {
	fs.writeFileSync( configFilePath, JSON.stringify( config, null, 2 ) )
}

export function describeIntegration( name: string, fn: () => void ) {
	return readTestConfig() ? describe( name, fn ) : describe.skip( name, fn )
}