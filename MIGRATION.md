# Migration guide: `@incentiv/dapp-sdk` 0.1.x → 0.2.0 (ethers v5 → v6)

`0.2.0` drops support for ethers v5 and is a v6-only release. The host app **must** be on `ethers@^6.13.0`.

> If you cannot migrate to ethers v6 yet, stay on `@incentiv/dapp-sdk@^0.1.9`.

---

## What changed

### 1. Peer dependency

`peerDependencies.ethers` is now `^6.13.0`. The compiled JS no longer imports from `@ethersproject/*` or `ethers/lib/utils`, so bundlers on host apps targeting ethers v6 will resolve cleanly.

### 2. `IncentivSigner` is no longer an `ethers.Signer`

In v5 the class extended `ethers.Signer`, which made `new ethers.Contract(addr, abi, signer)` work for write paths. v6's `TransactionResponse` is a class with a fixed set of required fields that an AA pipeline cannot honestly fill in synchronously — pretending to satisfy it would mislead callers.

`0.2.0` makes `IncentivSigner` a standalone class. Use it like this:

```ts
// v5 — no longer works
const contract = new ethers.Contract(addr, abi, signer);
const tx = await contract.setValue(42);

// v6 — encode and send through the signer
import { Interface } from "ethers";
const iface = new Interface(abi);
const data  = iface.encodeFunctionData("setValue", [42]);
const tx    = await signer.sendTransaction({ to: addr, data, value: 0 });
```

Read paths are unchanged — build a regular `new Contract(addr, abi, provider)` for those.

### 3. New return types

`IncentivSigner.sendTransaction()` and `sendBatchTransaction()` now return `IncentivTransactionResponse` (was: faux `TransactionResponse`):

```ts
interface IncentivTransactionResponse {
  hash: string;       // UserOp hash
  from: string;
  to?: string;
  nonce: number;
  gasLimit: bigint;   // was: ethers.BigNumber
  data: string;
  value: bigint;      // was: ethers.BigNumber
  chainId: bigint;    // was: number
  wait: (timeoutMs?: number) => Promise<IncentivTransactionReceipt>;
}
```

`.wait()` now resolves with `IncentivTransactionReceipt` (was: ethers `TransactionReceipt`):

```ts
interface IncentivTransactionReceipt {
  transactionHash: string;   // == UserOp hash, NOT the bundler tx hash
  blockNumber: number;
  blockHash: string;
  status: number;            // 1 on success, 0 on revert
  from: string;
  to: string | null;
}
```

Practical caller diffs:

| v5 | v6 |
|---|---|
| `receipt.transactionHash` | `receipt.transactionHash` (unchanged) |
| `receipt.blockNumber` | `receipt.blockNumber` (unchanged) |
| `tx.gasLimit.toString()` (BigNumber) | `tx.gasLimit.toString()` (bigint — `toString()` still works) |
| `tx.value.eq(0)` | `tx.value === 0n` |

### 4. `EntryPoint` typing

The Typechain-generated `EntryPoint` bindings (`src/contracts/EntryPoint*.ts`, ~2.5k LOC) were pinned to ethers v5 and exposed a huge typed surface the SDK never used. They are replaced by a minimal hand-rolled module:

- `src/contracts/entryPoint.ts` exports `ENTRY_POINT_ABI` (the two events the SDK listens for) and a `connectEntryPoint(addr, runner)` helper that returns a v6 `Contract`.
- `EntryPoint` is now `type EntryPoint = Contract`.

If you previously imported `EntryPoint` or `EntryPoint__factory` from this package, you'll need to remove those imports — they were never officially part of the public API (the package's `index.ts` did not re-export them), but they may have been pulled in via deep paths.

### 5. TypeScript target

`tsconfig.json` `target` was bumped from `es2017` → `es2020` so the SDK can use `bigint` literals (`0n`, `60_000`). Consumer apps targeting ES2019 or older will need to update their target to ES2020.

---

## Quick reference: v5 → v6 idiom cheat-sheet

These are the only changes you'll typically need in code that interacted with the SDK.

| v5 | v6 |
|---|---|
| `new ethers.providers.StaticJsonRpcProvider(url)` | `new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true })` |
| `ethers.providers.Provider` (type) | `ethers.Provider` |
| `ethers.utils.parseEther(x)` | `ethers.parseEther(x)` |
| `ethers.utils.formatEther(x)` | `ethers.formatEther(x)` |
| `ethers.utils.parseUnits(x, d)` | `ethers.parseUnits(x, d)` |
| `ethers.utils.formatUnits(x, d)` | `ethers.formatUnits(x, d)` |
| `ethers.utils.isAddress(x)` | `ethers.isAddress(x)` |
| `ethers.utils.arrayify(x)` | `ethers.getBytes(x)` |
| `ethers.utils.hexlify(x)` | `ethers.hexlify(x)` |
| `ethers.utils.toUtf8Bytes(x)` | `ethers.toUtf8Bytes(x)` |
| `ethers.utils.toUtf8String(x)` | `ethers.toUtf8String(x)` |
| `ethers.utils.defaultAbiCoder` | `ethers.AbiCoder.defaultAbiCoder()` |
| `ethers.BigNumber.from(x)` | `ethers.getBigInt(x)` (or native `BigInt(x)`) |
| `contract.callStatic.method(args)` | `contract.method.staticCall(args)` |
| `contract.address` | `await contract.getAddress()` |
| `provider.removeListener(event, fn)` | `provider.off(event, fn)` |

For the official ethers v6 migration guide, see <https://docs.ethers.org/v6/migrating/>.
