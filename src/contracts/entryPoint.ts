import { Contract, type ContractRunner, type InterfaceAbi } from "ethers";

/**
 * Minimal ERC-4337 EntryPoint ABI: only the two events the SDK actually
 * subscribes to (UserOperationEvent + UserOperationRevertReason). Replaces
 * the previous Typechain-generated bindings, which were pinned to ethers v5
 * and shipped ~2.5k LOC of typings the SDK never used.
 */
export const ENTRY_POINT_ABI: InterfaceAbi = [
    {
        anonymous: false,
        inputs: [
            { indexed: true,  internalType: "bytes32", name: "userOpHash",    type: "bytes32" },
            { indexed: true,  internalType: "address", name: "sender",        type: "address" },
            { indexed: true,  internalType: "address", name: "paymaster",     type: "address" },
            { indexed: false, internalType: "uint256", name: "nonce",         type: "uint256" },
            { indexed: false, internalType: "bool",    name: "success",       type: "bool"    },
            { indexed: false, internalType: "uint256", name: "actualGasCost", type: "uint256" },
            { indexed: false, internalType: "uint256", name: "actualGasUsed", type: "uint256" }
        ],
        name: "UserOperationEvent",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true,  internalType: "bytes32", name: "userOpHash",   type: "bytes32" },
            { indexed: true,  internalType: "address", name: "sender",       type: "address" },
            { indexed: false, internalType: "uint256", name: "nonce",        type: "uint256" },
            { indexed: false, internalType: "bytes",   name: "revertReason", type: "bytes"   }
        ],
        name: "UserOperationRevertReason",
        type: "event"
    }
];

export type EntryPoint = Contract;

export function connectEntryPoint(address: string, runner: ContractRunner): EntryPoint {
    return new Contract(address, ENTRY_POINT_ABI, runner);
}
