import { mapCollectionPath } from './collection-mapper'

describe( 'Collection mapper', ()=>{

	it( 'should keep simple collection paths', ()=>{
		expect( mapCollectionPath( 'TestUser' ) ).toEqual({
			collectionId: 'TestUser',
			isTemplate: false
		})
	})

	it( 'should map a subcollection path onto a root collection', ()=>{
		const mapped = mapCollectionPath( 'TestUser/user1/SubClass' )

		expect( mapped.collectionId ).toBe( 'TestUser_SubClass' )
		expect( mapped.parentId ).toBe( 'user1' )
		expect( mapped.isTemplate ).toBe( false )
	})

	it( 'should detect template subcollection paths', ()=>{
		const mapped = mapCollectionPath( 'TestUser/{id}/SubClass' )

		expect( mapped.collectionId ).toBe( 'TestUser_SubClass' )
		expect( mapped.parentId ).toBeUndefined()
		expect( mapped.isTemplate ).toBe( true )
	})

	it( 'should map two segment paths onto a root collection', ()=>{
		const mapped = mapCollectionPath( 'TestUser/SubClass' )

		expect( mapped.collectionId ).toBe( 'TestUser_SubClass' )
		expect( mapped.parentId ).toBeUndefined()
	})
})