import { Client, Databases, Storage, Users } from 'node-appwrite'

export interface AppWriteServerConfig {
	endpoint: string
	projectId: string
	apiKey: string
	databaseId?: string
}

export class AppWriteServerHelper {

	static setConfig( config: AppWriteServerConfig ) {
		AppWriteServerHelper._config = config
	}

	private constructor() {
		if ( !AppWriteServerHelper._config ) throw new Error( 'You should set an AppWrite server config object before using AppWrite' )
		this._client = new Client()
			.setEndpoint( AppWriteServerHelper._config.endpoint )
			.setProject( AppWriteServerHelper._config.projectId )
			.setKey( AppWriteServerHelper._config.apiKey )
	}

	static get instance() {
		return this._instance || ( this._instance = new AppWriteServerHelper() )
	}

	static get config(): AppWriteServerConfig {
		if ( !AppWriteServerHelper._config ) throw new Error( 'You should set an AppWrite server config object before using AppWrite' )
		return AppWriteServerHelper._config
	}

	static get databaseId(): string {
		if ( !AppWriteServerHelper._config?.databaseId ) throw new Error( 'You should define a databaseId in the AppWrite server config' )
		return AppWriteServerHelper._config.databaseId
	}

	client() {
		return this._client
	}

	databases() {
		return this._databases || ( this._databases = new Databases( this._client ) )
	}

	users() {
		return this._users || ( this._users = new Users( this._client ) )
	}

	storage() {
		return this._storage || ( this._storage = new Storage( this._client ) )
	}

	private static _instance: AppWriteServerHelper
	private static _config: AppWriteServerConfig | undefined
	private _client: Client
	private _databases: Databases | undefined
	private _users: Users | undefined
	private _storage: Storage | undefined
}