import {
    AbiCoder,
    type ContractEventPayload,
    type DeferredTopicFilter,
    type EventLog,
    type Log,
} from "ethers";
import type { EntryPoint } from "./contracts/entryPoint";
import type { IncentivTransactionReceipt } from "./IncentivSigner";

const DEFAULT_TRANSACTION_TIMEOUT: number = 10000;

/**
 * Subscribes to the EntryPoint's `UserOperationEvent` for a specific userOpHash and
 * resolves with a narrowed receipt once the UserOp is mined. On a failed UserOp
 * (`success == false`), pulls the matching `UserOperationRevertReason` log and rejects
 * with the decoded reason string.
 */
export class UserOperationEventListener {
    resolved: boolean = false;
    private timer?: ReturnType<typeof setTimeout>;
    private filter?: DeferredTopicFilter;
    private readonly boundListener: (...args: unknown[]) => Promise<void>;

    constructor(
        readonly resolve: (t: IncentivTransactionReceipt) => void,
        readonly reject: (reason?: unknown) => void,
        readonly entryPoint: EntryPoint,
        readonly sender: string,
        readonly userOpHash: string,
        readonly nonce?: bigint | number,
        readonly timeout?: number
    ) {
        this.boundListener = this.listenerCallback.bind(this) as (
            ...args: unknown[]
        ) => Promise<void>;
        this.timer = setTimeout(() => {
            this.stop();
            this.reject(new Error("Timed out"));
        }, this.timeout ?? DEFAULT_TRANSACTION_TIMEOUT);
    }

    start(): void {
        const filter = this.entryPoint.filters.UserOperationEvent(this.userOpHash);
        this.filter = filter;
        // The listener takes a moment to register; first query directly in case the
        // UserOp was already mined.
        setTimeout(async () => {
            try {
                const events = await this.entryPoint.queryFilter(filter, "latest");
                if (events.length > 0) {
                    await this.handleLog(events[0] as EventLog);
                } else {
                    // BaseContract.once returns Promise<this> in v6; we don't await.
                    void this.entryPoint.once(filter, this.boundListener);
                }
            } catch (err) {
                this.stop();
                this.reject(err);
            }
        }, 100);
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.filter) {
            // v6 requires removing a filter-based listener by the same filter object,
            // not by event name — `off("UserOperationEvent", …)` wouldn't match.
            void this.entryPoint.off(this.filter, this.boundListener);
            this.filter = undefined;
        }
    }

    /**
     * v6 contract listeners receive each event arg as positional params followed by a
     * trailing `ContractEventPayload`. We only care about the payload's `.log`, which
     * carries `args` and `getTransactionReceipt()`.
     */
    async listenerCallback(...params: unknown[]): Promise<void> {
        try {
            const payload = params[params.length - 1] as ContractEventPayload;
            await this.handleLog(payload.log);
        } catch (err) {
            this.stop();
            this.reject(err);
        }
    }

    private async handleLog(log: EventLog | Log): Promise<void> {
        const args = (log as EventLog).args;
        if (args == null) {
            console.error("got event without args", log);
            return;
        }

        if (args.userOpHash !== this.userOpHash) {
            console.log(
                `== event with wrong userOpHash: sender/nonce: event.${args.sender as string}@${
                    args.nonce?.toString() as string
                } != userOp.${this.sender}@${this.nonce?.toString() ?? ""}`
            );
            return;
        }

        const txReceipt = await log.getTransactionReceipt();
        if (txReceipt == null) {
            this.stop();
            this.reject(new Error("Transaction receipt unavailable"));
            return;
        }

        if (!args.success) {
            try {
                const reason = await this.extractFailureReason(txReceipt.blockNumber);
                this.stop();
                this.reject(new Error(`UserOp failed with reason: ${reason}`));
            } catch (err) {
                this.stop();
                this.reject(err);
            }
            return;
        }

        this.stop();
        this.resolve({
            transactionHash: this.userOpHash,
            blockNumber: txReceipt.blockNumber,
            blockHash: txReceipt.blockHash,
            // Derive from the authoritative `args.success` so the receipt agrees with
            // the UserOp result regardless of whether the bundler tx itself has a
            // null/undefined `status` field.
            status: args.success ? 1 : 0,
            from: txReceipt.from,
            to: txReceipt.to,
        });
        this.resolved = true;
    }

    private async extractFailureReason(blockNumber: number): Promise<string> {
        const filter = this.entryPoint.filters.UserOperationRevertReason(
            this.userOpHash,
            this.sender
        );
        // v6 queryFilter takes (event, fromBlock?, toBlock?) — `blockHash` is no longer
        // a valid BlockTag, so we constrain by block number instead.
        const events = await this.entryPoint.queryFilter(filter, blockNumber, blockNumber);
        const ev = events[0] as EventLog | undefined;
        if (ev?.args == null) {
            return "unknown";
        }
        let message: string = ev.args.revertReason as string;
        if (typeof message === "string" && message.startsWith("0x08c379a0")) {
            // Solidity Error(string)
            const decoded = AbiCoder.defaultAbiCoder().decode(
                ["string"],
                "0x" + message.substring(10)
            );
            message = String(decoded[0]);
        }
        return message;
    }
}
