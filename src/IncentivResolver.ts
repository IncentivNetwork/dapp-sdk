import { hexlify, resolveAddress, type TransactionRequest } from "ethers";
import base64url from "base64url";

export enum IncentivEnvironment {
    Testnet = "https://testnet.incentiv.io",
    Mainnet = "https://portal.incentiv.io"
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

export interface SignResponse {
    payload: string;
    signature: string;
    owner: string;
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
        if (typeof window === "undefined") {
            throw new Error("IncentivResolver must be used in a browser environment");
        }

        return new Promise((resolve, reject) => {
            const data = base64url.encode(JSON.stringify({ intent: "CONNECT" }));
            const popup = window.open(`${environment}/dapp?data=${data}`, "Popup", 'width=700,height=500');

            // Popup blockers return null. Without this guard `event.source !== popup`
            // would silently drop every message and the Promise would hang to timeout.
            if (!popup) {
                reject(new Error("Popup blocked. Please allow popups for this site and try again."));
                return;
            }

            let cleanup: () => void;

            const handleMessage = (event: MessageEvent) => {
                if (event.origin !== environment) return;
                // event.source is the Window that called postMessage. Cross-checking
                // it against the popup we just opened is defense-in-depth against
                // a same-origin iframe spoofing the portal's response.
                if (event.source !== popup) return;

                const { type, address } = event.data || {};
                if (type === 'CONNECT_RESOLVED') {
                    cleanup();
                    resolve(address);
                }
                else if (type === 'REJECTED') {
                    cleanup();
                    reject(new Error("User rejected connection"));
                }
            };

            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    cleanup();
                    reject(new Error("Popup closed"));
                }
            }, 500);

            cleanup = () => {
                clearInterval(timerRef);
                window.removeEventListener('message', handleMessage);
            };

            window.addEventListener('message', handleMessage);
        });
    }

    async sendTransaction(transaction: TransactionRequest): Promise<string> {
        if (typeof window === "undefined") {
            throw new Error("IncentivResolver must be used in a browser environment");
        }
        const portalUrl = this._portalUrl;

        // v6 `AddressLike` accepts strings, `Addressable` (e.g. Contract instances),
        // or Promises of either. Resolve to hex strings before JSON-stringifying
        // into the popup URL — an Addressable would otherwise serialize to `{}`.
        const fromAddr = transaction.from != null
            ? await resolveAddress(transaction.from)
            : undefined;
        const toAddr = transaction.to != null
            ? await resolveAddress(transaction.to)
            : undefined;

        return new Promise((resolve, reject) => {
            const dataObject = {
                intent: "CALL",
                from: fromAddr,
                to: toAddr,
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

            const popup = window.open(`${portalUrl}/dapp?data=${encodedData}&calldata=${encodedCalldata}`, "Popup", 'width=700,height=700');

            if (!popup) {
                reject(new Error("Popup blocked. Please allow popups for this site and try again."));
                return;
            }

            let cleanup: () => void;

            const handleMessage = (event: MessageEvent) => {
                if (event.origin !== portalUrl) return;
                if (event.source !== popup) return;

                const { type, hash } = event.data || {};
                if (type === 'CALL_EXECUTED') {
                    cleanup();
                    resolve(hash);
                }
                else if (type === 'CALL_FAILED') {
                    cleanup();
                    reject(new Error("Call failed"));
                }
                else if (type === 'REJECTED') {
                    cleanup();
                    reject(new Error("User rejected call"));
                }
            };

            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    cleanup();
                    reject(new Error("Popup closed"));
                }
            }, 500);

            cleanup = () => {
                clearInterval(timerRef);
                window.removeEventListener('message', handleMessage);
            };

            window.addEventListener('message', handleMessage);
        });
    }

    async sendBatchTransaction(calls: BatchCall[], options: BatchRequestOptions): Promise<string> {
        if (typeof window === "undefined") {
            throw new Error("IncentivResolver must be used in a browser environment");
        }
        const portalUrl = this._portalUrl;

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
            const popup = window.open(`${portalUrl}/dapp?data=${encodedData}`, "Popup", 'width=700,height=700');

            if (!popup) {
                reject(new Error("Popup blocked. Please allow popups for this site and try again."));
                return;
            }

            let cleanup: () => void;

            const handleMessage = (event: MessageEvent) => {
                if (event.origin !== portalUrl) return;
                if (event.source !== popup) return;

                const { type, hash } = event.data || {};
                if (type === 'BATCH_EXECUTED') {
                    cleanup();
                    resolve(hash);
                }
                else if (type === 'BATCH_FAILED') {
                    cleanup();
                    reject(new Error("Call failed"));
                }
                else if (type === 'REJECTED') {
                    cleanup();
                    reject(new Error("User rejected call"));
                }
            };

            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    cleanup();
                    reject(new Error("Popup closed"));
                }
            }, 500);

            cleanup = () => {
                clearInterval(timerRef);
                window.removeEventListener('message', handleMessage);
            };

            window.addEventListener('message', handleMessage);
        });
    }

    async signMessage(message: string): Promise<SignResponse> {
        if (typeof window === "undefined") {
            throw new Error("IncentivResolver must be used in a browser environment");
        }
        const portalUrl = this._portalUrl;

        return new Promise((resolve, reject) => {
            const dataObject = {
                intent: "SIGN",
                payload: message
            };

            const encodedData = base64url.encode(JSON.stringify(dataObject));
            const popup = window.open(`${portalUrl}/dapp?data=${encodedData}`, "Popup", 'width=700,height=700');

            if (!popup) {
                reject(new Error("Popup blocked. Please allow popups for this site and try again."));
                return;
            }

            let cleanup: () => void;

            const handleMessage = (event: MessageEvent) => {
                if (event.origin !== portalUrl) return;
                if (event.source !== popup) return;

                const { type, payload, signature, owner, reason } = event.data || {};

                if (type === 'SIGN_RESOLVED') {
                    cleanup();
                    popup?.close();
                    resolve({
                        payload,
                        signature,
                        owner
                    });
                }
                else if (type === 'SIGN_FAILED') {
                    cleanup();
                    popup?.close();
                    reject(new Error(`Sign failed: ${reason}`));
                }
                else if (type === 'REJECTED') {
                    cleanup();
                    popup?.close();
                    reject(new Error(`User rejected signature request: ${reason}`));
                }
            };

            const timerRef = setInterval(() => {
                if(popup?.closed) {
                    cleanup();
                    reject(new Error("Popup closed"));
                }
            }, 500);

            cleanup = () => {
                clearInterval(timerRef);
                window.removeEventListener('message', handleMessage);
            };

            window.addEventListener('message', handleMessage);
        });
    }
}
