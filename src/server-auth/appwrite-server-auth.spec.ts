import { ID, Users } from 'node-appwrite'
import { ServerAuth } from 'entropic-bond'
import { AppWriteServerHelper } from '../appwrite-server-helper'
import { AppWriteServerAuth } from './appwrite-server-auth'
import { readTestConfig, describeIntegration } from '../test-support/test-config'

describeIntegration( 'AppWrite Server Auth', ()=>{

	let userId: string

	beforeAll(()=>{
		const config = readTestConfig()!
		AppWriteServerHelper.setConfig({
			endpoint: config.endpoint,
			projectId: config.projectId,
			apiKey: config.apiKey,
			databaseId: config.databaseId
		})
		ServerAuth.useServerAuthService( new AppWriteServerAuth() )
	})

	beforeEach( async ()=>{
		userId = ID.unique()
		await users().create( userId, 'test@entropic-bond.dev', undefined, 'password', 'Test User' )
	})

	afterEach( async ()=>{
		try {
			await users().delete( userId )
		}
		catch {}
	})

	it( 'should not throw if user not found', async ()=>{
		expect.assertions( 1 )
		await expect(
			ServerAuth.instance.getUser( 'non-existing-user-id' )
		).resolves.toBeUndefined()
	})

	it( 'should not throw if user not found in deleteUser', async ()=>{
		expect.assertions( 1 )
		await expect(
			ServerAuth.instance.deleteUser( 'non-existing-user-id' )
		).resolves.toBeUndefined()
	})

	it( 'should get a user', async ()=>{
		const user = await ServerAuth.instance.getUser( userId )

		expect( user?.id ).toBe( userId )
		expect( user?.email ).toBe( 'test@entropic-bond.dev' )
		expect( user?.name ).toBe( 'Test User' )
	})

	it( 'should set custom credentials', async ()=>{
		await ServerAuth.instance.setCustomCredentials( userId, { role: 'admin' } )

		const user = await ServerAuth.instance.getUser<{ role: string }>( userId )
		expect( user?.customData?.role ).toBe( 'admin' )
	})

	it( 'should update a user', async ()=>{
		const user = await ServerAuth.instance.updateUser( userId, {
			name: 'Updated Name',
			customData: { role: 'editor' }
		})

		expect( user?.name ).toBe( 'Updated Name' )
		expect( user?.customData?.role ).toBe( 'editor' )
	})

	it( 'should delete a user', async ()=>{
		await ServerAuth.instance.deleteUser( userId )

		const user = await ServerAuth.instance.getUser( userId )
		expect( user ).toBeUndefined()
	})
})

function users(): Users {
	return AppWriteServerHelper.instance.users()
}