// One connected wallet for the whole site: the header shows it, the studio signs
// with it, the reviewer attests with it.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, LogOut, RefreshCw, X } from 'lucide-react';
import { short } from './components.jsx';
import { NETWORKS } from '../lib/networks.js';

const WalletContext = createContext(null);
export const useWallet = () => useContext(WalletContext);
const wallet = () => import('./wallet.js');

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(async (target = account) => {
    if (!target) return null;
    setInfo((current) => ({ ...(current?.native ? current : {}), loading: true, error: '' }));
    try { const next = await (await wallet()).overview(target); setInfo(next); return next; }
    catch (error) { setInfo({ error: error.message }); return null; }
  }, [account]);
  useEffect(() => { setInfo(null); if (account) refresh(account); }, [account]);
  // An EVM wallet can switch accounts or networks underneath the page.
  useEffect(() => {
    if (account?.kind !== 'evm') return undefined;
    const provider = account.provider;
    const accountsChanged = (accounts) => setAccount(accounts?.[0] ? { ...account, address: accounts[0].toLowerCase() } : null);
    const chainChanged = () => refresh();
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); };
  }, [account]);
  const value = { account, info, refresh, connect: setAccount, disconnect: () => { setAccount(null); setInfo(null); }, openDialog: () => setOpen(true) };
  return <WalletContext.Provider value={value}>{children}{open && <WalletDialog onClose={() => setOpen(false)}/>}</WalletContext.Provider>;
}

function WalletDialog({ onClose }) {
  const { account, info, connect, disconnect, refresh } = useWallet();
  const [state, setState] = useState({});
  const [evmWallets, setEvmWallets] = useState(null);
  const ref = useRef(null);
  const update = (patch) => setState((current) => ({ ...current, ...patch }));
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button, select, a')?.focus();
    const listener = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = [...ref.current.querySelectorAll('button:not(:disabled), select, a[href]')];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    addEventListener('keydown', listener);
    wallet().then((module) => module.discoverEvmWallets()).then(setEvmWallets).catch(() => setEvmWallets([]));
    return () => { removeEventListener('keydown', listener); previous?.focus?.(); };
  }, []);
  async function polkadot() {
    update({ busy: 'polkadot', error: '' });
    try { const accounts = await (await wallet()).polkadotAccounts(); update({ busy: '', accounts }); if (accounts.length === 1) { connect(accounts[0]); onClose(); } }
    catch (error) { update({ busy: '', error: error.message }); }
  }
  async function evm(choice) {
    update({ busy: choice.name, error: '' });
    try { connect(await (await wallet()).connectEvm(choice)); onClose(); }
    catch (error) { update({ busy: '', error: error?.code === 4001 ? 'You declined the request in your wallet.' : error.message }); }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title" ref={ref}>
      <header><h2 id="wallet-title">{account ? 'Your wallet' : 'Connect a wallet'}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header>
      {account ? <div className="wallet-details">
        <dl>
          <div><dt>{account.kind === 'evm' ? `${account.name} · EVM` : `${account.name} · Polkadot`}</dt><dd className="mono">{account.address}</dd></div>
          <div><dt>{account.kind === 'evm' ? 'Native account (fallback)' : 'Mapped EVM address'}</dt><dd className="mono">{info?.loading && !info?.native ? 'Reading…' : account.kind === 'evm' ? info?.native || '—' : info?.evm || '—'}</dd></div>
          <div><dt>Spendable on {NETWORKS.testnet.shortName}</dt><dd className="mono">{info?.available ? `${info.available} ${info.symbol}` : info?.error ? 'Unavailable' : 'Reading…'}</dd></div>
        </dl>
        {info?.error && <p className="form-error" role="alert"><CircleAlert size={14}/>{info.error}</p>}
        <p className="dialog-note">{account.kind === 'evm' ? 'An EVM wallet can submit and approve in the ReleaseRegistry. Signing the review remark needs a Polkadot wallet.' : 'A Polkadot wallet signs every studio step: Revive.call into the registry and System.remark_with_event.'}</p>
        <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={() => refresh()}><RefreshCw size={15}/>Refresh balance</button><button type="button" className="btn btn-secondary" onClick={() => { disconnect(); }}><LogOut size={15}/>Disconnect</button></div>
      </div> : <>
        <p className="dialog-lede">Testnet only. ReviveCheck never sees your keys: each transaction is prepared and dry-run here, and your wallet asks you to sign it.</p>
        <div className="wallet-option">
          <div><h3>Polkadot wallet</h3><p>Polkadot.js, Talisman or SubWallet. Signs every studio step.</p></div>
          {state.accounts?.length > 1 ? <ul className="account-list">{state.accounts.map((item) => <li key={`${item.source}-${item.address}`}><button type="button" onClick={() => { connect(item); onClose(); }}><strong>{item.name}</strong><span className="mono">{short(item.address, 18)}</span><small>{item.source}</small></button></li>)}</ul>
            : <button type="button" className="btn btn-primary" disabled={!!state.busy} onClick={polkadot}>{state.busy === 'polkadot' && <LoaderCircle className="spin" size={15}/>}Connect</button>}
        </div>
        <div className="wallet-option">
          <div><h3>EVM wallet</h3><p>MetaMask or any EIP-1193 wallet, on {NETWORKS.testnet.name} (chain {NETWORKS.testnet.chainId}). Submits and approves in the registry.</p></div>
          {evmWallets === null ? <span className="muted"><LoaderCircle className="spin" size={14}/> Looking…</span> : evmWallets.length ? <div className="evm-wallets">{evmWallets.map((item) => <button type="button" key={item.name + item.rdns} className="btn btn-secondary" disabled={!!state.busy} onClick={() => evm(item)}>{state.busy === item.name ? <LoaderCircle className="spin" size={15}/> : item.icon ? <img src={item.icon} width="16" height="16" alt=""/> : null}{item.name}</button>)}</div> : <span className="muted">None found in this browser</span>}
        </div>
        {state.error && <p className="form-error" role="alert"><CircleAlert size={14}/>{state.error}</p>}
        <p className="dialog-note">Fees and storage deposits come from your own account: a first registry submit holds up to about 7.7 tPOT as a deposit, plus a small fee. Testnet tPOT is handed out by the Portaldot team, through Hacker House registration or a Discord ticket. Reading and checking need no wallet.</p>
      </>}
    </section>
  </div>;
}
