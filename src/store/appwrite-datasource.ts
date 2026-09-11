import { AppwriteException, Channel, Models, Query } from 'appwrite'
import { CollectionChangeListener, Collections, DataSource, DocumentChange, DocumentChangeListener, DocumentObject, QueryObject, QueryOperator, TransactionConflictError, TransactionHandle, Unsubscriber } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'
import { mapCollectionPath } from './collection-mapper'

type RealtimeDocument = Models.Document & Record<string, unknown>

const MAX_FETCH_CHUNK = 5000
const MAX_PAGINATION_ROUNDS = 100
const MAX_TRANSACTION_ATTEMPTS = 5

function isConflictError( error: unknown ): boolean {
	if ( !( error instanceof AppwriteException ) ) return false
	if ( error.code === 409 ) return true
	return /transaction.{0,20}conflict|conflict/i.test( error.message )
}

export class AppWriteDatasource extends DataSource {

	findById( id: string, collectionName: string ): Promise<DocumentObject> {
		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()
		const { collectionId } = mapCollectionPath( collectionName )

		return new Promise<DocumentObject>( async resolve => {
			try {
				const doc = await db.getDocument( databaseId, collectionId, id )
				resolve( AppWriteDatasource.toDocumentObject( doc ) )
			}
			catch( error ) {
				if ( ( error as AppwriteException ).code === 404 ) resolve( undefined as unknown as DocumentObject )
				else throw error
			}
		})
	}

	save( collections: Collections ): Promise<void> {
		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()

		const writes = Object.entries( collections ).flatMap(([ collectionPath, collection ]) => {
			const { collectionId, parentId } = mapCollectionPath( collectionPath )
			return ( collection ?? [] ).map( document => {
				const { id, ...data } = document
				const dataToStore = parentId ? { ...data, __parentId: parentId } : data
				return db.upsertDocument( databaseId, collectionId, document.id, dataToStore as any )
			})
		})

		return Promise.all( writes ).then( () => undefined )
	}

	find( queryObject: QueryObject<DocumentObject>, collectionName: string ): Promise<DocumentObject[]> {
		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()
		const { collectionId, parentId } = mapCollectionPath( collectionName )

		const queries = AppWriteDatasource.buildQueryConstraints( queryObject )
		if ( parentId ) queries.push( Query.equal( '__parentId', parentId ) )
		this._lastQueries = queries
		this._lastCollectionId = collectionId
		this._lastLimit = queryObject.limit || 0

		if ( queryObject.limit ) {
			return this.getFromQuery( databaseId, collectionId, queries )
		}

		return this.getAllFromQuery( databaseId, collectionId, queries )
	}

	async count( queryObject: QueryObject<DocumentObject>, collectionName: string ): Promise<number> {
		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()
		const { collectionId, parentId } = mapCollectionPath( collectionName )

		const queries = AppWriteDatasource.buildQueryConstraints( queryObject ).filter( query => !query.startsWith( 'limit(' ) )
		if ( parentId ) queries.push( Query.equal( '__parentId', parentId ) )
		const result = await db.listDocuments( databaseId, collectionId, queries, undefined, true )
		return result.total
	}

	delete( id: string, collectionName: string ): Promise<void> {
		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()
		const { collectionId } = mapCollectionPath( collectionName )

		return db.deleteDocument( databaseId, collectionId, id ) as unknown as Promise<void>
	}

	override runTransaction<Result>( fn: ( handle: TransactionHandle ) => Promise<Result> ): Promise<Result> {
		return this.runTransactionInternal( fn )
	}

	private async runTransactionInternal<Result>( fn: ( handle: TransactionHandle ) => Promise<Result>, attempt: number = 1 ): Promise<Result> {
		const db = AppWriteHelper.instance.databases()

		const { $id: transactionId } = await db.createTransaction()

		let result: Result | undefined
		let operationError: unknown | undefined

		try {
			const handle: TransactionHandle = {
				findById: async ( id, collectionName ) => {
					const { collectionId } = mapCollectionPath( collectionName )
					try {
						const doc = await db.getDocument( AppWriteHelper.config.databaseId, collectionId, id, undefined, transactionId )
						return AppWriteDatasource.toDocumentObject( doc )
					}
					catch( error ) {
						if ( ( error as AppwriteException ).code === 404 ) return undefined
						throw error
					}
				},
				save: async ( id, collectionName, doc ) => {
					const { collectionId, parentId } = mapCollectionPath( collectionName )
					const { id: _id, ...data } = doc
					const dataToStore = parentId ? { ...data, __parentId: parentId } : data
					await db.upsertDocument( AppWriteHelper.config.databaseId, collectionId, id, dataToStore as any, undefined, transactionId )
				},
				delete: async ( id, collectionName ) => {
					const { collectionId } = mapCollectionPath( collectionName )
					await db.deleteDocument( AppWriteHelper.config.databaseId, collectionId, id, transactionId )
				}
			}

			result = await fn( handle )
		}
		catch( error ) {
			operationError = error
		}

		if ( operationError !== undefined ) {
			await this.rollbackTransaction( db, transactionId )
			throw operationError
		}

		try {
			await db.updateTransaction( transactionId, true )
			return result as Result
		}
		catch( error ) {
			await this.rollbackTransaction( db, transactionId )
			if ( isConflictError( error ) ) {
				if ( attempt < MAX_TRANSACTION_ATTEMPTS ) return this.runTransactionInternal( fn, attempt + 1 )
				throw new TransactionConflictError()
			}
			throw error
		}
	}

