import { OnlyRunInContext } from '@holoflows/kit/es'
import { gun2, SharedAESKeyGun2 } from '.'
import { hashPostSalt, hashCryptoKey, hashCryptoKeyUnstable } from './hash'
import { PublishedAESKeyRecordV39OrV38 } from '../../../crypto/crypto-alpha-38'

OnlyRunInContext(['background', 'debugging'], 'gun')

/**
 * Query all possible keys stored on the gun
 * @param version current payload version
 * @param postSalt Post iv
 * @param partitionByCryptoKey Public key of the current user (receiver)
 */
export async function queryPostKeysOnGun2(
    version: -39 | -38,
    postSalt: string,
    partitionByCryptoKey: CryptoKey,
    networkHint: string,
): Promise<{ keys: SharedAESKeyGun2[]; postHash: string; keyHash: string }> {
    const postHash = await hashPostSalt(postSalt, networkHint)
    // In version > -39, we will use stable hash to prevent unstable result for key hashing
    const keyHash = await (version <= -39 ? hashCryptoKeyUnstable : hashCryptoKey)(partitionByCryptoKey)

    // ? here we get the internal node names of gun2[postHash][keyHash]
    // ? where gun2[postHash][keyHash] is a list
    const internalNodes: Record<string, string> =
        (await gun2
            .get(postHash)
            // @ts-ignore
            .get(keyHash).then!()) || {}
    // ? In this step we get something like ["jzarhbyjtexiE7aB1DvQ", "jzarhuse6xlTAtblKRx9"]
    const internalKeys = Object.keys(internalNodes).filter(x => x !== '_')
    // ? In this step we get all keys in this category (gun2[postHash][keyHash])
    const resultPromise = internalKeys.map(key => gun2.get(key).then!())
    const result = (await Promise.all(resultPromise)) as SharedAESKeyGun2[]
    console.info(`await gun2[${postHash}][${keyHash}]\n`, result)
    return { keys: result, keyHash, postHash }
}

/**
 * Listen on the changes of all possible keys on the gun
 * @param version current payload version
 * @param postSalt Post iv
 * @param partitionByCryptoKey Public key of the current user (receiver)
 * @param callback
 */
export function subscribePostKeysOnGun2(
    version: -39 | -38,
    postSalt: string,
    partitionByCryptoKey: CryptoKey,
    networkHint: string,
    callback: (data: SharedAESKeyGun2) => void,
) {
    hashPostSalt(postSalt, networkHint).then(postHash => {
        // In version > -39, we will use stable hash to prevent unstable result for key hashing
        ;(version <= -39 ? hashCryptoKeyUnstable : hashCryptoKey)(partitionByCryptoKey).then(keyHash => {
            gun2.get(postHash)
                // @ts-ignore
                .get(keyHash)
                .map()
                .on((data: SharedAESKeyGun2) => {
                    // @ts-ignore
                    const { _, ...data2 } = Object.assign({}, data)
                    callback(data2)
                })
        })
    })
    return () => (callback = () => {})
}

/**
 * Publish post keys on the gun
 * @param version current payload
 * @param postSalt Post iv
 * @param receiversKeys Keys needs to publish
 */
export async function publishPostAESKeyOnGun2(
    version: -39 | -38,
    postSalt: string,
    networkHint: string,
    receiversKeys: PublishedAESKeyRecordV39OrV38[],
) {
    const postHash = await hashPostSalt(postSalt, networkHint)
    // Store AES key to gun
    receiversKeys.forEach(async ({ aesKey, receiverKey }) => {
        const keyHash = await (version <= -39 ? hashCryptoKeyUnstable : hashCryptoKey)(receiverKey)
        console.log(`gun[${postHash}][${keyHash}].push(`, aesKey, `)`)
        gun2.get(postHash)
            // @ts-ignore
            .get(keyHash)
            .set(aesKey)
    })
}
