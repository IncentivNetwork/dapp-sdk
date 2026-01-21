import { useEffect, useRef, useState } from 'react';
import { IncentivResolver, IncentivSigner, type SignResponse } from '@incentiv/dapp-sdk';
import { Modal, type ModalData } from './components/Modal';
import { ethers } from 'ethers';
import Config from './config';

function App() {
  // Specify the environment to use
  const Environment = Config.Environments.Mainnet;

  const [isConnecting, setIsConnecting] = useState(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [currentValue, setCurrentValue] = useState<string>('Not set');
  const [lastSetter, setLastSetter] = useState<string>('Not set');
  const [newValue, setNewValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [modalData, setModalData] = useState<ModalData | null>(null);
  
  // Tabs and signing state
  const [activeTab, setActiveTab] = useState<'transaction' | 'sign'>('transaction');
  const [messageToSign, setMessageToSign] = useState<string>('');
  const [isSigningMessage, setIsSigningMessage] = useState(false);
  const [signatureResult, setSignatureResult] = useState<SignResponse | null>(null);

  const providerRef = useRef<ethers.providers.Provider | null>(null);
  const signerRef = useRef<IncentivSigner | null>(null);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');

    // Request account address from SDK
    IncentivResolver
      .getAccountAddress(Environment.Portal)
      .then((address) => {
        setUserAddress(address);
        setIsConnecting(false);

        // Create a regular ethers provider
        providerRef.current = new ethers.providers.StaticJsonRpcProvider(Environment.RPC);

        // Create a signer that can sign transactions with the Incentiv portal
        signerRef.current = new IncentivSigner({
          address: address,
          provider: providerRef.current,
          environment: Environment.Portal,
          entryPoint: Environment.EntryPoint
        });

        handleFetchData();
      })
      .catch((err) => {
        setIsConnecting(false);
        setError(`Failed to connect wallet. ${err}`);
      });
  };

  const handleFetchData = async () => {
    if (!signerRef.current) return;

    const contract = new ethers.Contract(
      Environment.Contract,
      Config.ABI,
      signerRef.current
    );

    const value = await contract.storedValue();
    setCurrentValue(value.toString());

    const lastSetter = await contract.lastSetter();
    setLastSetter(lastSetter);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!signerRef.current) return;
    
    setIsLoading(true);

    // Send transaction! This will request a popup to be opened in the Incentiv portal.
    const contract = new ethers.Contract(
      Environment.Contract,
      Config.ABI,
      signerRef.current
    );

    try {
      const tx = await contract.setValue(newValue);
      await tx.wait();
      setNewValue('');
      setModalData({
        title: 'Transaction Sent!',
        message: 'Your transaction has been sent successfully. Please wait for the data to be updated on the next conirmed block!',
        isSuccess: true
      });
    } catch (err) {
      setModalData({
        title: 'Transaction Failed!',
        message: `Your transaction has failed. ${err}`,
        isSuccess: false
      });
    }
    finally {
      setIsLoading(false);
    }
  };

  const handleSignMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSignatureResult(null);
    
    if (!signerRef.current || !messageToSign.trim()) return;
    
    setIsSigningMessage(true);

    try {
      const response = await signerRef.current.signMessageDetailed(messageToSign);
      setSignatureResult(response);
      setModalData({
        title: 'Message Signed!',
        message: 'Your message has been signed successfully.',
        isSuccess: true
      });
    } catch (err) {
      setModalData({
        title: 'Signing Failed!',
        message: `Failed to sign message: ${err}`,
        isSuccess: false
      });
    } finally {
      setIsSigningMessage(false);
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  useEffect(() => {
    providerRef.current?.on('block', () => {
      handleFetchData();
    });

    return () => {
      providerRef.current?.removeListener('block', () => {});
    };
  }, [providerRef.current]);

  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-screen w-screen bg-gray-50 p-4">
        <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-lg shadow-md">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Incentiv dApp SDK Example</h1>
            <p className="text-sm text-gray-500">Interact with on-chain state</p>
          </div>

          <div className="space-y-4 mt-8">
            {/* Connection Status */}
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-500">
                {userAddress ? (
                  <span>Connected: <span className="font-mono">{formatAddress(userAddress)}</span></span>
                ) : (
                  'Not connected'
                )}
              </div>
              <button
                onClick={handleConnect}
                disabled={isConnecting || !!userAddress}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  userAddress
                    ? 'bg-green-100 text-green-800 cursor-default'
                    : isConnecting
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {userAddress ? 'Connected' : isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            </div>

            {userAddress ? (
              <>
                {/* Tabs */}
                <div className="border-b border-gray-200">
                  <nav className="-mb-px flex space-x-8">
                    <button
                      onClick={() => {
                        setActiveTab('transaction');
                        setError('');
                      }}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTab === 'transaction'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      Send Transaction
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('sign');
                        setError('');
                        setSignatureResult(null);
                      }}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTab === 'sign'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      Sign Message
                    </button>
                  </nav>
                </div>

                {activeTab === 'transaction' ? (
                  <>
                    {/* Current State Display */}
                    <div className="bg-gray-50 p-4 rounded-md">
                      <h2 className="text-lg font-semibold text-gray-700 mb-2">Current State</h2>
                      <div className="space-y-2">
                        <div>
                          <span className="text-sm text-gray-500">Current Value:</span>
                          <span className="ml-2 text-gray-800 font-mono">{currentValue}</span>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">Last Setter:</span>
                          <span className="ml-2 text-gray-800 font-mono break-all">
                            {ethers.utils.isAddress(lastSetter) ? formatAddress(lastSetter) : lastSetter}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Value Setting Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div>
                        <label htmlFor="newValue" className="block text-sm font-medium text-gray-700">
                          Set New Value
                        </label>
                        <div className="mt-1">
                          <input
                            type="number"
                            id="newValue"
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-800 px-4 py-2 sm:text-sm"
                            placeholder="Enter a number"
                            required
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isLoading}
                        className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                          isLoading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
                        } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
                      >
                        {isLoading ? 'Setting Value...' : 'Set Value'}
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    {/* Sign Message Form */}
                    <form onSubmit={handleSignMessage} className="space-y-4">
                      <div>
                        <label htmlFor="messageToSign" className="block text-sm font-medium text-gray-700">
                          Message to Sign
                        </label>
                        <div className="mt-1">
                          <textarea
                            id="messageToSign"
                            rows={4}
                            value={messageToSign}
                            onChange={(e) => setMessageToSign(e.target.value)}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-800 px-4 py-2 sm:text-sm"
                            placeholder="Enter your message here..."
                            required
                          />
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          This message will be signed using your Incentiv wallet.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={isSigningMessage || !messageToSign.trim()}
                        className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                          isSigningMessage || !messageToSign.trim() 
                            ? 'bg-blue-400' 
                            : 'bg-blue-600 hover:bg-blue-700'
                        } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
                      >
                        {isSigningMessage ? 'Signing Message...' : 'Sign Message'}
                      </button>
                    </form>

                    {/* Signature Result */}
                    {signatureResult && (
                      <div className="bg-green-50 p-4 rounded-md">
                        <h3 className="text-sm font-medium text-green-800 mb-2">Signature Result</h3>
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs font-medium text-green-800">Payload:</label>
                            <div className="text-xs text-green-700 font-mono bg-white p-2 rounded border break-all">
                              {signatureResult.payload}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-green-800">Signature:</label>
                            <div className="text-xs text-green-700 font-mono bg-white p-2 rounded border break-all">
                              {signatureResult.signature}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-green-800">Owner:</label>
                            <div className="text-xs text-green-700 font-mono bg-white p-2 rounded border break-all">
                              {signatureResult.owner}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex space-x-2">
                          <button
                            onClick={() => navigator.clipboard.writeText(signatureResult.signature)}
                            className="text-xs text-green-600 hover:text-green-800 underline"
                          >
                            Copy Signature
                          </button>
                          <button
                            onClick={() => navigator.clipboard.writeText(JSON.stringify(signatureResult, null, 2))}
                            className="text-xs text-green-600 hover:text-green-800 underline"
                          >
                            Copy Full Response
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="text-center text-sm text-gray-500 py-4">
                Connect your wallet to interact with the contract
              </div>
            )}

            {error && (
              <div className="text-red-600 text-sm text-center">{error}</div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={modalData !== null} 
        onClose={() => setModalData(null)} 
        title={modalData?.title ?? ''}
        message={modalData?.message ?? ''}
        isSuccess={modalData?.isSuccess ?? false}
      />
    </>
  );
}

export default App;
