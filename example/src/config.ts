const Config = {
    Environments: {
        Local: {
            Portal: "http://localhost:8080",
            RPC: "https://rpc1.testnet.incentiv.net",
            Contract: "0x99eD6E170C0E1DAbBFF245A26ad9c656Dc69e27f",
        },
        Staging: {
            Portal: "https://staging.incentiv.net",
            RPC: "https://rpc.staging.incentiv.net",
            Contract: "0x2A8d9A070D8eA64EC81BD0F37510700f6B64f784",
        },
        Testnet: {
            Portal: "https://testnet.incentiv.net",
            RPC: "https://rpc1.testnet.incentiv.net",
            Contract: "0x99eD6E170C0E1DAbBFF245A26ad9c656Dc69e27f",
        }
    },
    ABI: [
        {
            "inputs": [],
            "name": "lastSetter",
            "outputs": [
                {
                    "internalType": "address",
                    "name": "",
                    "type": "address"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "inputs": [],
            "name": "storedValue",
            "outputs": [
                {
                    "internalType": "uint256",
                    "name": "",
                    "type": "uint256"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "inputs": [
                {
                    "internalType": "uint256",
                    "name": "_value",
                    "type": "uint256"
                }
            ],
            "name": "setValue",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        }
    ]
    
}

export default Config;