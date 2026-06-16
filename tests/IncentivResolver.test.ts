import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncentivResolver } from "../src/IncentivResolver";

const ENV = "https://testnet.incentiv.io";
const ADDRESS = "0x" + "22".repeat(20);

type MsgListener = (event: unknown) => void;
type FakePopup = { closed: boolean };

/**
 * getAccountAddress() drives a popup + window.postMessage round-trip. Tests run
 * in Node (no jsdom), so we stand up a minimal controllable `window` that lets
 * us capture the registered 'message' listener and fire synthetic events at it.
 */
function installFakeWindow() {
    const messageListeners = new Set<MsgListener>();
    const popups: FakePopup[] = [];
    let popupFactory: () => FakePopup | null = () => ({ closed: false });

    const win = {
        open: vi.fn((_url?: string, _name?: string, _features?: string) => {
            const popup = popupFactory();
            if (popup) popups.push(popup);
            return popup;
        }),
        addEventListener: vi.fn((type: string, fn: MsgListener) => {
            if (type === "message") messageListeners.add(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: MsgListener) => {
            if (type === "message") messageListeners.delete(fn);
        }),
    };

    (globalThis as { window?: unknown }).window = win;

    return {
        win,
        get lastPopup() {
            return popups[popups.length - 1];
        },
        listenerCount: () => messageListeners.size,
        setPopupFactory: (f: () => FakePopup | null) => {
            popupFactory = f;
        },
        // event.source defaults to the popup we just opened (the happy path);
        // pass an explicit `source` to exercise the spoof guard.
        dispatch: (event: { origin: string; data: unknown; source?: unknown }) => {
            const source = Object.prototype.hasOwnProperty.call(event, "source")
                ? event.source
                : popups[popups.length - 1];
            for (const fn of [...messageListeners]) {
                fn({ origin: event.origin, data: event.data, source });
            }
        },
    };
}

function uninstallFakeWindow() {
    delete (globalThis as { window?: unknown }).window;
}

// Resolve to "pending" if `promise` hasn't settled within `ms` (real timers).
async function settleState(promise: Promise<unknown>, ms = 20) {
    return Promise.race([
        promise.then(() => "resolved" as const).catch(() => "rejected" as const),
        new Promise<"pending">((r) => setTimeout(() => r("pending"), ms)),
    ]);
}

describe("IncentivResolver.getAccountAddress", () => {
    let fake: ReturnType<typeof installFakeWindow>;

    beforeEach(() => {
        fake = installFakeWindow();
    });

    afterEach(() => {
        vi.useRealTimers();
        uninstallFakeWindow();
        vi.restoreAllMocks();
    });

    it("resolves with the address from a CONNECT_RESOLVED message and cleans up", async () => {
        const promise = IncentivResolver.getAccountAddress(ENV);

        fake.dispatch({ origin: ENV, data: { type: "CONNECT_RESOLVED", address: ADDRESS } });

        await expect(promise).resolves.toBe(ADDRESS);
        // cleanup() must remove the listener so later messages can't re-trigger it.
        expect(fake.win.removeEventListener).toHaveBeenCalledTimes(1);
        expect(fake.listenerCount()).toBe(0);
    });

    it("resolves to undefined when CONNECT_RESOLVED carries no address (silent-null path)", async () => {
        // Documents the current footgun: a resolved message with a missing/mis-keyed
        // address resolves the promise to undefined instead of surfacing an error.
        const promise = IncentivResolver.getAccountAddress(ENV);

        fake.dispatch({ origin: ENV, data: { type: "CONNECT_RESOLVED" } });

        await expect(promise).resolves.toBeUndefined();
    });

    it("rejects with 'User rejected connection' on a REJECTED message", async () => {
        const promise = IncentivResolver.getAccountAddress(ENV);

        fake.dispatch({ origin: ENV, data: { type: "REJECTED" } });

        await expect(promise).rejects.toThrow(/User rejected connection/);
        expect(fake.listenerCount()).toBe(0);
    });

    it("rejects with 'Popup blocked' when window.open returns null", async () => {
        fake.setPopupFactory(() => null);

        await expect(IncentivResolver.getAccountAddress(ENV)).rejects.toThrow(/Popup blocked/);
        // Bailed out before wiring up the message listener.
        expect(fake.win.addEventListener).not.toHaveBeenCalled();
    });

    it("ignores messages from a foreign origin, then resolves on the matching origin", async () => {
        const promise = IncentivResolver.getAccountAddress(ENV);

        fake.dispatch({
            origin: "https://evil.example",
            data: { type: "CONNECT_RESOLVED", address: "0xevil" },
        });
        expect(await settleState(promise)).toBe("pending");

        fake.dispatch({ origin: ENV, data: { type: "CONNECT_RESOLVED", address: ADDRESS } });
        await expect(promise).resolves.toBe(ADDRESS);
    });

    it("ignores messages whose source is not the popup (spoof guard), then resolves", async () => {
        const promise = IncentivResolver.getAccountAddress(ENV);

        // Correct origin but a different Window (e.g. a same-origin iframe) — must be dropped.
        fake.dispatch({
            origin: ENV,
            source: { closed: false },
            data: { type: "CONNECT_RESOLVED", address: "0xspoof" },
        });
        expect(await settleState(promise)).toBe("pending");

        fake.dispatch({ origin: ENV, data: { type: "CONNECT_RESOLVED", address: ADDRESS } });
        await expect(promise).resolves.toBe(ADDRESS);
    });

    it("rejects with 'Popup closed' when the popup is closed before responding", async () => {
        vi.useFakeTimers();
        const promise = IncentivResolver.getAccountAddress(ENV);

        fake.lastPopup.closed = true;
        vi.advanceTimersByTime(600); // poll interval is 500ms

        await expect(promise).rejects.toThrow(/Popup closed/);
        expect(fake.listenerCount()).toBe(0);
    });

    it("rejects when used outside a browser (no window)", async () => {
        uninstallFakeWindow();

        await expect(IncentivResolver.getAccountAddress(ENV)).rejects.toThrow(
            /must be used in a browser environment/
        );
    });
});
