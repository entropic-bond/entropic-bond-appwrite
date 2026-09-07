import { Query } from 'appwrite'
import { AppWriteDatasource } from './appwrite-datasource'
import { TestUser } from '../mocks/test-user'

describe( 'AppWrite query constraints', ()=>{

	it( 'should translate equality operator', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: 'admin', operator: '==', value: true }]
		} as any)
		expect( queries ).toEqual([ Query.equal( 'admin', true ) ])
	})

	it( 'should translate inequality operator', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: 'admin', operator: '!=', value: true }]
		} as any)
		expect( queries ).toEqual([ Query.notEqual( 'admin', true ) ])
	})

	it( 'should translate comparison operators', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [
				{ property: 'age', operator: '<', value: 50 },
				{ property: 'age', operator: '<=', value: 50 },
				{ property: 'age', operator: '>', value: 20 },
				{ property: 'age', operator: '>=', value: 20 }
			]
		} as any)
		expect( queries ).toEqual([
			Query.and([
				Query.lessThan( 'age', 50 ),
				Query.lessThanEqual( 'age', 50 ),
				Query.greaterThan( 'age', 20 ),
				Query.greaterThanEqual( 'age', 20 )
			])
		])
	})

	it( 'should translate contains operator', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: '__colleagues_searchable', operator: 'contains', value: 'colleague2' }]
		} as any)
		expect( queries ).toEqual([ Query.contains( '__colleagues_searchable', 'colleague2' ) ])
	})

	it( 'should translate containsAny operator', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: '__colleagues_searchable', operator: 'containsAny', value: [ 'colleague1', 'user3' ] }]
		} as any)
		expect( queries ).toEqual([ Query.containsAny( '__colleagues_searchable', [ 'colleague1', 'user3' ] ) ])
	})

	it( 'should combine `and` constraints', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [
				{ property: 'admin', operator: '==', value: true },
				{ property: 'age', operator: '<', value: 50 }
			]
		} as any)
		expect( queries ).toEqual([
			Query.and([ Query.equal( 'admin', true ), Query.lessThan( 'age', 50 ) ])
		])
	})

	it( 'should combine `or` constraints', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [
				{ property: 'age', operator: '==', value: 23, aggregate: true },
				{ property: 'age', operator: '==', value: 41, aggregate: true }
			]
		} as any)
		expect( queries ).toEqual([
			Query.or([ Query.equal( 'age', 23 ), Query.equal( 'age', 41 ) ])
		])
	})

	it( 'should combine `and` and `or` constraints', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [
				{ property: 'age', operator: '>', value: 50 },
				{ property: 'age', operator: '==', value: 23, aggregate: true },
				{ property: 'age', operator: '==', value: 41, aggregate: true }
			]
		} as any)
		expect( queries ).toEqual([
			Query.greaterThan( 'age', 50 ),
			Query.or([ Query.equal( 'age', 23 ), Query.equal( 'age', 41 ) ])
		])
	})

	it( 'should translate sort order', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			sort: { propertyName: 'age', order: 'asc' }
		})
		expect( queries ).toEqual([ Query.orderAsc( 'age' ) ])

		const descQueries = AppWriteDatasource.buildQueryConstraints({
			sort: { propertyName: 'age', order: 'desc' }
		})
		expect( descQueries ).toEqual([ Query.orderDesc( 'age' ) ])
	})

	it( 'should translate limit', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			limit: 2
		})
		expect( queries ).toEqual([ Query.limit( 2 ) ])
	})

	it( 'should translate deep property paths', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: 'name', operator: '==', value: { firstName: 'userFirstName3' } }]
		} as any)
		expect( queries ).toEqual([ Query.equal( 'name.firstName', 'userFirstName3' ) ])
	})

	it( 'should translate superdeep property paths', ()=>{
		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: 'name', operator: '==', value: { ancestorName: { father: 'user3Father' } } }]
		} as any)
		expect( queries ).toEqual([ Query.equal( 'name.ancestorName.father', 'user3Father' ) ])
	})

	it( 'should translate searchable array references to ids', ()=>{
		const colleague1 = new TestUser( 'colleague1' )
		const colleague2 = new TestUser( 'colleague2' )

		const queries = AppWriteDatasource.buildQueryConstraints({
			operations: [{ property: 'colleagues', operator: 'containsAny', value: [ colleague1, colleague2 ] }]
		} as any)
		expect( queries ).toEqual([
			Query.containsAny( '__colleagues_searchable', [ 'colleague1', 'colleague2' ] )
		])
	})

	it( 'should throw on unsupported operators', ()=>{
		expect(
			()=> AppWriteDatasource.toAppwriteConstraint( 'age', '>' as any, 50 )
		).not.toThrow()

		expect(
			()=> AppWriteDatasource.toAppwriteConstraint( 'age', 'unknown' as any, 50 )
		).toThrow( 'Operator unknown is not supported by AppWrite' )
	})
})