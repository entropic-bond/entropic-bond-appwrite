export interface MappedCollectionPath {
	collectionId: string
	parentId?: string
	isTemplate: boolean
}

/**
 * AppWrite has no native subcollections. To simulate them, a logical path such
 * as `TestUser/{parentId}/SubClass` is mapped onto a dedicated root collection
 * (e.g. `TestUser_SubClass`) where every document stores a `__parentId`
 * attribute holding the parent document id.
 *
 * @param collectionPath the logical collection path used by entropic-bond
 * @returns the AppWrite collection id and, for subcollection paths, the parent id
 */
export function mapCollectionPath( collectionPath: string ): MappedCollectionPath {
	const segments = collectionPath.split( '/' )

	if ( segments.length <= 1 ) {
		return { collectionId: collectionPath, isTemplate: false }
	}

	const [ root, maybeParentOrSub, sub ] = segments

	if ( segments.length === 2 ) {
		return { collectionId: `${ root }_${ maybeParentOrSub }`, isTemplate: false }
	}

	const parentId = maybeParentOrSub
		? ( maybeParentOrSub.startsWith( '{' ) && maybeParentOrSub.endsWith( '}' ) ? undefined : maybeParentOrSub )
		: undefined

	return {
		collectionId: `${ root }_${ sub }`,
		parentId,
		isTemplate: !parentId && maybeParentOrSub !== undefined
	}
}