	private async rollbackTransaction( db: { updateTransaction( transactionId: string, commit?: boolean, rollback?: boolean ): Promise<unknown> }, transactionId: string ) {
		try {
			await db.updateTransaction( transactionId, false, true )
		}
		catch( _error ) {
			// best effort: the transaction will expire server side
		}
	}

	next( maxDocs?: number ): Promise<DocumentObject[]> {
		if ( !this._lastQueries || !this._lastCollectionId ) throw new Error( 'You should perform a query prior to using method next' )
		if ( !this._lastDocRetrievedId ) return Promise.resolve( [] )

		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()

		this._lastLimit = maxDocs || this._lastLimit
		const queries = [
			...this._lastQueries,
			Query.limit( this._lastLimit ),
			Query.cursorAfter( this._lastDocRetrievedId )
		]

		return this.getFromQuery( databaseId, this._lastCollectionId, queries )
	}

	override onCollectionChange( query: QueryObject<DocumentObject>, collectionName: string, listener: CollectionChangeListener<DocumentObject> ): Unsubscriber {
		const { databaseId } = AppWriteHelper.config
		const client = AppWriteHelper.instance.client()
		const { collectionId, parentId } = mapCollectionPath( collectionName )
		const channel = Channel.database( databaseId ).collection( collectionId ).document().toString()

		return client.subscribe<RealtimeDocument>( channel, async payload => {
			const changes = this.toCollectionChanges( payload, collectionName )
				.filter( change => !parentId || ( payload.payload as Record<string, unknown> )?.[ '__parentId' ] === parentId )
			if ( changes.length > 0 ) {
				const snapshot = await this.find( query, collectionName )
				listener( changes, snapshot )
			}
		})
	}

	override onDocumentChange( documentPath: string, documentId: string, listener: DocumentChangeListener<DocumentObject> ): Unsubscriber {
		const { databaseId } = AppWriteHelper.config
		const client = AppWriteHelper.instance.client()
		const { collectionId } = mapCollectionPath( documentPath )
		const channel = Channel.database( databaseId ).collection( collectionId ).document( documentId ).toString()

		return client.subscribe<RealtimeDocument>( channel, payload => {
			const type = this.getEventType( payload.events )
			listener({
				type,
				before: undefined,
				after: type === 'delete' ? undefined : AppWriteDatasource.toDocumentObject( payload.payload ),
				params: payload,
				collectionPath: documentPath
			})
		})
	}

	override onDocumentTemplateChange( collectionTemplate: string, listener: DocumentChangeListener<DocumentObject> ): Unsubscriber {
		const { databaseId } = AppWriteHelper.config
		const client = AppWriteHelper.instance.client()
		const { collectionId } = mapCollectionPath( collectionTemplate )
		const channel = Channel.database( databaseId ).collection( collectionId ).document().toString()

		return client.subscribe<RealtimeDocument>( channel, payload => {
			const concretePath = this.concretePathFromTemplate( collectionTemplate, payload.payload )
			const change = this.toCollectionChanges( payload, concretePath )[ 0 ]
			if ( !change ) return
			change.params = DataSource.extractTemplateParams( concretePath, collectionTemplate )
			listener( change )
		})
	}

	protected async resolveCollectionPaths( template: string ): Promise<string[]> {
		const [ mainCollection, document, subcollection ] = template.split( '/' )
		if ( !mainCollection || !document || !subcollection ) return [ template ]
		if ( document[ 0 ] !== '{' ) return [ template ]

		const { databaseId } = AppWriteHelper.config
		const db = AppWriteHelper.instance.databases()
		const result = await db.listDocuments( databaseId, mainCollection, [ Query.limit( MAX_FETCH_CHUNK ) ] )

		return result.documents.map( doc => `${ mainCollection }/${ doc.$id }/${ subcollection }` )
	}

