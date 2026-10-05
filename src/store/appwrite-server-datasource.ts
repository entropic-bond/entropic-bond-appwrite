import { AppwriteException, Query } from 'node-appwrite'
import { CollectionChangeListener, Collections, DataSource, DocumentChangeListener, DocumentObject, QueryCursor, QueryObject, TransactionConflictError, TransactionHandle, Unsubscriber } from 'entropic-bond'
import { AppWriteServerHelper } from '../appwrite-server-helper'
import { AppWriteDatasource } from './appwrite-datasource'
import { AppWriteQueryCursor } from './appwrite-query-cursor'
import { mapCollectionPath } from './collection-mapper'

const MAX_FETCH_CHUNK = 5000
const MAX_PAGINATION_ROUNDS = 100
const MAX_TRANSACTION_ATTEMPTS = 5

function isConflictError( error: unknown ): boolean {
	if ( !( error instanceof AppwriteException ) ) return false
	if ( error.code === 409 ) return true
	return /transaction.{0,20}conflict|conflict/i.test( error.message )
}

export class AppWriteServerDatasource extends DataSource {

	override findById( id: string, collectionName: string ): Promise<DocumentObject> {
		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()
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

	override save( collections: Collections ): Promise<void> {
		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()

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

	override find( queryObject: QueryObject<DocumentObject>, collectionName: string ): Promise<QueryCursor> {
		const databaseId = AppWriteServerHelper.databaseId
		const { collectionId, parentId } = mapCollectionPath( collectionName )

		const queries = AppWriteDatasource.buildPagedQueryConstraints( queryObject )
		if ( parentId ) queries.push( Query.equal( '__parentId', parentId ) )

		const limit = queryObject.limit || 0
		if ( limit > 0 ) {
			const fetchPage = ( pageQueries: string[] ) => this.pageFromQueries( databaseId, collectionId, pageQueries )
			return Promise.resolve( new AppWriteQueryCursor( queries, limit, fetchPage ) )
		}

		return this.getAllFromQuery( databaseId, collectionId, queries ).then( docs => new QueryCursor( docs, 0 ) )
	}

	override async count( queryObject: QueryObject<DocumentObject>, collectionName: string ): Promise<number> {
		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()
		const { collectionId, parentId } = mapCollectionPath( collectionName )

		const queries = AppWriteDatasource.buildPagedQueryConstraints( queryObject )
		if ( parentId ) queries.push( Query.equal( '__parentId', parentId ) )
		const result = await db.listDocuments( databaseId, collectionId, queries, undefined, true )
		return result.total
	}

	override delete( id: string, collectionName: string ): Promise<void> {
		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()
		const { collectionId } = mapCollectionPath( collectionName )

		return db.deleteDocument( databaseId, collectionId, id ) as unknown as Promise<void>
	}

	override runTransaction<Result>( fn: ( handle: TransactionHandle ) => Promise<Result> ): Promise<Result> {
		return this.runTransactionInternal( fn )
	}

	private async runTransactionInternal<Result>( fn: ( handle: TransactionHandle ) => Promise<Result>, attempt: number = 1 ): Promise<Result> {
		const db = AppWriteServerHelper.instance.databases()

		const { $id: transactionId } = await db.createTransaction()

		let result: Result | undefined
		let operationError: unknown | undefined

		try {
			const handle: TransactionHandle = {
				findById: async ( id, collectionName ) => {
					const { collectionId } = mapCollectionPath( collectionName )
					try {
						const doc = await db.getDocument( AppWriteServerHelper.databaseId, collectionId, id, undefined, transactionId )
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
					await db.upsertDocument( AppWriteServerHelper.databaseId, collectionId, id, dataToStore as any, undefined, transactionId )
				},
				delete: async ( id, collectionName ) => {
					const { collectionId } = mapCollectionPath( collectionName )
					await db.deleteDocument( AppWriteServerHelper.databaseId, collectionId, id, transactionId )
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

	/**
	 * Realtime subscriptions are not supported in the server-side AppWrite SDK.
	 * The server SDK uses REST API calls and does not have WebSocket support.
	 * Use the client-side AppWriteDatasource for realtime functionality.
	 */
	override onCollectionChange( query: QueryObject<DocumentObject>, collectionName: string, listener: CollectionChangeListener<DocumentObject> ): Unsubscriber {
		throw new Error( 'Realtime subscriptions are not supported in the server-side AppWrite SDK. Use AppWriteDatasource for realtime functionality.' )
	}

	/**
	 * Realtime subscriptions are not supported in the server-side AppWrite SDK.
	 * The server SDK uses REST API calls and does not have WebSocket support.
	 * Use the client-side AppWriteDatasource for realtime functionality.
	 */
	override onDocumentChange( documentPath: string, documentId: string, listener: DocumentChangeListener<DocumentObject> ): Unsubscriber {
		throw new Error( 'Realtime subscriptions are not supported in the server-side AppWrite SDK. Use AppWriteDatasource for realtime functionality.' )
	}

	/**
	 * Realtime subscriptions are not supported in the server-side AppWrite SDK.
	 * The server SDK uses REST API calls and does not have WebSocket support.
	 * Use the client-side AppWriteDatasource for realtime functionality.
	 */
	override onDocumentTemplateChange( collectionTemplate: string, listener: DocumentChangeListener<DocumentObject> ): Unsubscriber {
		throw new Error( 'Realtime subscriptions are not supported in the server-side AppWrite SDK. Use AppWriteDatasource for realtime functionality.' )
	}

	protected async resolveCollectionPaths( template: string ): Promise<string[]> {
		const [ mainCollection, document, subcollection ] = template.split( '/' )
		if ( !mainCollection || !document || !subcollection ) return [ template ]
		if ( document[ 0 ] !== '{' ) return [ template ]

		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()
		const result = await db.listDocuments( databaseId, mainCollection, [ Query.limit( MAX_FETCH_CHUNK ) ] )

		return result.documents.map( doc => `${ mainCollection }/${ doc.$id }/${ subcollection }` )
	}

	private async pageFromQueries( databaseId: string, collectionName: string, queries: string[] ): Promise<DocumentObject[]> {
		const db = AppWriteServerHelper.instance.databases()
		const result = await db.listDocuments( databaseId, collectionName, queries )

		return result.documents.map( doc => AppWriteDatasource.toDocumentObject( doc ) )
	}

	private async getAllFromQuery( databaseId: string, collectionName: string, queries: string[] ): Promise<DocumentObject[]> {
		const db = AppWriteServerHelper.instance.databases()

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

		return allDocs
	}
}