// The wallet owns all signatures. This module never accepts a private key.
export class WalletError extends Error {
  constructor(message, { code, mayHaveSubmitted = false } = {}) {
    super(message);
    this.code = code;
    this.mayHaveSubmitted = mayHaveSubmitted;
  }
}

export const chainHex = (chainId) => '0x' + BigInt(chainId).toString(16);

export function createWallet(getProvider = () => window.ethereum) {
  const provider = () => {
    const p = getProvider();
    if (!p?.request) throw new WalletError('Open this page in a browser with an Ethereum-compatible wallet, then connect it.');
    return p;
  };
  const request = (method, params = []) => provider().request({ method, params });

  async function context() {
    const [accounts, chainId] = await Promise.all([request('eth_accounts'), request('eth_chainId')]);
    return { account: accounts?.[0]?.toLowerCase() ?? null, chainId: Number(BigInt(chainId)) };
  }

  async function assertContext({ payer, chainId }) {
    const current = await context();
    if (!current.account || current.account !== String(payer).toLowerCase()) throw new WalletError('The connected account changed. Review this invoice again with the wallet that will pay.');
    if (current.chainId !== Number(chainId)) throw new WalletError('The wallet is on another network. Switch to Atlantic Testnet before signing.');
    return current;
  }

  return {
    available: () => Boolean(getProvider()?.request),
    context,
    assertContext,
    async connect() {
      await request('eth_requestAccounts');
      return context();
    },
    async switchNetwork(config) {
      const id = chainHex(config.chainId);
      try { await request('wallet_switchEthereumChain', [{ chainId: id }]); }
      catch (err) {
        if (Number(err.code) !== 4902) throw err;
        await request('wallet_addEthereumChain', [{ chainId: id, chainName: 'Pharos Atlantic Testnet', nativeCurrency: { name: 'PHRS', symbol: 'PHRS', decimals: 18 }, rpcUrls: [config.rpc], blockExplorerUrls: [config.explorer] }]);
        await request('wallet_switchEthereumChain', [{ chainId: id }]);
      }
      return context();
    },
    subscribe(callback) {
      const p = getProvider();
      if (!p?.on) return () => {};
      p.on('accountsChanged', callback);
      p.on('chainChanged', callback);
      return () => { p.removeListener?.('accountsChanged', callback); p.removeListener?.('chainChanged', callback); };
    },
    async send(transaction, { payer, chainId, beforeSubmit }) {
      await assertContext({ payer, chainId });
      if (transaction.from?.toLowerCase() !== payer.toLowerCase()) throw new WalletError('The prepared sender does not match the connected wallet. Review the invoice again.');
      if (transaction.chainId != null && Number(BigInt(transaction.chainId)) !== Number(chainId)) throw new WalletError('The prepared transaction is for another network.');
      const tx = Object.fromEntries(['from', 'to', 'data', 'value', 'gas'].filter((key) => transaction[key] != null).map((key) => [key, transaction[key]]));
      if (!/^0x[0-9a-f]{40}$/i.test(tx.to) || !/^0x(?:[0-9a-f]{2})*$/i.test(tx.data ?? '0x')) throw new WalletError('The prepared transaction is malformed. Nothing was sent.');
      beforeSubmit(); // A durable reservation is required before opening the signature request.
      let hash;
      try { hash = await request('eth_sendTransaction', [tx]); }
      catch (err) {
        const rejected = Number(err.code) === 4001 || /user rejected|user denied/i.test(err.message ?? '');
        throw new WalletError(rejected ? 'You rejected the wallet request. No payment was recorded.' : 'The wallet did not return a transaction hash. The request may have reached the network; check it before trying again.', { code: err.code, mayHaveSubmitted: !rejected });
      }
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new WalletError('The wallet returned no usable transaction hash. Check its activity before trying again.', { mayHaveSubmitted: true });
      return hash;
    },
    async inspectTransaction(hash, { payer, chainId, transaction }) {
      await assertContext({ payer, chainId });
      const [receipt, sent] = await Promise.all([request('eth_getTransactionReceipt', [hash]), request('eth_getTransactionByHash', [hash])]);
      if (!receipt) return { status: 'pending', hash };
      if (!sent || sent.from?.toLowerCase() !== payer.toLowerCase() || sent.to?.toLowerCase() !== transaction.to?.toLowerCase() || (sent.input ?? sent.data ?? '0x').toLowerCase() !== (transaction.data ?? '0x').toLowerCase() || BigInt(sent.value ?? '0x0') !== BigInt(transaction.value ?? '0x0')) return { status: 'mismatch', hash, message: 'This hash does not match the requested transaction.' };
      return { status: BigInt(receipt.status) === 1n ? 'confirmed' : 'reverted', hash, blockNumber: Number(BigInt(receipt.blockNumber)) };
    },
  };
}
