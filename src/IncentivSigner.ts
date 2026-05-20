import {
    Contract,
    getBigInt,
    getBytes,
    isAddress,
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
 */
export interface IncentivTransactionResponse {
    hash: string;
    from: string;
    to?: string;
    nonce: number;
    gasLimit: bigint;
    data: string;
    value: bigint;
    chainId: bigint;
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
        const hash = await this.incentivResolver.sendTransaction(transaction);
        return {
            hash,
            from: (transaction.from as string | undefined) ?? this.address,
            to: (transaction.to as string | undefined) ?? undefined,
            nonce: Number(transaction.nonce ?? 0),
            gasLimit: getBigInt(transaction.gasLimit ?? 0),
            data: transaction.data?.toString() ?? "",
            value: getBigInt(transaction.value ?? 0),
            chainId: getBigInt(transaction.chainId ?? 0),
            wait: (timeout: number = 60000) => this.waitForUserOp(hash, timeout),
        };
    }

    async sendBatchTransaction(
        calls: BatchCall[],
        options: BatchRequestOptions
    ): Promise<IncentivTransactionResponse> {
        const hash = await this.incentivResolver.sendBatchTransaction(calls, options);
        return {
            hash,
            from: options.from ?? this.address,
            nonce: 0,
            gasLimit: getBigInt(options.gasLimit ?? 0),
            data: "",
            value: 0n,
            chainId: 0n,
            wait: (timeout: number = 60000) => this.waitForUserOp(hash, timeout),
        };
    }

    private waitForUserOp(hash: string, timeout: number): Promise<IncentivTransactionReceipt> {
        return new Promise<IncentivTransactionReceipt>((resolve, reject) => {
            const listener = new UserOperationEventListener(
                resolve,
                reject,
                this.entryPoint,
                this.address,
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
