import * as jwt from 'jsonwebtoken'
import { AbiItem } from 'web3-utils'
import { EventData } from 'web3-eth-contract'
import { web3 } from './web3'
import { onClaimResult, onCreationResult, onExpired, onRefundResult } from './red-packet-fsm'
import HappyRedPacketABI from './contract/HappyRedPacket.json'
import IERC20ABI from './contract/IERC20.json'
import { IERC20 } from './contract/IERC20'
import { HappyRedPacket } from './contract/HappyRedPacket'
import { TransactionObject, Tx } from './contract/types'
import { CheckRedPacketAvailabilityResult, CreateRedPacketResult } from './types'
import { RedPacketTokenType, EthereumNetwork, RedPacketJSONPayload } from './database/types'
import { asyncTimes, pollingTask } from '../../utils/utils'
import { createWalletDBAccess } from './database/Wallet.db'
import { createTransaction } from '../../database/helpers/openDB'
import { getNetworkSettings } from './network'

function createRedPacketContract(address: string) {
    return (new web3.eth.Contract(HappyRedPacketABI as AbiItem[], address) as unknown) as HappyRedPacket
}

function createERC20Contract(address: string) {
    return (new web3.eth.Contract(IERC20ABI as AbiItem[], address) as unknown) as IERC20
}

interface TxReceipt {
    blockHash: string
    blockNumber: number
    transactionHash: string
    events: Record<string, EventData>
}

interface TxListeners {
    onTransactionHash?: (hash: string) => void
    onTransactionError?: (error: Error) => void
    onReceipt?: (receipt: TxReceipt) => void
    onEstimateError?: (error: Error) => void
}

async function sendTx<R, T extends TransactionObject<R>>(txObject: T, tx: Tx = {}, listeners: TxListeners = {}) {
    return Promise.all([txObject.estimateGas(tx), web3.eth.getGasPrice()])
        .then(([gas, gasPrice]) =>
            txObject
                .send({
                    ...tx,
                    gas,
                    gasPrice,
                })
                .on('transactionHash', (hash: string) => listeners?.onTransactionHash?.(hash))
                .on('receipt', (receipt: TxReceipt) => listeners?.onReceipt?.(receipt))
                .on('error', (err: Error) => listeners?.onTransactionError?.(err)),
        )
        .catch((err: Error) => listeners?.onEstimateError?.(err))
}