	static buildQueryConstraints( queryObject: QueryObject<DocumentObject> ): string[] {
		const constraints: string[] = []
		const andFilters: string[] = []
		const orFilters: string[] = []

		DataSource.toPropertyPathOperations( queryObject.operations as any ).forEach( operation => {
			const constraint = AppWriteDatasource.toAppwriteConstraint( operation.property as string, operation.operator, operation.value )
			if ( operation.aggregate ) orFilters.push( constraint )
			else andFilters.push( constraint )
		})

		if ( andFilters.length > 1 ) constraints.push( Query.and( andFilters ) )
		else if ( andFilters.length === 1 ) constraints.push( andFilters[ 0 ]! )

		if ( orFilters.length > 1 ) constraints.push( Query.or( orFilters ) )
		else if ( orFilters.length === 1 ) constraints.push( orFilters[ 0 ]! )

		if ( queryObject.sort?.propertyName ) {
			const { propertyName, order } = queryObject.sort
			constraints.push( order === 'desc' ? Query.orderDesc( propertyName ) : Query.orderAsc( propertyName ) )
		}

		if ( queryObject.limit ) {
			constraints.push( Query.limit( queryObject.limit ) )
		}

		return constraints
	}

	static toAppwriteConstraint( property: string, operator: QueryOperator, value: unknown ): string {
		switch( operator ) {
			case '==': return Query.equal( property, value as never )
			case '!=': return Query.notEqual( property, value as never )
			case '<': return Query.lessThan( property, value as never )
			case '<=': return Query.lessThanEqual( property, value as never )
			case '>': return Query.greaterThan( property, value as never )
			case '>=': return Query.greaterThanEqual( property, value as never )
			case 'contains': return Query.contains( property, value as never )
			case 'containsAny': return Query.containsAny( property, value as never )
			default: throw new Error( `Operator ${ operator } is not supported by AppWrite` )
		}
	}

	private async getFromQuery( databaseId: string, collectionName: string, queries: string[] ): Promise<DocumentObject[]> {
		const db = AppWriteHelper.instance.databases()
		const result = await db.listDocuments( databaseId, collectionName, queries )

		const docs = result.documents
		if ( docs.length === 0 ) {
			this._lastDocRetrievedId = undefined
			return []
		}

		this._lastDocRetrievedId = docs[ docs.length - 1 ]!.$id
		return docs.map( doc => AppWriteDatasource.toDocumentObject( doc ) )
	}

	private async getAllFromQuery( databaseId: string, collectionName: string, queries: string[] ): Promise<DocumentObject[]> {
		const db = AppWriteHelper.instance.databases()

		const allDocs: DocumentObject[] = []
		let offset = 0

		for ( let round = 0; round < MAX_PAGINATION_ROUNDS; round++ ) {
			const pageQueries = [ ...queries, Query.limit( MAX_FETCH_CHUNK ), Query.offset( offset ) ]
			const result = await db.listDocuments( databaseId, collectionName, pageQueries )

			const docs = result.documents
			if ( docs.length === 0 ) break

			allDocs.push( ...docs.map( doc => AppWriteDatasource.toDocumentObject( doc ) ) )
			offset += docs.length
			if ( docs.length < MAX_FETCH_CHUNK ) break
		}

		this._lastDocRetrievedId = allDocs.length > 0
			? ( allDocs[ allDocs.length - 1 ] as unknown as { $id?: string } ).$id
			: undefined

		return allDocs
	}

	static toDocumentObject<T extends { $id?: string }>( doc: T ): DocumentObject {
		const data = { ...doc } as unknown as Record<string, unknown>
		if ( !data[ 'id' ] ) data[ 'id' ] = doc.$id
		return data as DocumentObject
	}

	private toCollectionChanges( payload: { events: string[]; payload: RealtimeDocument }, collectionPath: string ): DocumentChange<DocumentObject>[] {
		return payload.events.map( event => {
			const type = this.getEventType( [ event ] )
			return {
				type,
				after: type === 'delete' ? undefined : AppWriteDatasource.toDocumentObject( payload.payload ),
				before: undefined,
				params: {},
				collectionPath
			} as DocumentChange<DocumentObject>
		})
	}

	private getEventType( events: string[] ): 'create' | 'update' | 'delete' {
		return events.some( event => event.includes( '.delete' ) )
			? 'delete'
			: events.some( event => event.includes( '.create' ) )
				? 'create'
				: 'update'
	}

	private concretePathFromTemplate( template: string, doc: RealtimeDocument ): string {
		const segments = template.split( '/' )
		if ( segments.length < 3 ) return template
		const parentId = ( doc as Record<string, unknown> )[ '__parentId' ]
		return parentId ? `${ segments[ 0 ] }/${ parentId }/${ segments[ 2 ] }` : template
	}

	private _lastQueries: string[] | undefined
	private _lastCollectionId: string | undefined
	private _lastDocRetrievedId: string | undefined
	private _lastLimit: number = 0
}