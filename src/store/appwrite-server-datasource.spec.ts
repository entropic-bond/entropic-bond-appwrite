import { Query } from 'node-appwrite'
import { Model, Persistent, Store } from 'entropic-bond'
import { AppWriteServerHelper } from '../appwrite-server-helper'
import { AppWriteServerDatasource } from './appwrite-server-datasource'
import { TestUser, DerivedUser, SubClass } from '../mocks/test-user'
import mockData from '../mocks/mock-data.json'
import { readTestConfig, describeIntegration } from '../test-support/test-config'

describeIntegration( 'AppWrite Server Datasource', ()=>{

	let model: Model<TestUser>
	let testUser: TestUser

	beforeAll(()=>{
		const config = readTestConfig()!
		AppWriteServerHelper.setConfig({
			endpoint: config.endpoint,
			projectId: config.projectId,
			apiKey: config.apiKey,
			databaseId: config.databaseId
		})
		Store.useDataSource( new AppWriteServerDatasource() )
	})

	beforeEach( async ()=>{
		testUser = new TestUser()
		testUser.name = {
			firstName: 'testUserFirstName',
			lastName: 'testUserLastName'
		}
		testUser.age = 35
		testUser.skills = [ 'lazy', 'dirty' ]

		model = Store.getModel<TestUser>( 'TestUser' )

		await loadTestData( model )
	})

	afterEach( async ()=>{
		await wipeCollections()
	})

	it( 'should find document by id', async ()=>{
		await model.save( testUser )

		const user = await model.findById( testUser.id )

		expect( user ).toBeInstanceOf( TestUser )
		expect( user?.id ).toEqual( testUser.id )
		expect( user?.name?.firstName ).toEqual( 'testUserFirstName' )
	})

	it( 'should write a document', async ()=>{
		await model.save( testUser )
		const newUser = await model.findById( testUser.id )

		expect( newUser?.name ).toEqual({
			firstName: 'testUserFirstName',
			lastName: 'testUserLastName'
		})
	})

	it( 'should delete a document by id', async ()=>{
		await model.save( testUser )

		const newUser = await model.findById( testUser.id )
		expect( newUser?.age ).toBe( 35 )

		await model.delete( testUser.id )

		const deletedUser = await model.findById( testUser.id )
		expect( deletedUser ).toBeUndefined()
	})

	it( 'should not throw if a document id doesn\'t exists', async ()=>{
		await expect( model.findById( 'nonExistingId' ) ).resolves.toBeUndefined()
	})

	it( 'should retrieve array fields', async ()=>{
		await model.save( testUser )
		const newUser = await model.findById( testUser.id )

		expect( Array.isArray( newUser?.skills ) ).toBeTruthy()
		expect( newUser?.skills ).toEqual( expect.arrayContaining([ 'lazy', 'dirty' ]) )
	})

	describe( 'Generic find', ()=>{
		it( 'should query all admins with query object', async ()=>{
			testUser.admin = true
			await model.save( testUser )

			const admins = await model.query({
				operations: [{
					property: 'admin',
					operator: '==',
					value: true
				}]
			})

			expect( admins.length ).toBeGreaterThanOrEqual( 1 )
			expect( admins[ 0 ] ).toBeInstanceOf( TestUser )
		})

		it( 'should find admins with age less than 56', async ()=>{
			const admins = await model.find()
				.where( 'admin', '==', true )
				.where( 'age', '<', 50 )
				.get()

			expect( admins.length ).toBeGreaterThanOrEqual( 1 )
			expect( admins[ 0 ]?.age ).toBeLessThan( 50 )
		})

		it.skip( 'should find by deep property path', async ()=>{
			const users = await model.find()
				.whereDeepProp( 'name.firstName', '==', 'userFirstName3' )
				.get()

			expect( users[0]?.id ).toBe( 'user3' )
		})

		it( 'should count documents in collection', async ()=>{
			expect( await model.find().count() ).toBe( 6 )
		})
	})

	describe( 'Compound queries', ()=>{
		it( 'should find documents using `AND` compound query', async ()=>{
			const admins = await model.find()
				.where( 'admin', '==', true )
				.where( 'age', '<', 50 )
				.get()

			expect( admins ).toHaveLength( 1 )
			expect( admins[0]?.age ).toBeLessThan( 50 )
		})

		it( 'should find using `OR` query', async ()=>{
			const docs = await model.find().or( 'age', '==', 23 ).or( 'age', '==', 41 ).get()

			expect( docs ).toHaveLength( 2 )
			expect( docs ).toEqual( expect.arrayContaining([
				expect.objectContaining({ id: 'user1', age: 23 }),
				expect.objectContaining({ id: 'user5', age: 41 })
			]))
		})

		it( 'should find combining `OR` query and `where` query', async ()=>{
			const docs = await model.find().where( 'age', '>', 50 ).or( 'age', '==', 23 ).or( 'age', '==', 41 ).get()

			expect( docs ).toHaveLength( 3 )
			expect( docs ).toEqual( expect.arrayContaining([
				expect.objectContaining({ id: 'user1', age: 23 }),
				expect.objectContaining({ id: 'user5', age: 41 }),
				expect.objectContaining({ id: 'user3', age: 56 })
			]))
		})
	})

	describe( 'Searchable array property', ()=>{
		it( 'should find documents using `containsAny` operator', async ()=>{
			const colleague1 = new TestUser( 'colleague1' )
			const colleague2 = new TestUser( 'colleague2' )
			const docs = await model.find().where( 'colleagues', 'containsAny', [ colleague1, colleague2 ]).get()

			expect( docs ).toHaveLength( 3 )
			expect( docs ).toEqual( expect.arrayContaining([
				expect.objectContaining({ id: 'user2' }),
				expect.objectContaining({ id: 'user4' }),
				expect.objectContaining({ id: 'user6' })
			]))
		})

		it( 'should find documents using `contains` operator', async ()=>{
			const colleague2 = new TestUser( 'colleague2' )
			const docs = await model.find().where( 'colleagues', 'contains', colleague2 ).get()

			expect( docs ).toHaveLength( 2 )
			expect( docs ).toEqual([
				expect.objectContaining({ id: 'user4' }),
				expect.objectContaining({ id: 'user6' })
			])
		})
	})

	describe( 'References to documents', ()=>{
		beforeEach( async ()=>{
			testUser.documentRef = new SubClass()
			testUser.documentRef.year = 2045
			testUser.derived = new DerivedUser()
			testUser.derived!.salary = 1350

			await model.save( testUser )
		})

		it( 'should save a document as a reference', async ()=>{
			const subClassModel = Store.getModel( 'SubClass' )
			const newDocument = await subClassModel.findById( testUser.documentRef!.id ) as SubClass

			expect( newDocument ).toBeInstanceOf( SubClass )
			expect( newDocument.year ).toBe( 2045 )
		})

		it( 'should read a swallow document reference', async ()=>{
			const loadedUser = await model.findById( testUser.id )

			expect( loadedUser?.documentRef ).toBeInstanceOf( SubClass )
			expect( loadedUser?.documentRef?.id ).toBeDefined()
			expect( loadedUser?.documentRef?.year ).toBeUndefined()
		})

		it( 'should fill data of swallow document reference', async ()=>{
			const loadedUser = await model.findById( testUser.id )

			await Store.populate( loadedUser!.documentRef! )
			expect( loadedUser?.documentRef?.id ).toBeDefined()
			expect( loadedUser?.documentRef?.year ).toBe( 2045 )
		})
	})

	describe( 'SubCollections', ()=>{
		let model: Model<SubClass>

		beforeEach(()=>{
			model = Store.getModelForSubCollection( testUser, 'SubClass' )
		})

		it( 'should retrieve from subcollection', async ()=>{
			const subClass = new SubClass()
			subClass.year = 3452

			await model.save( subClass )

			const loaded = await model.findById( subClass.id )

			expect( loaded?.year ).toBe( 3452 )
		})

		it( 'should keep subcollections isolated per parent', async ()=>{
			const parent2 = new TestUser( 'parent2' )
			const otherModel: Model<SubClass> = Store.getModelForSubCollection( parent2, 'SubClass' )

			const subClass = new SubClass()
			subClass.year = 3452
			await model.save( subClass )

			const other = new SubClass()
			other.year = 9999
			await otherModel.save( other )

			const fromParent1 = await model.find().get()
			const fromParent2 = await otherModel.find().get()

			expect( fromParent1 ).toHaveLength( 1 )
			expect( fromParent2 ).toHaveLength( 1 )
		})
	})

	describe( 'Operations on queries', ()=>{
		it( 'should limit the result set', async ()=>{
			const unlimited = await model.find().get()
			const limited = await model.find().limit( 2 ).get()

			expect( unlimited.length ).not.toBe( limited.length )
			expect( limited ).toHaveLength( 2 )
		})

		it( 'should sort ascending the result set', async ()=>{
			const docs = await model.find().orderBy( 'age' ).get()

			expect( docs[ 0 ]?.id ).toEqual( 'user2' )
			expect( docs[ 1 ]?.id ).toEqual( 'user1' )
		})

		it( 'should get next result set', async ()=>{
			await model.find().get( 2 )
			const docs = await model.next()

			expect( docs ).toHaveLength( 2 )
			expect( docs[0]?.id ).toEqual( 'user3' )
		})
	})

	describe( 'Transactions', ()=>{
		it( 'should update a document inside a transaction', async ()=>{
			const result = await model.runTransaction( async handle => {
				const user = ( await handle.findById( 'user1' ) )!
				user.age = 99
				await handle.save( user )
				return user
			})

			expect( result.id ).toBe( 'user1' )
			expect( result.age ).toBe( 99 )

			const updated = await model.findById( 'user1' )
			expect( updated?.age ).toBe( 99 )
		})

		it( 'should delete a document inside a transaction', async ()=>{
			const result = await model.runTransaction( async handle => {
				const user = ( await handle.findById( 'user1' ) )!
				await handle.delete( user )
				return user
			})

			expect( result.id ).toBe( 'user1' )
			expect( await model.findById( 'user1' ) ).toBeUndefined()
		})

		it( 'should return a value from a transaction', async ()=>{
			const result = await model.runTransaction( async handle => {
				const user = ( await handle.findById( 'user1' ) )!
				return user
			})

			expect( result.age ).toBe( 23 )
		})

		it( 'should atomically increment a counter with concurrent transactions', async ()=>{
			const increment = ()=> model.runTransaction( async handle => {
				const user = ( await handle.findById( 'user1' ) )!
				user.age = ( user.age ?? 0 ) + 1
				await handle.save( user )
				return user
			})

			await Promise.all([ increment(), increment(), increment() ])

			const final = await model.findById( 'user1' )
			expect( final?.age ).toBe( 26 )
		})

		it( 'should run transactions on subcollection models', async ()=>{
			const subCollectionModel = Store.getModelForSubCollection<SubClass>( testUser, 'SubClass' )
			const sub = new SubClass( 'sub1' )
			sub.year = 1326

			const result = await subCollectionModel.runTransaction( async handle => {
				await handle.save( sub )
				return sub
			})

			expect( result ).toBeInstanceOf( SubClass )

			const loaded = await subCollectionModel.findById( 'sub1' )
			expect( loaded?.year ).toBe( 1326 )
		})
	})
})

async function loadTestData( model: Model<TestUser> ) {
	const users = Object.values( mockData.TestUser )
	await Promise.all(
		users.map( userObj => {
			const user = Persistent.createInstance<TestUser>( userObj as any )
			return model.save( user )
		})
	)
}

async function wipeCollections() {
	const databaseId = AppWriteServerHelper.databaseId
	const db = AppWriteServerHelper.instance.databases()

	for ( const collectionName of [ 'TestUser', 'SubClass', 'DerivedUser', 'TestUser_SubClass' ] ) {
		const result = await db.listDocuments( databaseId, collectionName, [ Query.limit( 5000 ) ] )
		await Promise.all( result.documents.map( doc => db.deleteDocument( databaseId, collectionName, doc.$id ) ) )
	}
}