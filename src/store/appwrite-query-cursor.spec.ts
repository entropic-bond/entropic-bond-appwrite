import { DocumentObject } from 'entropic-bond'
import { AppWritePageFetcher, AppWriteQueryCursor } from './appwrite-query-cursor'

const COLLECTION_IDS = [ 'user1', 'user2', 'user3', 'user4', 'user5', 'user6' ]

function toDocuments( ids: string[] ): DocumentObject[] {
	return ids.map( id => ({ $id: id, id, __className: 'TestUser' }) as unknown as DocumentObject )
}

function constraintValue( queries: string[], method: string ): unknown {
	const found = queries.find( query => query.startsWith( `{"method":"${ method }"` ) )
	if ( !found ) return undefined
	return ( JSON.parse( found ) as { values?: unknown[] } ).values?.[ 0 ]
}

/**
 * Emulates AppWrite's server-side pagination: `Query.limit` caps the page and
 * `Query.cursorAfter` starts after the given document id.
 */
function fakeCollection( ids: string[] = COLLECTION_IDS ): { fetchPage: AppWritePageFetcher, fetched: string[][], lastQueries: string[] } {
	const state = {
		fetched: [] as string[][],
		lastQueries: [] as string[],
		fetchPage: async ( queries: string[] ): Promise<DocumentObject[]> => {
			const limit = constraintValue( queries, 'limit' ) as number
			const after = constraintValue( queries, 'cursorAfter' ) as string | undefined
			const start = after ? ids.indexOf( after ) + 1 : 0
			const page = ids.slice( start, start + limit )
			state.fetched.push( page )
			state.lastQueries = queries
			return toDocuments( page )
		}
	}
	return state
}

function idsOf( docs: DocumentObject[] ): string[] {
	return docs.map( doc => ( doc as unknown as { $id: string } ).$id )
}

describe( 'Query cursor migration', ()=>{

	it( 'A bounded query pages through its result set. Issue #3 [REQ-1]', async ()=>{
		const { fetchPage } = fakeCollection()
		const cursor = new AppWriteQueryCursor( [], 2, fetchPage )

		expect( idsOf( await cursor.next() ) ).toEqual([ 'user1', 'user2' ])
		expect( idsOf( await cursor.next() ) ).toEqual([ 'user3', 'user4' ])
	})

	it( 'Interleaved pagination on two queries of one data source keeps each result set. Issue #3 [REQ-2]', async ()=>{
		const { fetchPage } = fakeCollection()
		const cursorA = new AppWriteQueryCursor( [], 2, fetchPage )
		const cursorB = new AppWriteQueryCursor( [], 3, fetchPage )

		expect( idsOf( await cursorA.next() ) ).toEqual([ 'user1', 'user2' ])
		expect( idsOf( await cursorB.next() ) ).toEqual([ 'user1', 'user2', 'user3' ])
		expect( idsOf( await cursorA.next() ) ).toEqual([ 'user3', 'user4' ])
		expect( idsOf( await cursorB.next() ) ).toEqual([ 'user4', 'user5', 'user6' ])
	})

	it( 'An explicit page size overrides the query page size. Issue #3 [REQ-3]', async ()=>{
		const { fetchPage } = fakeCollection()
		const cursor = new AppWriteQueryCursor( [], 2, fetchPage )

		await cursor.next()
		expect( idsOf( await cursor.next( 3 ) ) ).toEqual([ 'user3', 'user4', 'user5' ])
	})

	it( 'Requesting a page past the end of the result set returns no documents. Issue #3 [REQ-5]', async ()=>{
		const { fetchPage } = fakeCollection()
		const cursor = new AppWriteQueryCursor( [], 2, fetchPage )

		await cursor.next()
		await cursor.next()
		await cursor.next()

		expect( await cursor.next() ).toEqual( [] )
	})

	it( 'should ask AppWrite to continue after the last document of the previous page', async ()=>{
		const { fetchPage, fetched } = fakeCollection()
		const cursor = new AppWriteQueryCursor( [], 2, fetchPage )

		await cursor.next()
		await cursor.next()

		expect( fetched ).toEqual([
			[ 'user1', 'user2' ],
			[ 'user3', 'user4' ]
		])
	})
})
