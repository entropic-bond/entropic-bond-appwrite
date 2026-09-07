import { AppwriteException, Databases } from 'appwrite'
import { TransactionConflictError, TransactionHandle } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'
import { AppWriteDatasource } from './appwrite-datasource'

const DATABASE_ID = 'db-test'

describe( 'AppWriteDatasource.runTransaction', ()=>{

	let db: Databases
	let datasource: AppWriteDatasource
	let txCounter: number

	beforeEach(()=>{
		AppWriteHelper.setConfig({
			endpoint: 'http://localhost/v1',
			projectId: 'project-test',
			databaseId: DATABASE_ID
		})
		datasource = new AppWriteDatasource()
		db = AppWriteHelper.instance.databases()

		txCounter = 0
		vi.spyOn( db, 'createTransaction' ).mockImplementation( async ()=>({ $id: `tx-${ ++txCounter }` } as any) )
		vi.spyOn( db, 'getDocument' ).mockResolvedValue({} as any)
		vi.spyOn( db, 'upsertDocument' ).mockResolvedValue({} as any)
		vi.spyOn( db, 'deleteDocument' ).mockResolvedValue({})
		vi.spyOn( db, 'updateTransaction' ).mockResolvedValue({} as any)
	})

	afterEach(()=>{
		vi.restoreAllMocks()
	})

	it( 'should stage and commit a save inside a transaction', async ()=>{
		vi.spyOn( db, 'getDocument' ).mockResolvedValue({ $id: 'user1', age: 23 } as any)

		const result = await datasource.runTransaction( async handle => {
			const user = ( await handle.findById( 'user1', 'TestUser' ) ) as any
			user.age = 24
			await handle.save( 'user1', 'TestUser', user )
			return user.age
		})

		expect( result ).toBe( 24 )
		expect( db.createTransaction ).toHaveBeenCalledTimes( 1 )
		expect( db.getDocument ).toHaveBeenCalledWith( DATABASE_ID, 'TestUser', 'user1', undefined, 'tx-1' )
		expect( db.upsertDocument ).toHaveBeenCalledWith(
			DATABASE_ID, 'TestUser', 'user1', { $id: 'user1', age: 24 }, undefined, 'tx-1'
		)
		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', true )
		expect( db.updateTransaction ).not.toHaveBeenCalledWith( 'tx-1', false, true )
	})

	it( 'should stage and commit a delete inside a transaction', async ()=>{
		await datasource.runTransaction( async handle => {
			await handle.delete( 'user1', 'TestUser' )
			return { ok: true }
		})

		expect( db.deleteDocument ).toHaveBeenCalledWith( DATABASE_ID, 'TestUser', 'user1', 'tx-1' )
		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', true )
	})

	it( 'should resolve undefined when reading a missing document inside a transaction', async ()=>{
		vi.spyOn( db, 'getDocument' ).mockRejectedValue( new AppwriteException( 'Document not found', 404 ) )

		const result = await datasource.runTransaction( async handle => (
			await handle.findById( 'missing', 'TestUser' )
		) )

		expect( result ).toBeUndefined()
		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', true )
	})

	it( 'should map a subcollection path onto its simulated collection inside a transaction', async ()=>{
		await datasource.runTransaction( async handle => {
			await handle.save( 'sub1', 'TestUser/parent1/SubClass', { id: 'sub1', year: 2026 } as any )
			return undefined
		})

		expect( db.upsertDocument ).toHaveBeenCalledWith(
			DATABASE_ID, 'TestUser_SubClass', 'sub1', { year: 2026, __parentId: 'parent1' }, undefined, 'tx-1'
		)
		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', true )
	})

	it( 'should roll the transaction back and rethrow when the callback rejects', async ()=>{
		const error = new Error( 'boom' )

		await expect(
			datasource.runTransaction( async ()=>{ throw error } )
		).rejects.toBe( error )

		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', false, true )
		expect( db.updateTransaction ).not.toHaveBeenCalledWith( 'tx-1', true )
	})

	it( 'should roll back and propagate a user thrown TransactionConflictError', async ()=>{
		const conflict = new TransactionConflictError()

		await expect(
			datasource.runTransaction( async ()=>{ throw conflict } )
		).rejects.toBe( conflict )

		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', false, true )
		expect( db.updateTransaction ).not.toHaveBeenCalledWith( 'tx-1', true )
	})

	it( 'should retry the transaction when the commit reports a conflict', async ()=>{
		let commitCalls = 0
		vi.spyOn( db, 'updateTransaction' ).mockImplementation( async ()=>{
			commitCalls++
			if ( commitCalls === 1 ) throw new AppwriteException( 'The transaction has a conflict', 409 )
			return {} as any
		})

		const fn = vi.fn( async ( handle: TransactionHandle ) => {
			await handle.save( 'user1', 'TestUser', { id: 'user1', age: 1 } as any )
			return 'ok'
		})

		const result = await datasource.runTransaction( fn )

		expect( result ).toBe( 'ok' )
		expect( fn ).toHaveBeenCalledTimes( 2 )
		expect( db.createTransaction ).toHaveBeenCalledTimes( 2 )
		expect( db.upsertDocument ).toHaveBeenNthCalledWith( 1, DATABASE_ID, 'TestUser', 'user1', { age: 1 }, undefined, 'tx-1' )
		expect( db.upsertDocument ).toHaveBeenNthCalledWith( 2, DATABASE_ID, 'TestUser', 'user1', { age: 1 }, undefined, 'tx-2' )
		expect( db.updateTransaction ).toHaveBeenNthCalledWith( 1, 'tx-1', true )
		expect( db.updateTransaction ).toHaveBeenNthCalledWith( 2, 'tx-1', false, true )
		expect( db.updateTransaction ).toHaveBeenNthCalledWith( 3, 'tx-2', true )
	})

	it( 'should reject with TransactionConflictError when the commit keeps conflicting', async ()=>{
		vi.spyOn( db, 'updateTransaction' ).mockRejectedValue( new AppwriteException( 'The transaction has a conflict', 409 ) )
		const fn = vi.fn( async ()=> 'result' )

		await expect( datasource.runTransaction( fn ) ).rejects.toBeInstanceOf( TransactionConflictError )

		// Default max attempts (5) with no successful commit
		expect( fn ).toHaveBeenCalledTimes( 5 )
		expect( db.createTransaction ).toHaveBeenCalledTimes( 5 )
	})

	it( 'should rethrow non conflict commit errors after rolling back', async ()=>{
		vi.spyOn( db, 'updateTransaction' ).mockRejectedValue( new AppwriteException( 'Server error', 500 ) )

		await expect(
			datasource.runTransaction( async ()=> 'result' )
		).rejects.toBeInstanceOf( AppwriteException )

		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', true )
		expect( db.updateTransaction ).toHaveBeenCalledWith( 'tx-1', false, true )
	})
})
