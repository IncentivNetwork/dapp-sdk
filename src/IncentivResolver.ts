import { TransactionRequest } from "@ethersproject/abstract-provider";
import { hexlify } from "ethers/lib/utils";
import base64url from "base64url";

export enum IncentivEnvironment {
    Staging = "https://staging.incentiv.net",
    Testnet = "https://testnet.incentiv.net",
    Mainnet = "https://incentiv.net"
}

export interface BatchRequestOptions {
    from: string,
    gasLimit?: string,
    gasPrice?: string,
    maxPriorityFeePerGas?: string,
    maxFeePerGas?: string,
}

export interface BatchCall {
    to: string,
    value?: string,
    data?: string,
}

export class IncentivResolver {
    private _portalUrl: string;

    constructor(environment: IncentivEnvironment | string) {
        this._portalUrl = environment;
    }
    
    getPortalUrl() {
        return this._portalUrl;
    }

    static async getAccountAddress(environment: IncentivEnvironment | string): Promise<string> {
        if(!window) {
            throw new Error("IncentivResolver must be used in a browser environment");
        }

        return new Promise((resolve, reject) => {
            const data = base64url.encode(JSON.stringify({ intent: "CONNECT" }));
            const popup = window.open(`${environment}/dapp?data=${data}`, "Popup", 'width=700,height=500');
            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    clearInterval(timerRef);
                    reject(new Error("Popup closed"));
                }
            }, 500);

            window.addEventListener('message', (event) => {
                if (event.origin !== environment) return;
                
                const { type, address } = event.data || {};
                if (type === 'CONNECT_RESOLVED') {
                    clearInterval(timerRef);
                    resolve(address);
                }
                else if (type === 'REJECTED') {
                    clearInterval(timerRef);
                    reject(new Error("User rejected connection"));
                }
            });
        });
    }

    async sendTransaction(transaction: TransactionRequest): Promise<string> {
        if(!window) {
            throw new Error("IncentivResolver must be used in a browser environment");
        }

        return new Promise((resolve, reject) => {
            const dataObject = {
                intent: "CALL",
                from: transaction.from,
                to: transaction.to,
                gasLimit: transaction.gasLimit?.toString(),
                gasPrice: transaction.gasPrice?.toString(),
                value: transaction.value?.toString(),
                maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString(),
                maxFeePerGas: transaction.maxFeePerGas?.toString(),
            }
            
            const encodedData = base64url.encode(JSON.stringify(dataObject));

            let hexCalldata = transaction.data ? hexlify(transaction.data) : "";
            hexCalldata = hexCalldata.startsWith("0x") ? hexCalldata.slice(2) : hexCalldata;
            const encodedCalldata = base64url.encode(hexCalldata, 'hex')

            const popup = window.open(`${this._portalUrl}/dapp?data=${encodedData}&calldata=${encodedCalldata}`, "Popup", 'width=700,height=700');
            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    clearInterval(timerRef);
                    reject(new Error("Popup closed"));
                }
            }, 500);
            
            window.addEventListener('message', (event) => {
                if (event.origin !== this._portalUrl) return;
                
                const { type, hash } = event.data || {};
                if (type === 'CALL_EXECUTED') {
                    clearInterval(timerRef);
                    resolve(hash);
                }
                else if (type === 'CALL_FAILED') {
                    clearInterval(timerRef);
                    reject(new Error("Call failed"));
                }
                else if (type === 'REJECTED') {
                    clearInterval(timerRef);
                    reject(new Error("User rejected call"));
                }
            });
        });
    }

    async sendBatchTransaction(calls: BatchCall[], options: BatchRequestOptions): Promise<string> {
        if(!window) {
            throw new Error("IncentivResolver must be used in a browser environment");
        }

        return new Promise((resolve, reject) => {
            const dataObject = {
                intent: "BATCH",
                calls: calls,
                from: options.from,
                gasLimit: options.gasLimit?.toString(),
                gasPrice: options.gasPrice?.toString(),
                maxPriorityFeePerGas: options.maxPriorityFeePerGas?.toString(),
                maxFeePerGas: options.maxFeePerGas?.toString(),
            }

            const encodedData = base64url.encode(JSON.stringify(dataObject));
            const popup = window.open(`${this._portalUrl}/dapp?data=${encodedData}`, "Popup", 'width=700,height=700');
            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    clearInterval(timerRef);
                    reject(new Error("Popup closed"));
                }
            }, 500);
            
            window.addEventListener('message', (event) => {
                if (event.origin !== this._portalUrl) return;
                
                const { type, hash } = event.data || {};
                if (type === 'BATCH_EXECUTED') {
                    clearInterval(timerRef);
                    resolve(hash);
                }
                else if (type === 'BATCH_FAILED') {
                    clearInterval(timerRef);
                    reject(new Error("Call failed"));
                }
                else if (type === 'REJECTED') {
                    clearInterval(timerRef);
                    reject(new Error("User rejected call"));
                }
            });
        });
    }
}   
