import { Models } from 'appwrite'
import { AppWriteAuth } from './appwrite-auth'

describe( 'AppWrite Auth', ()=>{

	// OAuth2 flows require a browser and a running AppWrite instance, so only
	// the pure credential conversion is unit tested here. See the integration
	// notes in AGENTS.md for the email/password flow.

	it( 'should convert user credentials', ()=>{
		const user = {
			$id: 'user1',
			name: 'John',
			email: 'john@test.com',
			emailVerification: true,
			phone: '+341234567',
			registration: '2024-01-01T00:00:00.000Z',
			accessedAt: '2024-06-01T00:00:00.000Z',
			prefs: { role: 'admin' }
		} as unknown as Models.User

		const credentials = AppWriteAuth.convertCredentials<{ role: string }>( user )

		expect( credentials.id ).toBe( 'user1' )
		expect( credentials.email ).toBe( 'john@test.com' )
		expect( credentials.name ).toBe( 'John' )
		expect( credentials.emailVerified ).toBe( true )
		expect( credentials.phoneNumber ).toBe( '+341234567' )
		expect( credentials.customData ).toEqual({ role: 'admin' })
		expect( credentials.creationDate ).toBe( Date.parse( '2024-01-01T00:00:00.000Z' ) )
		expect( credentials.lastLogin ).toBe( Date.parse( '2024-06-01T00:00:00.000Z' ) )
	})

	it( 'should pass', ()=>{
		expect( true ).toBe( true )
	})
})