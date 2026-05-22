import {
    Contract,
    getBigInt,
    getBytes,
    hexlify,
    isAddress,
    resolveAddress,
    toUtf8Bytes,
    toUtf8String,
    type BytesLike,
    type Provider,
    type TransactionRequest,
} from "ethers";
import {
    BatchCall,
    BatchRequestOptions,
    IncentivEnvironment,
    IncentivResolver,
    SignResponse,
} from "./IncentivResolver";
import { UserOperationEventListener } from "./UserOperationEventListener";
import { connectEntryPoint, type EntryPoint } from "./contracts/entryPoint";
import SignatureVerifierABI from "./abi/SignatureVerifierABI";

export type IncentivSignerOptions = {
    entryPoint: string;
    address: string;
    provider: Provider;
    environment: IncentivEnvironment | string;
    verifierContract?: string;
};

/**
 * Receipt shape returned by `IncentivTransactionResponse.wait()`.
 *
 * Narrower than ethers v6's `TransactionReceipt`: the SDK overwrites `transactionHash`
 * with the UserOp hash (not the bundler tx hash), because multiple UserOps may be
 * bundled into a single on-chain transaction.
 */
export interface IncentivTransactionReceipt {
    transactionHash: string;
    blockNumber: number;
    blockHash: string;
    status: number;
    from: string;
    to: string | null;
}

/**
 * Response returned by `IncentivSigner.sendTransaction()` and `sendBatchTransaction()`.
 *
 * This is intentionally NOT a v6 `TransactionResponse` subclass: the UserOp pipeline
 * cannot produce a fully-populated ethers `TransactionResponse` synchronously (we
 * don't have a signature, blob hashes, accessList, etc.), and faking those fields
 * would mislead callers. Use `wait()` to obtain the receipt once the UserOp is mined.
 *
 * `nonce`, `gasLimit`, `data`, `value`, and `chainId` are optional because the
 * batch path can't supply meaningful per-call values, and on the single-call path
 * the caller may also leave them unset. `nonce` is a `bigint` (AA nonces are uint256
 * — `Number` would silently truncate above 2^53).
 */
export interface IncentivTransactionResponse {
    hash: string;
    from: string;
    to?: string;
    nonce?: bigint;
    gasLimit?: bigint;
    data?: string;
    value?: bigint;
    chainId?: bigint;
    wait: (timeout?: number) => Promise<IncentivTransactionReceipt>;
}

/**
 * Account-abstraction signer that brokers calls through the Incentiv portal.
 *
 * NOTE: As of v0.2.0 this class no longer extends `ethers.Signer` / `AbstractSigner`.
 * Use the methods on this class directly (`sendTransaction`, `signMessage`, ...)
 * — passing an `IncentivSigner` to `new ethers.Contract(addr, abi, signer)` is no
 * longer supported. To call a contract method, encode the calldata with
 * `new ethers.Interface(abi).encodeFunctionData(method, args)` and pass it to
 * `signer.sendTransaction({ to, data, value })`.
 */
class IncentivSigner {
    public incentivResolver: IncentivResolver;
    public provider: Provider;
    public address: string;
    public entryPoint: EntryPoint;
    public verifierContract?: Contract;
    private readonly entryPointAddress: string;
    private readonly verifierContractAddress?: string;

    constructor(options: IncentivSignerOptions) {
        this.address = options.address;
        this.provider = options.provider;
        this.entryPointAddress = options.entryPoint;
        this.verifierContractAddress = options.verifierContract;
        this.incentivResolver = new IncentivResolver(
            options.environment ?? IncentivEnvironment.Mainnet
        );
        this.entryPoint = connectEntryPoint(options.entryPoint, options.provider);
        if (options.verifierContract) {
            this.verifierContract = new Contract(
                options.verifierContract,
                SignatureVerifierABI,
                options.provider
            );
        }
    }

    getAddress(): Promise<string> {
        if (!this.address) {
            throw new Error("Account address not set.");
        }
        return Promise.resolve(this.address);
    }

