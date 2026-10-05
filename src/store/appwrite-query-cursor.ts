import { Query } from 'appwrite'
import { DocumentObject, QueryCursor } from 'entropic-bond'

/**
 * Fetches one page of documents from AppWrite for the given constraint array.
 * It lets a data source inject its own `databases().listDocuments` call without
 * the cursor knowing about the client or server SDK.
 */
export type AppWritePageFetcher = ( queries: string[] ) => Promise< DocumentObject[] >

/**
 * A {@link QueryCursor} for AppWrite. AppWrite paginates server-side with
 * `Query.cursorAfter( lastDocId )`, so instead of holding the full match set the
 * cursor keeps the query constraints, the page size and the last retrieved
 * document id, and asks the injected fetcher for each page. The pagination state
 * is local to the query that produced the cursor.
 */
export class AppWriteQueryCursor extends QueryCursor {
	/**
	 * @param baseQueries the query constraints without a page size
	 * @param limit the page size. Must be greater than zero
	 * @param fetchPage fetches a page for the given full query constraint array
	 */
	constructor( baseQueries: string[], limit: number, fetchPage: AppWritePageFetcher ) {
		super( [], limit )
		this._baseQueries = baseQueries
		this._pageSize = limit
		this._fetchPage = fetchPage
	}

	/**
	 * Retrieves the next page of documents, advancing the cursor's last
	 * retrieved id.
	 * @param limit the max amount of documents to retrieve. When set it replaces
	 * the cursor's current page size
	 * @returns a promise resolving to the next page of documents
	 */
	override async next( limit?: number ): Promise<DocumentObject[]> {
		if ( limit !== undefined ) this._pageSize = limit
		if ( this._exhausted ) return []

		const queries = [ ...this._baseQueries, Query.limit( this._pageSize ) ]
		if ( this._lastDocId ) queries.push( Query.cursorAfter( this._lastDocId ) )

		const docs = await this._fetchPage( queries )
		if ( docs.length === 0 ) {
			this._exhausted = true
			return []
		}

		this._lastDocId = this.idOf( docs[ docs.length - 1 ]! )
		return docs
	}

	private idOf( doc: DocumentObject ): string {
		const { $id, id } = doc as { $id?: string; id?: string }
		return $id ?? id ?? ''
	}

	private _baseQueries: string[]
	private _pageSize: number
	private _fetchPage: AppWritePageFetcher
	private _lastDocId: string | undefined
	private _exhausted: boolean = false
}
