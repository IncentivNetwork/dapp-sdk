import { BigNumber, ethers } from "ethers";
import { IncentivEnvironment, IncentivResolver } from "./IncentivResolver";
import { TransactionRequest, TransactionResponse } from "@ethersproject/abstract-provider";

export type IncentivSignerOptions = {
    address?: string;
    provider?: ethers.providers.Provider;
    environment?: IncentivEnvironment | string;
}

class IncentivSigner extends ethers.Signer {
    public incentivResolver: IncentivResolver;
    public provider?: ethers.providers.Provider;
    public address?: string;

    constructor(options: IncentivSignerOptions) {
        super();
        this.address = options.address;
        this.provider = options.provider;
        this.incentivResolver = new IncentivResolver(
            options.environment ?? IncentivEnvironment.Mainnet
        );
    }

    getAddress(): Promise<string> {
        if (!this.address) {
            throw new Error("Account address not set.");
        }
        return Promise.resolve(this.address);
    }

    signMessage(message: ethers.Bytes | string): Promise<string> {
        throw new Error("Method not supported.");
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
            wait: async () => { throw new Error("Method not supported."); },
        };
    }

    setAccountAddress(address: string) {
        if(!ethers.utils.isAddress(address)) {
            throw new Error("Invalid account address.");
        }
        this.address = address;
    }

    connect(provider: ethers.providers.Provider): ethers.Signer {
        if (!this.address) {
            throw new Error("Account address not set.");
        }
        return new IncentivSigner({
            address: this.address,
            provider: provider,
            environment: this.incentivResolver.getPortalUrl(),
        });
    }
}

export default IncentivSigner;