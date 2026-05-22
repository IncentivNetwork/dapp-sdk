import { AbiCoder } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserOperationEventListener } from "../src/UserOperationEventListener";

type Filter = { _kind: string; userOpHash?: string; sender?: string };
type LiveListener = (...args: unknown[]) => Promise<void> | void;

const USER_OP_HASH = "0x" + "ab".repeat(32);
const SENDER = "0x" + "11".repeat(20);

function makeReceipt(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        blockNumber: 99,
        blockHash: "0xbeef",
        status: 1,
        from: "0xfrom",
        to: "0xto",
        ...overrides,
    };
}

function makeLog(args: Record<string, unknown>, receipt: unknown = makeReceipt()) {
    return {
        args,
        blockNumber: (receipt as { blockNumber: number }).blockNumber,
        getTransactionReceipt: vi.fn(async () => receipt),
    };
}

function makeMockEntryPoint() {
    const live = new Map<Filter, LiveListener>();
    let lookbackEvents: ReturnType<typeof makeLog>[] = [];
    let revertEvents: { args: Record<string, unknown> }[] = [];

    const filters = {
        UserOperationEvent: vi.fn(
            (userOpHash: string): Filter => ({ _kind: "UserOperationEvent", userOpHash })
        ),
        UserOperationRevertReason: vi.fn(
            (userOpHash: string, sender: string): Filter => ({
                _kind: "UserOperationRevertReason",
                userOpHash,
                sender,
            })
        ),
    };

    const once = vi.fn(async (filter: Filter, listener: LiveListener) => {
        live.set(filter, listener);
    });

    const off = vi.fn(async (_filter: Filter, _listener: LiveListener) => {});

    const queryFilter = vi.fn(async (filter: Filter) => {
        if (filter._kind === "UserOperationEvent") return lookbackEvents;
        if (filter._kind === "UserOperationRevertReason") return revertEvents;
        return [];
    });

    const runner = {
        getBlockNumber: vi.fn(async () => 100),
    };

    const entryPoint = { filters, once, off, queryFilter, runner } as unknown as never;

    return {
        entryPoint,
        filters,
        once,
        off,
        queryFilter,
        runner,
        setLookback: (events: ReturnType<typeof makeLog>[]) => {
            lookbackEvents = events;
        },
        setRevert: (events: { args: Record<string, unknown> }[]) => {
            revertEvents = events;
        },
        fireLive: async (filter: Filter, log: unknown) => {
            const fn = live.get(filter);
            if (!fn) throw new Error("no live listener registered for filter");
            await fn(log, { log });
        },
    };
}

function makeListener<T>(
    mock: ReturnType<typeof makeMockEntryPoint>,
    timeout: number,
    sender: string = SENDER
): { promise: Promise<T>; resolveSpy: ReturnType<typeof vi.fn>; rejectSpy: ReturnType<typeof vi.fn>; listener: UserOperationEventListener } {
    let resolveCapture!: (value: T) => void;
    let rejectCapture!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolveCapture = res;
        rejectCapture = rej;
    });
    const resolveSpy = vi.fn(resolveCapture);
    const rejectSpy = vi.fn(rejectCapture);
    const listener = new UserOperationEventListener(
        resolveSpy as never,
        rejectSpy,
        mock.entryPoint,
        sender,
        USER_OP_HASH,
        undefined,
        timeout
    );
    return { promise, resolveSpy, rejectSpy, listener };
}

