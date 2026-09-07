import { AppwriteException, Models, Users } from 'node-appwrite'
import { CustomCredentials, ServerAuthService, UserCredentials } from 'entropic-bond'
import { AppWriteServerHelper } from '../appwrite-server-helper'

export class AppWriteServerAuth extends ServerAuthService {

	async getUser<T extends CustomCredentials>( userId: string ): Promise<UserCredentials<T> | undefined> {
		try {
			return this.convertToUserCredentials<T>(
				await this.users().get( userId )
			)
		}
		catch( error ) {
			if ( ( error as AppwriteException ).code === 404 ) return undefined
			else throw error
		}
	}

	setCustomCredentials<T extends CustomCredentials>( userId: string, customCredentials: T ): Promise<void> {
		return this.users().updatePrefs( userId, customCredentials ) as unknown as Promise<void>
	}

	async updateUser<T extends CustomCredentials>( userId: string, credentials: Partial<UserCredentials<T>> ): Promise<UserCredentials<T>> {
		let updatedUser: Models.User = await this.users().get( userId )

		if ( credentials.name ) updatedUser = await this.users().updateName( userId, credentials.name )
		if ( credentials.email ) updatedUser = await this.users().updateEmail( userId, credentials.email )
		if ( credentials.phoneNumber ) updatedUser = await this.users().updatePhone( userId, credentials.phoneNumber )
		if ( credentials.customData ) updatedUser = await this.users().updatePrefs( userId, credentials.customData ) as unknown as Models.User

		return this.convertToUserCredentials<T>( updatedUser )
	}

	async deleteUser( userId: string ): Promise<void> {
		try {
			await this.users().delete( userId )
		}
		catch( error ) {
			if ( ( error as AppwriteException ).code === 404 ) return undefined
			else throw error
		}
	}

	private convertToUserCredentials<T extends CustomCredentials>( user: Models.User ): UserCredentials<T> {
		return {
			id: user.$id,
			email: user.email,
			name: user.name,
			phoneNumber: user.phone,
			emailVerified: user.emailVerification,
			pictureUrl: undefined,
			customData: user.prefs as unknown as T,
			creationDate: user.registration? new Date( user.registration ).getTime() : undefined,
			lastLogin: user.accessedAt? new Date( user.accessedAt ).getTime() : undefined,
		}
	}

	private users(): Users {
		return AppWriteServerHelper.instance.users()
	}
}