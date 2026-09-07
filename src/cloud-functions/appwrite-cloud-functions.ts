import { CloudFunction, CloudFunctionsService } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'

export class AppWriteCloudFunctions implements CloudFunctionsService {

	retrieveFunction<P, R>( cloudFunction: string ): CloudFunction<P, R> {
		const functions = AppWriteHelper.instance.functions()

		return async ( params?: P ) => {
			const execution = await functions.createExecution(
				cloudFunction,
				params === undefined ? undefined : JSON.stringify( params ),
				false
			)
			return execution.responseBody ? JSON.parse( execution.responseBody ) as R : undefined as unknown as R
		}
	}

	async callFunction<P, R>( func: CloudFunction<P, R>, params: P ): Promise<R> {
		return func( params )
	}
}