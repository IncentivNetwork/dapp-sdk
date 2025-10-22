const Config = {
    Environments: {
        Local: {
            Portal: "http://localhost:8080",
            RPC: "https://rpc1.testnet.incentiv.net",
            Contract: "0x99eD6E170C0E1DAbBFF245A26ad9c656Dc69e27f",
            EntryPoint: "0xAc822ad1a236B0F2Afcc9c6b3873b864aBE1EdB9",
        },
        Testnet: {
            Portal: "https://testnet.incentiv.io",
            RPC: "https://rpc1.testnet.incentiv.io",
            Contract: "0x14926Cc4A740D3c80D5F3c4c7790F40953f8530b",
            EntryPoint: "0x9b5d240EF1bc8B4930346599cDDFfBD7d7D56db9",
        },
        Mainnet: {
            Portal: "https://portal.incentiv.io",
            RPC: "https://rpc.incentiv.io",
            Contract: "0xfDFA02EeAd0F32D44CeA4763fe72f1f26f1ABff4",
            EntryPoint: "0x3eC61c5633BBD7Afa9144C6610930489736a72d4",
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