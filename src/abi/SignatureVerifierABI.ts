const SignatureVerifierABI = [
    {
        inputs: [
            { internalType: "bytes", name: "owner", type: "bytes" },
            { internalType: "bytes", name: "message", type: "bytes" },
            { internalType: "bytes", name: "signature", type: "bytes" }
        ],
        name: "verifySignature",
        outputs: [
            { internalType: "bool", name: "isValid", type: "bool" },
            { internalType: "address", name: "accountAddress", type: "address" }
        ],
        stateMutability: "view",
        type: "function"
    }
]

export default SignatureVerifierABI;