    /**
     * Sign a message and return the legacy `${signature}:${owner}` colon-joined form.
     *
     * @deprecated Use `signMessageDetailed()` instead — it returns the structured
     * `SignResponse` and is safer to parse. The colon-joined form is fragile (any
     * downstream code that splits on `":"` breaks if `owner` ever contains one) and
     * will be removed in 0.3.0. Kept in 0.2.x for backwards compatibility.
     */
    async signMessage(message: BytesLike | string): Promise<string> {
        const messageString = typeof message === "string" ? message : toUtf8String(message);

        try {
            const response: SignResponse = await this.incentivResolver.signMessage(messageString);
            return `${response.signature}:${response.owner}`;
        } catch (error) {
            throw new Error(
                `Failed to sign message: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    async signMessageDetailed(message: BytesLike | string): Promise<SignResponse> {
        const messageString = typeof message === "string" ? message : toUtf8String(message);

        try {
            return await this.incentivResolver.signMessage(messageString);
        } catch (error) {
            throw new Error(
                `Failed to sign message: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    async getAccountAddress() {
        const address = await IncentivResolver.getAccountAddress(this.incentivResolver.getPortalUrl());
        this.address = address;
        return address;
    }

    async sendTransaction(transaction: TransactionRequest): Promise<IncentivTransactionResponse> {
        // v6 `AddressLike` accepts strings, `Addressable` (e.g. a Contract instance),
        // or a Promise of either. We must resolve both to hex strings before forwarding
        // to the Portal — the resolver JSON-stringifies the request into the popup URL,
        // which would otherwise embed `[object Object]` for Addressable inputs.
        const fromAddr = transaction.from != null
            ? await resolveAddress(transaction.from)
            : this.address;
        const toAddr = transaction.to != null
            ? await resolveAddress(transaction.to)
            : undefined;

        const normalized: TransactionRequest = {
            ...transaction,
            from: fromAddr,
            to: toAddr ?? null,
        };
        const hash = await this.incentivResolver.sendTransaction(normalized);
        const response: IncentivTransactionResponse = {
            hash,
            from: fromAddr,
            wait: (timeout: number = 60000) => this.waitForUserOp(hash, fromAddr, timeout),
        };
        if (toAddr != null) response.to = toAddr;
        // AA nonces are uint256 — use getBigInt to preserve precision above 2^53.
        if (transaction.nonce != null) response.nonce = getBigInt(transaction.nonce);
        if (transaction.gasLimit != null) response.gasLimit = getBigInt(transaction.gasLimit);
        if (transaction.data != null) response.data = hexlify(transaction.data);
        if (transaction.value != null) response.value = getBigInt(transaction.value);
        if (transaction.chainId != null) response.chainId = getBigInt(transaction.chainId);
        return response;
    }

    async sendBatchTransaction(
        calls: BatchCall[],
        options: BatchRequestOptions
    ): Promise<IncentivTransactionResponse> {
        const fromAddr = options.from ?? this.address;
        const hash = await this.incentivResolver.sendBatchTransaction(calls, options);
        // Omit per-call fields (`nonce`/`data`/`value`/`chainId`): a batch has no
        // single value for them, and unconditional defaults would be
        // indistinguishable from real zeros.
        const response: IncentivTransactionResponse = {
            hash,
            from: fromAddr,
            wait: (timeout: number = 60000) => this.waitForUserOp(hash, fromAddr, timeout),
        };
        if (options.gasLimit != null) response.gasLimit = getBigInt(options.gasLimit);
        return response;
    }

    private waitForUserOp(hash: string, sender: string, timeout: number): Promise<IncentivTransactionReceipt> {
        return new Promise<IncentivTransactionReceipt>((resolve, reject) => {
            const listener = new UserOperationEventListener(
                resolve,
                reject,
                this.entryPoint,
                sender,
                hash,
                undefined,
                timeout
            );
            listener.start();
        });
    }

    setAccountAddress(address: string) {
        if (!isAddress(address)) {
            throw new Error("Invalid account address.");
        }
        this.address = address;
    }

    async verifySignature(
        message: BytesLike | string,
        signature: string,
        owner: string
    ): Promise<{ isValid: boolean; accountAddress: string }> {
        if (!this.verifierContract) {
            throw new Error(
                "Signature verification is not available. Please provide a verifierContract address when initializing IncentivSigner."
            );
        }

        try {
            const messageBytes =
                typeof message === "string" ? toUtf8Bytes(message) : getBytes(message);
            const ownerBytes = getBytes(owner);
            const signatureBytes = getBytes(signature);

            const result = await this.verifierContract.verifySignature.staticCall(
                ownerBytes,
                messageBytes,
                signatureBytes
            );

            return {
                isValid: result.isValid,
                accountAddress: result.accountAddress,
            };
        } catch (error) {
            throw new Error(
                `Failed to verify signature: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    connect(provider: Provider): IncentivSigner {
        if (!this.address) {
            throw new Error("Account address not set.");
        }
        return new IncentivSigner({
            address: this.address,
            provider,
            environment: this.incentivResolver.getPortalUrl(),
            entryPoint: this.entryPointAddress,
            verifierContract: this.verifierContractAddress,
        });
    }
}

export default IncentivSigner;
