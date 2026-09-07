import { CloudStorage, StoredFile } from 'entropic-bond'
import { AppWriteHelper } from '../appwrite-helper'
import { AppWriteCloudStorage } from './appwrite-cloud-storage'
import { readTestConfig, describeIntegration } from '../test-support/test-config'

describeIntegration( 'AppWrite Cloud Storage', ()=>{
	const blobData1 = new Uint8Array([ 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21 ])
	const blobData2 = new Uint8Array([ 0x6c, 0x6c, 0x6f, 0x2c, 0x48, 0x65, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21 ])
	let file: StoredFile

	beforeAll(()=>{
		const config = readTestConfig()!
		AppWriteHelper.setConfig({
			endpoint: config.endpoint,
			projectId: config.projectId,
			databaseId: config.databaseId,
			bucketId: config.bucketId
		})
	})

	beforeEach(()=>{
		CloudStorage.useCloudStorage( new AppWriteCloudStorage() )
		file = new StoredFile()
	})

	it( 'should save and get a url', async ()=>{
		await file.save({ data: blobData1 })

		expect( file.url ).toContain( file.id )
	})

	it( 'should report metadata', async ()=>{
		await file.save({ data: blobData1, fileName: 'test.dat' })

		expect( file.originalFileName ).toEqual( 'test.dat' )
		expect( file.provider.className ).toEqual( 'AppWriteCloudStorage' )
	})

	it( 'should delete file', async ()=>{
		await file.save({ data: blobData1 })

		await file.delete()
		expect( file.url ).not.toBeDefined()
	})

	it( 'should overwrite file on subsequent writes', async ()=>{
		await file.save({ data: blobData1 })
		const firstUrl = file.url!

		await file.save({ data: blobData2 })

		expect( file.url ).toContain( file.id )
		expect( file.url!.split( '?' )[ 0 ] ).toEqual( firstUrl.split( '?' )[ 0 ] )
	})

	it( 'should trigger events', async ()=>{
		const cb = vi.fn()

		const savePromise = file.save({ data: blobData1 })
		file.uploadControl().onProgress( cb )
		await savePromise

		expect( cb ).toHaveBeenCalled()
	})
})