export const redPacketAPI = {
    dataSource: 'real' as const,
    async claimByServer(
        requestSenderAddress: string,
        privateKey: Buffer,
        payload: RedPacketJSONPayload,
    ): Promise<{ claim_transaction_hash: string }> {
        const host = 'https://redpacket.gives'
        const x = 'a3323cd1-fa42-44cd-b053-e474365ab3da'

        let network
        if (getNetworkSettings().networkType === EthereumNetwork.Rinkeby) network = 'rinkeby'
        else if (getNetworkSettings().networkType === EthereumNetwork.Mainnet) network = 'mainnet'
        else if (getNetworkSettings().networkType === EthereumNetwork.Ropsten) network = 'ropsten'

        const auth = await fetch(`${host}/hi?id=${requestSenderAddress}&network=${network}`)
        if (!auth.ok) throw new Error('Auth failed')
        const verify = await auth.text()

        const jwt_encoded: {
            password: string
            recipient: string
            redpacket_id: string
            validation: string
            signature: string
        } = {
            password: payload.password,
            recipient: requestSenderAddress,
            redpacket_id: payload.rpid,
            validation: web3.utils.sha3(requestSenderAddress)!,
            signature: web3.eth.accounts.sign(verify, `0x${privateKey.toString('hex')}`).signature,
        }
        const pay = await fetch(
            `${host}/please?payload=${jwt.sign(jwt_encoded, x, { algorithm: 'HS256' })}&network=${network}`,
        )
        if (!pay.ok) throw new Error('Pay failed')
        return { claim_transaction_hash: await pay.text() }
    },
    /**
     *
     * @param hash_of_password Password
     * @param quantity Quantity of red packets
     * @param is_random Is the random valid
     * @param duration Red packet valid duration (default(0): 24h), unit: second
     * @param seed Random seed 32bit byte
     * @param message Message in the red packet
     * @param name Name of the red packet sender
     * @param token_type 0 - ETH, 1 - ERC20
     * @param token_addr Addr of ERC20 token
     * @param total_tokens Amount of tokens
     * @returns The transaction hash
     */
    async create(
        ____sender__addr: string,
        hash_of_password: string,
        quantity: number,
        isRandom: boolean,
        duration: number,
        seed: string,
        message: string,
        name: string,
        token_type: RedPacketTokenType,
        token_addr: string,
        total_tokens: bigint,
    ): Promise<CreateRedPacketResult> {
        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        const tx = contract.methods.create_red_packet(
            hash_of_password,
            quantity,
            isRandom,
            duration,
            seed,
            message,
            name,
            token_type,
            token_addr,
            total_tokens.toString(),
        )

        return new Promise((resolve, reject) => {
            let txHash = ''

            sendTx(
                tx,
                {
                    from: ____sender__addr,
                    value: token_type === RedPacketTokenType.eth ? total_tokens.toString() : undefined,
                },
                {
                    onTransactionHash(hash) {
                        txHash = hash
                    },
                    async onReceipt() {
                        resolve({
                            create_nonce: (await web3.eth.getTransaction(txHash)).nonce,
                            create_transaction_hash: txHash,
                        })
                    },
                    onTransactionError(err) {
                        reject(err)
                    },
                    onEstimateError(err) {
                        reject(err)
                    },
                },
            )
        })
    },
    async claim(
        id: RedPacketID,
        password: string,
        recipient: string,
        validation: string,
    ): Promise<{ claim_transaction_hash: string }> {
        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        const tx = contract.methods.claim(id.redPacketID, password, recipient, validation)

        return new Promise((resolve, reject) => {
            let txHash = ''

            sendTx(
                tx,
                {
                    from: recipient,
                },
                {
                    onTransactionHash(hash) {
                        txHash = hash
                    },
                    onReceipt() {
                        resolve({
                            claim_transaction_hash: txHash,
                        })
                    },
                    onTransactionError(err) {
                        reject(err)
                    },
                    onEstimateError(err) {
                        reject(err)
                    },
                },
            )
        })
    },
    /**
     * Claim a red packet
     * @param id Red packet ID
     * @param password Password, index from check_availability
     * @param recipient address of the receiver
     * @param validation hash of the request sender
     * @returns Claimed money
     */
    async watchClaimResult(id: TxHashID & DatabaseID) {
        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        asyncTimes(10, async () => {
            const { blockNumber } = await web3.eth.getTransaction(id.transactionHash)

            if (!blockNumber) {
                return
            }

            const evs = await contract.getPastEvents('ClaimSuccess', {
                fromBlock: blockNumber,
                toBlock: blockNumber,
            })
            const claimSuccessEv = evs.find(ev => ev.transactionHash === id.transactionHash)

            if (claimSuccessEv) {
                const { id: return_id, claimer, claimed_value } = claimSuccessEv.returnValues as {
                    id: string
                    claimer: string
                    claimed_value: string
                    token_address: string
                }
                onClaimResult(id, {
                    type: 'success',
                    claimed_value: BigInt(claimed_value),
                    claimer,
                    red_packet_id: return_id,
                })
                return true
            }
            return
        })
            .then(results => {
                if (!results.some(r => r)) {
                    onClaimResult(id, {
                        type: 'failed',
                        reason: 'timeout',
                    })
                }
            })
            .catch(e => {
                onClaimResult(id, {
                    type: 'failed',
                    reason: e.message,
                })
            })
    },
    async watchCreateResult(id: TxHashID & DatabaseID) {
        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        asyncTimes(10, async () => {
            const { blockNumber } = await web3.eth.getTransaction(id.transactionHash)

            if (!blockNumber) {
                return
            }
            const evs = await contract.getPastEvents('CreationSuccess', {
                fromBlock: blockNumber,
                toBlock: blockNumber,
            })
            const creationSuccessEv = evs.find(ev => ev.transactionHash === id.transactionHash)

            if (creationSuccessEv) {
                const { total, id: return_id, creator, creation_time } = creationSuccessEv.returnValues as {
                    total: string
                    id: string
                    creator: string
                    creation_time: string
                    token_address: string
                }
                onCreationResult(id, {
                    type: 'success',
                    block_creation_time: new Date(parseInt(creation_time) * 1000),
                    red_packet_id: return_id,
                    creator,
                    total: BigInt(total),
                })
                return true
            }
            return
        })
            .then(results => {
                if (!results.some(r => r)) {
                    onCreationResult(id, {
                        type: 'failed',
                        reason: 'timeout',
                    })
                }
            })
            .catch(e => {
                onCreationResult(id, {
                    type: 'failed',
                    reason: e.message,
                })
            })
    },
    async watchExpired(id: RedPacketID) {
        pollingTask(async () => {
            const { expired } = await this.checkAvailability(id)

            if (expired) {
                onExpired(id)
                return true
            }
            return false
        })
    },
    async checkAvailability(id: RedPacketID): Promise<CheckRedPacketAvailabilityResult> {
        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        const {
            balance,
            claimed,
            expired,
            token_address,
            total,
            ifclaimed,
        } = await contract.methods.check_availability(id.redPacketID).call()

        return {
            balance: BigInt(balance),
            claimedCount: parseInt(claimed),
            expired,
            token_address,
            totalCount: parseInt(total),
            is_claimed: ifclaimed,
        }
    },
    /**
     * Check claimed address list
     * @param id Red packet ID
     */
    async checkClaimedList(id: RedPacketID): Promise<string[]> {
        return createRedPacketContract(getNetworkSettings().contractAddress)
            .methods.check_claimed_list(id.redPacketID)
            .call()
    },
    /**
     * Refund transaction hash
     * @param red_packet_id Red packet ID
     */
    async refund(id: RedPacketID): Promise<{ refund_transaction_hash: string }> {
        const packet = await createTransaction(
            await createWalletDBAccess(),
            'readonly',
        )('RedPacket')
            .objectStore('RedPacket')
            .index('red_packet_id')
            .get(id.redPacketID)
        const wallets = await createTransaction(
            await createWalletDBAccess(),
            'readonly',
        )('Wallet')
            .objectStore('Wallet')
            .getAll()

        if (!packet) {
            throw new Error(`can not find red packet with id: ${id}`)
        }
        if (wallets.every(wallet => wallet.address !== packet.sender_address)) {
            throw new Error('can not find available wallet')
        }

        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        const tx = contract.methods.refund(id.redPacketID)

        return new Promise((resolve, reject) => {
            let txHash = ''

            sendTx(
                tx,
                {
                    from: packet!.sender_address,
                },
                {
                    onTransactionHash(hash: string) {
                        txHash = hash
                    },
                    onReceipt() {
                        resolve({
                            refund_transaction_hash: txHash,
                        })
                    },
                    onTransactionError(err) {
                        reject(err)
                    },
                    onEstimateError(err) {
                        reject(err)
                    },
                },
            )
        })
    },
    async watchRefundResult(id: TxHashID & DatabaseID) {
        const contract = createRedPacketContract(getNetworkSettings().contractAddress)
        asyncTimes(10, async () => {
            const { blockNumber } = await web3.eth.getTransaction(id.transactionHash)

            if (!blockNumber) {
                return
            }
            const evs = await contract.getPastEvents('RefundSuccess', {
                fromBlock: blockNumber,
                toBlock: blockNumber,
            })
            const refundSuccessEv = evs.find(ev => ev.transactionHash === id.transactionHash)

            if (refundSuccessEv) {
                const { id, remaining_balance } = refundSuccessEv.returnValues as {
                    id: string
                    token_address: string
                    remaining_balance: string
                }

                onRefundResult(
                    {
                        redPacketID: id,
                    },
                    {
                        remaining_balance: BigInt(remaining_balance),
                    },
                )
            }
        })
    },
}

