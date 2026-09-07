import { Account, AppwriteException, ID, Models } from 'appwrite'
import { AuthError, AuthErrorCode, AuthProvider, AuthService, ResovedCallback, RejectedCallback, SignData, UserCredentials } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'

interface CredentialProviders {
	[ name: string ]: ( signData: SignData ) => Promise<Models.User>
}

export class AppWriteAuth extends AuthService {

	signUp<T extends {}>( signData: SignData ): Promise<UserCredentials<T>> {
		const { authProvider, verificationLink } = signData

		if ( authProvider.slice( 0, 5 ) === 'email' ) {
			return new Promise<UserCredentials<T>>( async ( resolve: ResovedCallback<T>, reject: RejectedCallback ) => {
				try {
					const credentialFactory = this.credentialProviders[ 'email-sign-up' ]
					if ( !credentialFactory ) throw new Error( `The provider ${ authProvider } is not registered` )

					const userCredentials = await credentialFactory( signData )

					if ( verificationLink ) {
						await this.account().createVerification( verificationLink )
					}

					resolve( await this.toUserCredentials( userCredentials ) )
				}
				catch( error ) {
					reject( this.toAuthError( error ) )
				}
			})
		}
		else return this.login( signData )
	}

	login<T extends {}>( signData: SignData ): Promise<UserCredentials<T>> {
		const { authProvider } = signData

		return new Promise<UserCredentials<T>>( async ( resolve: ResovedCallback<T>, reject: RejectedCallback ) => {
			try {
				const credentialFactory = this.credentialProviders[ authProvider ]
				if ( !credentialFactory ) throw new Error( `The provider ${ authProvider } is not registered` )
				const userCredentials = await credentialFactory( signData )
				resolve( await this.toUserCredentials<T>( userCredentials ) )
			}
			catch( error ) {
				reject( this.toAuthError( error ) )
			}
		})
	}

	logout(): Promise<void> {
		return this.account().deleteSession( 'current' ) as unknown as Promise<void>
	}

	resetEmailPassword( email: string ): Promise<void> {
		return new Promise<void>( async ( resolve, reject ) => {
			try {
				const { resetPasswordUrl } = AppWriteHelper.config
				if ( !resetPasswordUrl ) throw new Error( 'You should define a resetPasswordUrl in the AppWrite config to reset the password' )
				await this.account().createRecovery( email, resetPasswordUrl )
				resolve()
			}
			catch( error ) {
				reject( this.toAuthError( error ) )
			}
		})
	}

	resendVerificationEmail( email: string, password: string, verificationLink: string ): Promise<void> {
		return new Promise<void>( async ( resolve, reject ) => {
			try {
				await this.account().createEmailPasswordSession( email, password )
				await this.account().createVerification( verificationLink )
				resolve()
			}
			catch( error ) {
				reject( this.toAuthError( error ) )
			}
		})
	}

	override refreshToken(): Promise<void> {
		return this.account().getSession( 'current' ) as unknown as Promise<void>
	}

	onAuthStateChange<T extends {}>( onChange: ( userCredentials: UserCredentials<T> | undefined ) => void ) {
		const client = AppWriteHelper.instance.client()

		client.subscribe( 'account', async () => {
			try {
				const user = await this.account().get()
				onChange( await this.toUserCredentials<T>( user ) )
			}
			catch {
				onChange( undefined )
			}
		})
	}

	linkAdditionalProvider( provider: AuthProvider ): Promise<unknown> {
		return Promise.reject( new Error( `Linking the provider ${ provider } is not supported by AppWrite` ) )
	}

	unlinkProvider( provider: AuthProvider ): Promise<unknown> {
		return Promise.reject( new Error( `Unlinking the provider ${ provider } is not supported by AppWrite` ) )
	}

	registerCredentialProvider( name: string, providerFactory: ( signData: SignData ) => Promise<Models.User> ) {
		this.credentialProviders[ name ] = providerFactory
	}

	private registerCredentialProviders() {
		this.registerCredentialProvider( 'email-sign-up', signData => {
			if ( !signData.email || !signData.password ) throw new Error( `Email and password are required` )
			return this.account().create( ID.unique(), signData.email, signData.password, signData.name )
		})
		this.registerCredentialProvider( 'email', async signData => {
			if ( !signData.email || !signData.password ) throw new Error( `Email and password are required` )
			await this.account().createEmailPasswordSession( signData.email, signData.password )
			return this.account().get()
		})
		this.registerCredentialProvider( 'google', () => {
			throw new Error( 'The google provider requires the OAuth2 redirect flow' )
		})
		this.registerCredentialProvider( 'facebook', () => {
			throw new Error( 'The facebook provider requires the OAuth2 redirect flow' )
		})
	}

	private async toUserCredentials<T extends {}>( user: Models.User ): Promise<UserCredentials<T>> {
		if ( !user ) throw new Error( `The user in user credentials is not defined` )
		return AppWriteAuth.convertCredentials<T>( user )
	}

	static convertCredentials<T extends {}>( user: Models.User ): UserCredentials<T> {
		return ({
			id: user.$id,
			email: user.email,
			name: user.name || undefined,
			pictureUrl: undefined,
			phoneNumber: user.phone || undefined,
			emailVerified: user.emailVerification,
			customData: user.prefs as unknown as T,
			lastLogin: user.accessedAt? new Date( user.accessedAt ).getTime() : undefined,
			creationDate: user.registration? new Date( user.registration ).getTime() : undefined,
		})
	}

	private toAuthError( error: unknown ): AuthError {
		const appwriteError = error as Partial<AppwriteException>
		const type = appwriteError.type ?? ''

		let code: AuthErrorCode = 'wrongPassword'
		if ( type.includes( 'not_found' ) ) code = 'userNotFound'
		else if ( type.includes( 'email' ) ) code = 'invalidEmail'
		else if ( type.includes( 'password' ) ) code = 'missingPassword'

		return {
			code,
			message: appwriteError.message ?? String( error )
		}
	}

	private account(): Account {
		return AppWriteHelper.instance.account()
	}

	private credentialProviders: CredentialProviders = {}

	constructor() {
		super()
		this.registerCredentialProviders()
	}
}