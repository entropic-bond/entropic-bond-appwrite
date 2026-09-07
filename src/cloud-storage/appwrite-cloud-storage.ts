import { registerCloudStorage, CloudStorage, UploadControl, UploadProgress, StorableData } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'

@registerCloudStorage( 'AppWriteCloudStorage', ()=> new AppWriteCloudStorage() )
export class AppWriteCloudStorage extends CloudStorage {

	save( id: string, data: StorableData, progress?: UploadProgress ): Promise<string> {
		const { bucketId } = AppWriteHelper.config
		if ( !bucketId ) throw new Error( 'You should define a bucketId in the AppWrite config to use cloud storage' )
		const storage = AppWriteHelper.instance.storage()

		const file = this.toFile( data, id )
		const fileSize = file.size

		return storage.createFile(
			bucketId,
			id,
			file,
			undefined,
			appWriteProgress => {
				if ( progress ) progress( appWriteProgress.sizeUploaded, fileSize )
				if ( this._progressListener ) this._progressListener( appWriteProgress.sizeUploaded, fileSize )
			}
		).then( () => id )
	}

	getUrl( reference: string ): Promise<string> {
		if ( !reference ) return Promise.reject( 'needs a reference' )
		const { bucketId } = AppWriteHelper.config
		if ( !bucketId ) throw new Error( 'You should define a bucketId in the AppWrite config to use cloud storage' )

		return Promise.resolve( AppWriteHelper.instance.storage().getFileDownload( bucketId, reference ) )
	}

	uploadControl(): UploadControl {
		return {
			cancel: ()=>undefined,
			pause: ()=>undefined,
			resume: ()=>undefined,
			onProgress: ( callback ) => {
				this._progressListener = callback
			}
		}
	}

	delete( reference: string ): Promise<void> {
		const { bucketId } = AppWriteHelper.config
		if ( !bucketId ) throw new Error( 'You should define a bucketId in the AppWrite config to use cloud storage' )

		return AppWriteHelper.instance.storage().deleteFile( bucketId, reference ) as unknown as Promise<void>
	}

	private toFile( data: StorableData, fileName: string ): File {
		if ( data instanceof File ) return data
		return new File( [ data as BlobPart ], fileName )
	}

	private _progressListener: UploadProgress | undefined
}