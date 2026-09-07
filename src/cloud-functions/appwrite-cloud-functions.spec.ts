import { CloudFunctions, Persistent, persistent, registerPersistentClass } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'
import { AppWriteCloudFunctions } from './appwrite-cloud-functions'

@registerPersistentClass( 'ParamWrapper' )
export class ParamWrapper extends Persistent {
	constructor( a?: string, b?: number ) {
		super()
		this._a = a
		this._b = b
	}
	@persistent _a: string | undefined
	@persistent _b: number | undefined
}

// Requires a deployed function in the AppWrite test project. Enable by
// deploying a function that returns the input JSON and setting the function
// ids in the environment before running the integration suite.
describe.skip( 'Cloud functions', ()=>{

	beforeAll(()=>{
		const endpoint = process.env.APPWRITE_ENDPOINT || 'http://localhost/v1'
		const projectId = process.env.APPWRITE_PROJECT_ID || ''
		const functionId = process.env.APPWRITE_TEST_FUNCTION_ID || ''

		AppWriteHelper.setConfig({
			endpoint,
			projectId,
			databaseId: process.env.APPWRITE_DATABASE_ID || 'entropic-bond-test'
		})
		CloudFunctions.useCloudFunctionsService( new AppWriteCloudFunctions() )
	})

	it( 'should call cloud functions with plain types', async ()=>{
		const functionId = process.env.APPWRITE_TEST_FUNCTION_ID
		if ( !functionId ) return

		const testCallablePlain = CloudFunctions.instance.getFunction<string, number>( functionId )
		const result = await testCallablePlain( 'Hello' )

		expect( result ).toBeDefined()
	})

	it( 'should call cloud function for Persistent', async ()=>{
		const functionId = process.env.APPWRITE_TEST_FUNCTION_ID
		if ( !functionId ) return

		const testCallablePersistent = CloudFunctions.instance.getFunction<ParamWrapper, ParamWrapper>( functionId )
		const paramWrapper = new ParamWrapper( 'test', 30 )

		const result = await testCallablePersistent( paramWrapper )

		expect( result ).toBeDefined()
	})
})