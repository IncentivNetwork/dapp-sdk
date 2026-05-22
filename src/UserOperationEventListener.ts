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
const PRECHECK_LOOKBACK_BLOCKS: number = 10;

/**
 * Subscribes to the EntryPoint's `UserOperationEvent` for a specific userOpHash and
 * resolves with a narrowed receipt once the UserOp is mined. On a failed UserOp
 * (`success == false`), pulls the matching `UserOperationRevertReason` log and rejects
 * with the decoded reason string.
 */
export class UserOperationEventListener {
    resolved: boolean = false;
    private settled: boolean = false;
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
    }

    start(): void {
        // Timer belongs to the listener lifecycle: don't start ticking until
        // start() is called.
        this.timer = setTimeout(() => {
            if (this.settled) return;
            this.settled = true;
            this.stop();
            this.reject(new Error("Timed out"));
        }, this.timeout ?? DEFAULT_TRANSACTION_TIMEOUT);

        const filter = this.entryPoint.filters.UserOperationEvent(this.userOpHash);
        this.filter = filter;

        // Register the subscription BEFORE the lookback query: once() only fires
        // for future events, so a UserOp mined between the lookback and the
        // subscription would otherwise be lost. The lookback then catches a
        // UserOp already mined before start() (realistic — a bundler can include
        // it before the portal's postMessage round-trip completes). handleLog
        // is idempotent via `settled`.
        void this.entryPoint.once(filter, this.boundListener);

        void (async () => {
            try {
                // eth_getLogs requires an absolute fromBlock — negative offsets
                // are not part of the JSON-RPC spec and ethers v6 does not
                // normalize them. Resolve the current block first and clamp
                // at 0 (chains < lookback blocks old, or non-EVM mocks).
                const provider = this.entryPoint.runner?.provider;
                if (provider == null) {
                    // No provider on the runner; skip the lookback. The live
                    // subscription will still catch any future UserOp.
                    return;
                }
                const currentBlock = await provider.getBlockNumber();
                const fromBlock = Math.max(0, currentBlock - PRECHECK_LOOKBACK_BLOCKS);
                const events = await this.entryPoint.queryFilter(
                    filter,
                    fromBlock,
                    "latest"
                );
                if (events.length > 0 && !this.settled) {
                    await this.handleLog(events[0] as EventLog);
                }
            } catch (err) {
                if (this.settled) return;
                this.settled = true;
                this.stop();
                this.reject(err);
            }
        })();
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.filter) {
            // v6 requires removing a filter-based listener by the same filter
            // object, not by event name.
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
        if (this.settled) return;
        try {
            const payload = params[params.length - 1] as ContractEventPayload;
            await this.handleLog(payload.log);
        } catch (err) {
            if (this.settled) return;
            this.settled = true;
            this.stop();
            this.reject(err);
        }
    }

    private async handleLog(log: EventLog | Log): Promise<void> {
        if (this.settled) return;

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
            if (this.settled) return;
            this.settled = true;
            this.stop();
            this.reject(new Error("Transaction receipt unavailable"));
            return;
        }

        if (!args.success) {
            if (this.settled) return;
            this.settled = true;
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

        if (this.settled) return;
        this.settled = true;
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