export const walletAPI = {
    dataSource: 'real' as const,
    queryBalance(address: string): Promise<bigint> {
        return web3.eth.getBalance(address).then(BigInt)
    },
    queryERC20TokenBalance(walletAddress: string, tokenAddress: string): Promise<bigint> {
        const erc20Contract = createERC20Contract(tokenAddress)
        return erc20Contract.methods
            .balanceOf(walletAddress)
            .call()
            .then(BigInt)
    },
    async approveERC20Token(
        senderAddress: string,
        erc20TokenAddress: string,
        amount: bigint,
    ): Promise<{ erc20_approve_transaction_hash: string; erc20_approve_value: bigint }> {
        const erc20Contract = createERC20Contract(erc20TokenAddress)
        const tx = erc20Contract.methods.approve(getNetworkSettings().contractAddress, amount.toString())

        return new Promise((resolve, reject) => {
            let txHash = ''
            sendTx(
                tx,
                { from: senderAddress },
                {
                    onTransactionHash(hash) {
                        txHash = hash
                    },
                    onReceipt() {
                        resolve({
                            erc20_approve_transaction_hash: txHash,
                            erc20_approve_value: amount,
                        })
                    },
                    onTransactionError(err) {
                        reject(err)
                    },
                    onEstimateError(err) {
                        reject(err)
                    },
                },
            )
        })
    },
}

type TxHashID = { transactionHash: string }
type RedPacketID = { redPacketID: string }
type DatabaseID = { databaseID: string }
