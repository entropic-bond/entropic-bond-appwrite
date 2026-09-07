import { Account, Client, Databases, Functions, Storage } from 'appwrite'

export interface AppWriteConfig {
	endpoint: string
	projectId: string
	databaseId: string
	bucketId?: string
	resetPasswordUrl?: string
}

export class AppWriteHelper {

	static setConfig( config: AppWriteConfig ) {
		AppWriteHelper._config = config
	}

	private constructor() {
		if ( !AppWriteHelper._config ) throw new Error( 'You should set an AppWrite config object before using AppWrite' )
		this._client = new Client()
			.setEndpoint( AppWriteHelper._config.endpoint )
			.setProject( AppWriteHelper._config.projectId )
	}

	static get instance() {
		return this._instance || ( this._instance = new AppWriteHelper() )
	}

	static get config(): AppWriteConfig {
		if ( !AppWriteHelper._config ) throw new Error( 'You should set an AppWrite config object before using AppWrite' )
		return AppWriteHelper._config
	}

	client() {
		return this._client
	}

	databases() {
		return this._databases || ( this._databases = new Databases( this._client ) )
	}

	storage() {
		return this._storage || ( this._storage = new Storage( this._client ) )
	}

	account() {
		return this._account || ( this._account = new Account( this._client ) )
	}

	functions() {
		return this._functions || ( this._functions = new Functions( this._client ) )
	}

	private static _instance: AppWriteHelper
	private static _config: AppWriteConfig | undefined
	private _client: Client
	private _databases: Databases | undefined
	private _storage: Storage | undefined
	private _account: Account | undefined
	private _functions: Functions | undefined
}