describe("UserOperationEventListener", () => {
    let mock: ReturnType<typeof makeMockEntryPoint>;

    beforeEach(() => {
        mock = makeMockEntryPoint();
    });

    describe("resolution paths", () => {
        it("resolves via the lookback path", async () => {
            mock.setLookback([
                makeLog({ userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: true }),
            ]);

            const { promise, listener } = makeListener<{
                transactionHash: string;
                status: number;
                blockHash: string;
            }>(mock, 2000);
            listener.start();
            const receipt = await promise;

            expect(receipt.transactionHash).toBe(USER_OP_HASH);
            expect(receipt.status).toBe(1);
            expect(receipt.blockHash).toBe("0xbeef");
        });

        it("resolves via the live event when lookback returns empty", async () => {
            mock.setLookback([]);

            const { promise, listener } = makeListener<{ transactionHash: string }>(mock, 2000);
            listener.start();
            await vi.waitFor(() => expect(mock.once).toHaveBeenCalledTimes(1));

            const filter = mock.once.mock.calls[0][0] as Filter;
            await mock.fireLive(
                filter,
                makeLog({ userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: true })
            );

            const receipt = await promise;
            expect(receipt.transactionHash).toBe(USER_OP_HASH);
        });

        it("derives receipt.status from args.success even when txReceipt.status disagrees", async () => {
            // args.success === true but the bundler-level tx receipt says status 0:
            // the listener must trust args.success (the authoritative UserOp result).
            mock.setLookback([
                makeLog(
                    { userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: true },
                    makeReceipt({ status: 0 })
                ),
            ]);

            const { promise, listener } = makeListener<{ status: number }>(mock, 2000);
            listener.start();
            const receipt = await promise;

            // Would be 0 if the listener regressed to `txReceipt.status ?? 1`.
            expect(receipt.status).toBe(1);
        });
    });

    describe("revert handling", () => {
        it("rejects with the decoded Solidity Error(string) reason and queries revert filter with sender", async () => {
            const reasonString = "out of funds";
            const encodedBody = AbiCoder.defaultAbiCoder()
                .encode(["string"], [reasonString])
                .slice(2);
            const revertReason = "0x08c379a0" + encodedBody;

            mock.setLookback([
                makeLog(
                    { userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: false },
                    makeReceipt({ blockNumber: 99 })
                ),
            ]);
            mock.setRevert([{ args: { userOpHash: USER_OP_HASH, sender: SENDER, revertReason } }]);

            const { promise, listener } = makeListener(mock, 2000);
            listener.start();
            await expect(promise).rejects.toThrow(/out of funds/);

            expect(mock.filters.UserOperationRevertReason).toHaveBeenCalledWith(
                USER_OP_HASH,
                SENDER
            );
        });

        it("falls back to 'unknown' when no UserOperationRevertReason event is found", async () => {
            mock.setLookback([
                makeLog(
                    { userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: false },
                    makeReceipt({ blockNumber: 99 })
                ),
            ]);
            mock.setRevert([]);

            const { promise, listener } = makeListener(mock, 2000);
            listener.start();
            await expect(promise).rejects.toThrow(/UserOp failed with reason: unknown/);
        });
    });

    describe("listener lifecycle", () => {
        it("removes the listener via the same filter object passed to once()", async () => {
            mock.setLookback([]);

            const { promise, listener } = makeListener(mock, 50);
            listener.start();
            await expect(promise).rejects.toThrow(/Timed out/);

            expect(mock.once).toHaveBeenCalledTimes(1);
            expect(mock.off).toHaveBeenCalledTimes(1);
            const filterFromOnce = mock.once.mock.calls[0][0];
            const filterFromOff = mock.off.mock.calls[0][0];
            // Identity check — would fail if stop() called off("UserOperationEvent", …) by name.
            expect(filterFromOff).toBe(filterFromOnce);
        });

        it("does not double-resolve when lookback hit and live event both fire", async () => {
            mock.setLookback([
                makeLog({ userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: true }),
            ]);

            const { resolveSpy, rejectSpy, listener } = makeListener(mock, 2000);
            listener.start();
            await vi.waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));

            const filter = mock.once.mock.calls[0][0] as Filter;
            await mock.fireLive(
                filter,
                makeLog({ userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: true })
            );

            expect(resolveSpy).toHaveBeenCalledTimes(1);
            expect(rejectSpy).not.toHaveBeenCalled();
        });

        it("does not start the timer in the constructor — only in start()", async () => {
            const { resolveSpy, rejectSpy } = makeListener(mock, 30);
            // Listener constructed, never started.
            await new Promise((r) => setTimeout(r, 80));

            expect(resolveSpy).not.toHaveBeenCalled();
            expect(rejectSpy).not.toHaveBeenCalled();
            expect(mock.once).not.toHaveBeenCalled();
        });
    });

    describe("error paths", () => {
        it("rejects with 'Transaction receipt unavailable' when getTransactionReceipt returns null", async () => {
            const logWithNullReceipt = {
                args: { userOpHash: USER_OP_HASH, sender: SENDER, nonce: 1n, success: true },
                blockNumber: 99,
                getTransactionReceipt: vi.fn(async () => null),
            } as unknown as ReturnType<typeof makeLog>;
            mock.setLookback([logWithNullReceipt]);

            const { promise, listener } = makeListener(mock, 2000);
            listener.start();
            await expect(promise).rejects.toThrow(/Transaction receipt unavailable/);
        });

        it("routes queryFilter errors to wait() rejection", async () => {
            const explosion = new Error("rpc unreachable");
            mock.queryFilter.mockImplementation(async () => {
                throw explosion;
            });

            const { promise, listener } = makeListener(mock, 2000);
            listener.start();
            await expect(promise).rejects.toBe(explosion);
        });
    });

    describe("block-source resolution", () => {
        it("clamps fromBlock to 0 when the chain is shorter than the lookback window", async () => {
            mock.runner.getBlockNumber.mockResolvedValueOnce(3);
            mock.setLookback([]);

            const { promise, listener } = makeListener(mock, 50);
            listener.start();
            await expect(promise).rejects.toThrow(/Timed out/);

            const lookbackCall = mock.queryFilter.mock.calls.find(
                (c) => (c[0] as Filter)._kind === "UserOperationEvent"
            );
            expect(lookbackCall?.[1]).toBe(0);
            expect(lookbackCall?.[2]).toBe("latest");
        });

        it("falls back to runner.provider.getBlockNumber when the runner lacks getBlockNumber", async () => {
            const providerGetBlock = vi.fn(async () => 100);
            const filters = {
                UserOperationEvent: vi.fn(
                    (h: string): Filter => ({ _kind: "UserOperationEvent", userOpHash: h })
                ),
                UserOperationRevertReason: vi.fn(
                    (h: string, s: string): Filter => ({
                        _kind: "UserOperationRevertReason",
                        userOpHash: h,
                        sender: s,
                    })
                ),
            };
            const customEntryPoint = {
                filters,
                once: vi.fn(async () => {}),
                off: vi.fn(async () => {}),
                queryFilter: vi.fn(async () => []),
                runner: { provider: { getBlockNumber: providerGetBlock } },
            } as unknown as never;

            await expect(
                new Promise((resolve, reject) => {
                    const l = new UserOperationEventListener(
                        resolve as never,
                        reject,
                        customEntryPoint,
                        SENDER,
                        USER_OP_HASH,
                        undefined,
                        50
                    );
                    l.start();
                })
            ).rejects.toThrow(/Timed out/);

            expect(providerGetBlock).toHaveBeenCalled();
        });

        it("skips lookback when no block source is available; live event still resolves", async () => {
            let liveListener: LiveListener | null = null;
            const filters = {
                UserOperationEvent: vi.fn(
                    (h: string): Filter => ({ _kind: "UserOperationEvent", userOpHash: h })
                ),
                UserOperationRevertReason: vi.fn(
                    (h: string, s: string): Filter => ({
                        _kind: "UserOperationRevertReason",
                        userOpHash: h,
                        sender: s,
                    })
                ),
            };
            const queryFilter = vi.fn(async () => []);
            const customEntryPoint = {
                filters,
                once: vi.fn(async (_f: Filter, fn: LiveListener) => {
                    liveListener = fn;
                }),
                off: vi.fn(async () => {}),
                queryFilter,
                runner: null,
            } as unknown as never;

            const result = new Promise<{ transactionHash: string }>((resolve, reject) => {
                const l = new UserOperationEventListener(
                    resolve as never,
                    reject,
                    customEntryPoint,
                    SENDER,
                    USER_OP_HASH,
                    undefined,
                    2000
                );
                l.start();
            });

            await vi.waitFor(() => expect(liveListener).not.toBeNull());
            expect(queryFilter).not.toHaveBeenCalled();

            const log = makeLog({
                userOpHash: USER_OP_HASH,
                sender: SENDER,
                nonce: 1n,
                success: true,
            });
            await liveListener!(log, { log });

            const receipt = await result;
            expect(receipt.transactionHash).toBe(USER_OP_HASH);
        });
    });
});
