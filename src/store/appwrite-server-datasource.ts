import { AppwriteException, Query } from 'node-appwrite'
import { CollectionChangeListener, Collections, DataSource, DocumentChangeListener, DocumentObject, QueryObject, TransactionConflictError, TransactionHandle, Unsubscriber } from 'entropic-bond'
import { AppWriteServerHelper } from '../appwrite-server-helper'
import { AppWriteDatasource } from './appwrite-datasource'
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

	override find( queryObject: QueryObject<DocumentObject>, collectionName: string ): Promise<DocumentObject[]> {
		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()
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

	override async count( queryObject: QueryObject<DocumentObject>, collectionName: string ): Promise<number> {
		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()
		const { collectionId, parentId } = mapCollectionPath( collectionName )

		const queries = AppWriteDatasource.buildQueryConstraints( queryObject ).filter( query => !query.startsWith( 'limit(' ) )
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

	override next( maxDocs?: number ): Promise<DocumentObject[]> {
		if ( !this._lastQueries || !this._lastCollectionId ) throw new Error( 'You should perform a query prior to using method next' )
		if ( !this._lastDocRetrievedId ) return Promise.resolve( [] )

		const databaseId = AppWriteServerHelper.databaseId
		const db = AppWriteServerHelper.instance.databases()

		this._lastLimit = maxDocs || this._lastLimit
		const queries = [
			...this._lastQueries,
			Query.limit( this._lastLimit ),
			Query.cursorAfter( this._lastDocRetrievedId )
		]

		return this.getFromQuery( databaseId, this._lastCollectionId, queries )
	}

	override onCollectionChange( query: QueryObject<DocumentObject>, collectionName: string, listener: CollectionChangeListener<DocumentObject> ): Unsubscriber {
		throw new Error( 'Method not implemented.' )
	}

	override onDocumentChange( documentPath: string, documentId: string, listener: DocumentChangeListener<DocumentObject> ): Unsubscriber {
		throw new Error( 'Method not implemented.' )
	}

	override onDocumentTemplateChange( collectionTemplate: string, listener: DocumentChangeListener<DocumentObject> ): Unsubscriber {
		throw new Error( 'Method not implemented.' )
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

	private async getFromQuery( databaseId: string, collectionName: string, queries: string[] ): Promise<DocumentObject[]> {
		const db = AppWriteServerHelper.instance.databases()
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

		this._lastDocRetrievedId = allDocs.length > 0
			? ( allDocs[ allDocs.length - 1 ] as unknown as { $id?: string } ).$id
			: undefined

		return allDocs
	}

	private _lastQueries: string[] | undefined
	private _lastCollectionId: string | undefined
	private _lastDocRetrievedId: string | undefined
	private _lastLimit: number = 0
}