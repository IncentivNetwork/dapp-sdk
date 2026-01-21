import { BigNumber, ethers } from "ethers";
import { BatchCall, BatchRequestOptions, IncentivEnvironment, IncentivResolver, SignResponse } from "./IncentivResolver";
import { TransactionReceipt, TransactionRequest, TransactionResponse } from "@ethersproject/abstract-provider";
import { UserOperationEventListener } from "./UserOperationEventListener";
import { EntryPoint__factory } from "./contracts/EntryPoint__factory";
import { EntryPoint } from "./contracts/EntryPoint";
import SignatureVerifierABI from "./abi/SignatureVerifierABI";

export type IncentivSignerOptions = {
    entryPoint: string;
    address: string;
    provider: ethers.providers.Provider;
    environment: IncentivEnvironment | string;
    verifierContract?: string;
}

class IncentivSigner extends ethers.Signer {
    public incentivResolver: IncentivResolver;
    public provider: ethers.providers.Provider;
    public address: string;
    public entryPoint: EntryPoint;
    public verifierContract?: ethers.Contract;

    constructor(options: IncentivSignerOptions) {
        super();
        this.address = options.address;
        this.provider = options.provider;
        this.incentivResolver = new IncentivResolver(
            options.environment ?? IncentivEnvironment.Mainnet
        );
        this.entryPoint = EntryPoint__factory.connect(
            options.entryPoint, 
            options.provider
        );
        if (options.verifierContract) {
            this.verifierContract = new ethers.Contract(
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

    async signMessage(message: ethers.Bytes | string): Promise<string> {
        // Convert bytes to string if needed
        const messageString = typeof message === 'string' ? message : ethers.utils.toUtf8String(message);
        
        try {
            const response: SignResponse = await this.incentivResolver.signMessage(messageString);
            return response.signature;
        } catch (error) {
            throw new Error(`Failed to sign message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async signMessageDetailed(message: ethers.Bytes | string): Promise<SignResponse> {
        // Convert bytes to string if needed
        const messageString = typeof message === 'string' ? message : ethers.utils.toUtf8String(message);
        
        try {
            return await this.incentivResolver.signMessage(messageString);
        } catch (error) {
            throw new Error(`Failed to sign message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    signTransaction(transaction: TransactionRequest): Promise<string> {
        throw new Error("Method not supported.");
    }

    async getAccountAddress() {
        const address = await IncentivResolver.getAccountAddress(this.incentivResolver.getPortalUrl());
        this.address = address;
        return address;
    }

    async sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
        const hash = await this.incentivResolver.sendTransaction(transaction);
        return {
            hash: hash,
            confirmations: 0,
            from: transaction.from ?? "",
            nonce: Number(transaction.nonce ?? 0),
            gasLimit: BigNumber.from(transaction.gasLimit ?? 0),
            data: transaction.data?.toString() ?? "",
            value: BigNumber.from(transaction.value ?? 0),
            chainId: transaction.chainId ?? 0,
            wait: async (timeout: number = 60000) => { 
                return await new Promise<TransactionReceipt>((resolve, reject) => {
                    const listener = new UserOperationEventListener(
                        resolve, 
                        reject, 
                        this.entryPoint, 
                        this.address, 
                        hash, 
                        undefined, 
                        timeout
                    )
                    listener.start()
                })
            },
        };
    }

    async sendBatchTransaction(calls: BatchCall[], options: BatchRequestOptions): Promise<TransactionResponse> {
        const hash = await this.incentivResolver.sendBatchTransaction(calls, options);
        return {
            hash: hash,
            confirmations: 0,
            from: options.from ?? "",
            nonce: Number(0),
            gasLimit: BigNumber.from(options.gasLimit ?? 0),
            data: "",
            value: BigNumber.from(0),
            chainId: 0,
            wait: async (timeout: number = 60000) => { 
                return await new Promise<TransactionReceipt>((resolve, reject) => {
                    const listener = new UserOperationEventListener(
                        resolve, 
                        reject, 
                        this.entryPoint, 
                        this.address, 
                        hash, 
                        undefined, 
                        timeout
                    )
                    listener.start()
                })
            },
        };
    }

    setAccountAddress(address: string) {
        if(!ethers.utils.isAddress(address)) {
            throw new Error("Invalid account address.");
        }
        this.address = address;
    }

    async verifySignature(
        message: ethers.Bytes | string,
        signature: string,
        owner: string
    ): Promise<{ isValid: boolean; accountAddress: string }> {
        if (!this.verifierContract) {
            throw new Error(
                'Signature verification is not available. Please provide a verifierContract address when initializing IncentivSigner.'
            );
        }

        try {
            // Convert message to bytes if it's a string
            const messageBytes = typeof message === 'string' 
                ? ethers.utils.toUtf8Bytes(message) 
                : message;
            
            // Owner is always a hex string, convert to bytes
            const ownerBytes = ethers.utils.arrayify(owner);
            
            // Signature is a hex string, convert to bytes
            const signatureBytes = ethers.utils.arrayify(signature);

            // Call the verifier contract
            const result = await this.verifierContract.callStatic.verifySignature(
                ownerBytes,
                messageBytes,
                signatureBytes
            );

            return {
                isValid: result.isValid,
                accountAddress: result.accountAddress
            };
        } catch (error) {
            throw new Error(`Failed to verify signature: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    connect(provider: ethers.providers.Provider): ethers.Signer {
        if (!this.address) {
            throw new Error("Account address not set.");
        }
        return new IncentivSigner({
            address: this.address,
            provider: provider,
            environment: this.incentivResolver.getPortalUrl(),
            entryPoint: this.entryPoint.address,
            verifierContract: this.verifierContract?.address,
        });
    }
}

export default IncentivSigner;