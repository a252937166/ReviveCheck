// Site chrome: the marketing header with its mega-menus and "Open app", the
// footer, and the helpers every page shares (live heads, chain links, badges).
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUpRight, BookOpen, Braces, Check, ChevronDown, Copy, Database, FileCheck2, Github, Menu, Plug, Radio, Rocket, ScanSearch, ShieldCheck, SquareTerminal, Wallet, Workflow, X } from 'lucide-react';
import { Mark, BuiltOn, short } from './components.jsx';
import { NETWORKS, blockUrl, extrinsicUrl } from '../lib/networks.js';
import { watchNetwork } from './ticker.js';
import { useWallet } from './WalletContext.jsx';

export const REPO = 'https://github.com/a252937166/ReviveCheck';
export const fmt = (value) => value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('en-US');
export const homeHref = () => '#/';

/** The finalized head of one network, kept live over a WebSocket; the explorer index fills in while it connects. */
export function useNetworkHead(key = 'testnet') {
  const [state, setState] = useState({ status: 'connecting', number: null });
  useEffect(() => watchNetwork(NETWORKS[key].substrateRpcUrl, setState, { explorerApi: NETWORKS[key].explorerApi }), [key]);
  return state;
}

// One live testnet head for the whole page: the header chip, the hero and the app share it.
const HeadContext = createContext({ status: 'connecting', number: null });
export function NetworkProvider({ children }) {
  const head = useNetworkHead('testnet');
  return <HeadContext.Provider value={head}>{children}</HeadContext.Provider>;
}
export const useTestnetHead = () => useContext(HeadContext);

const HEAD_TITLE = { live: 'Finalized head, live from the official node', indexed: 'Finalized head from the official explorer index while the node connects', cached: 'The last finalized head this browser saw; refreshing' };
export function NetworkPill({ head, network = NETWORKS.testnet }) {
  const known = Number.isSafeInteger(head.number);
  const body = <><span className={`dot ${known ? head.status : 'idle'}`} aria-hidden="true"/><span className="pill-net">{network.shortName}</span><span className="pill-value">{known ? `#${fmt(head.number)}` : 'syncing'}</span></>;
  if (!known) return <span className="network-pill idle" role="status">{body}</span>;
  return head.hash
    ? <a className={`network-pill ${head.status}`} href={blockUrl(network, head.hash)} target="_blank" rel="noreferrer" title={HEAD_TITLE[head.status]} aria-label={`${network.name} finalized block ${head.number}, open in the official explorer`}>{body}</a>
    : <span className={`network-pill ${head.status}`} title={HEAD_TITLE[head.status]}>{body}</span>;
}

export function WalletButton() {
  const { account, info, openDialog } = useWallet();
  if (!account) return <button type="button" className="btn btn-secondary btn-sm wallet-button" onClick={openDialog} aria-label="Connect wallet"><Wallet size={15} aria-hidden="true"/><span className="wallet-label">Connect wallet</span></button>;
  return <button type="button" className="btn btn-secondary btn-sm wallet-button connected" onClick={openDialog} aria-label={`Wallet connected: ${account.address}. Open wallet details`}>
    <span className={`wallet-kind ${account.kind}`} aria-hidden="true"/>
    <span className="mono">{short(account.address, 11)}</span>
    {info?.available && <span className="wallet-balance">{Number(info.available).toLocaleString('en-US', { maximumFractionDigits: 2 })} {info.symbol}</span>}
  </button>;
}

/** The two mega-menus: where the product lives on the site, and where developers start. */
export const MENUS = {
  product: {
    label: 'Product',
    items: [
      { icon: Database, title: 'Release registry', text: 'Approvals any V3 contract reads', href: '#/product-middleware' },
      { icon: ShieldCheck, title: 'Rules it enforces', text: 'Exact hash, lapse on revision, owner only', href: '#/rules' },
      { icon: FileCheck2, title: 'On-chain evidence', text: 'Sealed reports stored by remark.store', href: '#/product-storage' },
      { icon: Braces, title: 'Verification API', text: 'Both interfaces, one finalized block', href: '#/product-api' },
      { icon: Workflow, title: 'How it works', text: 'Eight stages across two networks', href: '#/lifecycle' },
      { icon: Radio, title: 'Live proof', text: 'Every record, linked to its block', href: '#/activity' },
    ],
    foot: { text: 'Built on Portaldot V3 · recorded on the testnet', link: ['Open the app', '#/app'] },
  },
  developers: {
    label: 'Developers',
    items: [
      { icon: Rocket, title: 'Quickstart', text: 'Clone, test and run in minutes', href: '#/docs/start' },
      { icon: Plug, title: 'MCP server', text: 'Thirteen tools for agents', href: '#/docs/mcp' },
      { icon: Braces, title: 'REST API', text: 'POST /api/tools/<name>', href: '#/docs/rest' },
      { icon: SquareTerminal, title: 'CLI', text: 'npm run rc, from a terminal or CI', href: '#/docs/cli' },
      { icon: BookOpen, title: 'JavaScript', text: 'lib/service.js in Node or the browser', href: '#/docs/js' },
      { icon: ScanSearch, title: 'Contracts', text: 'ReleaseRegistry and the guard, with ABIs', href: '#/docs/registry' },
    ],
    foot: { text: 'Open source · MIT', link: ['GitHub', REPO, true] },
  },
};

function MenuItems({ menu, onPick }) {
  return menu.items.map((item) => <a key={item.title} href={item.href} onClick={onPick}>
    <span className="mega-icon"><item.icon size={18} aria-hidden="true"/></span>
    <span className="mega-text"><strong>{item.title}<ArrowUpRight size={13} aria-hidden="true"/></strong><span className="mega-sub">{item.text}</span></span>
  </a>);
}

export function SiteHeader({ active }) {
  const head = useTestnetHead();
  const [open, setOpen] = useState('');
  const [sheet, setSheet] = useState(false);
  const nav = useRef(null);
  useEffect(() => {
    const close = (event) => { if (event.type === 'keydown' ? event.key === 'Escape' : !nav.current?.contains(event.target)) setOpen(''); };
    addEventListener('keydown', close);
    addEventListener('pointerdown', close);
    const onHash = () => { setOpen(''); setSheet(false); };
    addEventListener('hashchange', onHash);
    return () => { removeEventListener('keydown', close); removeEventListener('pointerdown', close); removeEventListener('hashchange', onHash); };
  }, []);
  useEffect(() => { document.body.style.overflow = sheet ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [sheet]);
  const closeMenus = () => setOpen('');
  return <header className="site-header">
    <div className="site-header-inner">
      <a className="wordmark" href="#/" aria-label="ReviveCheck home"><Mark size={26}/><span>ReviveCheck</span></a>
      <nav className="site-nav" aria-label="Site" ref={nav}>
        {Object.entries(MENUS).map(([id, menu]) => <div key={id} className={`nav-item ${open === id ? 'open' : ''}`} onMouseEnter={() => setOpen(id)} onMouseLeave={() => setOpen((current) => current === id ? '' : current)}>
          <button type="button" className="nav-trigger" aria-expanded={open === id} aria-controls={`menu-${id}`} onClick={() => setOpen(open === id ? '' : id)}>{menu.label}<ChevronDown size={14} aria-hidden="true"/></button>
          <div className="mega" id={`menu-${id}`} role="group" aria-label={menu.label} aria-hidden={open !== id}>
            <MenuItems menu={menu} onPick={closeMenus}/>
            <div className="mega-foot"><span>{menu.foot.text}</span><a href={menu.foot.link[1]} target={menu.foot.link[2] ? '_blank' : undefined} rel={menu.foot.link[2] ? 'noreferrer' : undefined} onClick={closeMenus}>{menu.foot.link[0]}{menu.foot.link[2] ? <ArrowUpRight size={13} aria-hidden="true"/> : <ArrowRight size={13} aria-hidden="true"/>}</a></div>
          </div>
        </div>)}
        <a href="#/docs" aria-current={active === 'docs' ? 'page' : undefined}>Docs</a>
        <a href="#/activity">Proof</a>
      </nav>
      <div className="site-header-end">
        <NetworkPill head={head}/>
        <a href={REPO} target="_blank" rel="noreferrer" className="nav-github" aria-label="GitHub repository"><Github size={17} aria-hidden="true"/></a>
        <a className="btn btn-primary btn-sm header-cta" href="#/app">Open app<ArrowRight size={15} aria-hidden="true"/></a>
        <button type="button" className="icon-button menu-button" aria-expanded={sheet} aria-controls="mobile-menu" aria-label={sheet ? 'Close menu' : 'Open menu'} onClick={() => setSheet(!sheet)}>{sheet ? <X size={20} aria-hidden="true"/> : <Menu size={20} aria-hidden="true"/>}</button>
      </div>
    </div>
    {sheet && createPortal(<div className="mobile-sheet" id="mobile-menu">
      {Object.entries(MENUS).map(([id, menu]) => <div key={id}><h2>{menu.label}</h2><MenuItems menu={menu} onPick={() => setSheet(false)}/></div>)}
      <div className="mobile-actions"><a className="btn btn-primary btn-lg" href="#/app">Open the app<ArrowRight size={16} aria-hidden="true"/></a><a className="btn btn-secondary" href="#/docs">Docs</a><a className="btn btn-ghost" href={REPO} target="_blank" rel="noreferrer"><Github size={16} aria-hidden="true"/>GitHub</a></div>
    </div>, document.body)}
  </header>;
}

export function SiteFooter() {
  const head = useTestnetHead();
  const known = Number.isSafeInteger(head.number);
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="footer-brand">
        <a className="wordmark" href="#/"><Mark size={22}/><span>ReviveCheck</span></a>
        <p>Release approvals your contracts enforce: a registry on Portaldot V3, evidence stored on-chain, and a verification API. A Portaldot Hacker House 2026 build on the V3 testnet; no production guarantee.</p>
        <span className="chip"><span className={`dot ${known ? head.status : 'idle'}`} aria-hidden="true"/>V3 Testnet{known && <> · {head.hash ? <ChainLink hash={head.hash}>#{fmt(head.number)}</ChainLink> : <span className="mono">#{fmt(head.number)}</span>}</>}</span>
      </div>
      <nav className="footer-links" aria-label="Footer">
        <div><h2>Product</h2>{MENUS.product.items.map((item) => <a key={item.title} href={item.href}>{item.title}</a>)}</div>
        <div><h2>Developers</h2><a href="#/docs">Docs</a>{MENUS.developers.items.map((item) => <a key={item.title} href={item.href}>{item.title}</a>)}</div>
        <div><h2>App</h2><a href="#/app">Overview</a><a href="#/app/releases">Releases</a><a href="#/app/tokens">Token list</a><a href="#/app/evidence">Evidence</a><a href="#/app/activity">Activity</a><a href="#/app/run">Run the lifecycle</a><a href="#/review">Report reviewer</a><a href="./api/registry.json" target="_blank" rel="noreferrer">Public feed<ArrowUpRight size={12} aria-hidden="true"/></a></div>
      </nav>
      <div className="footer-base"><BuiltOn/><span>Portaldot and its mark belong to their owners. Not an official Portaldot product.</span><a href={REPO} target="_blank" rel="noreferrer" className="link-arrow" style={{ fontSize: '.8125rem' }}>MIT · Source on GitHub<ArrowUpRight size={13} aria-hidden="true"/></a></div>
    </div>
  </footer>;
}

export function ChainLink({ hash, kind = 'block', network = NETWORKS.testnet, children, length = 14 }) {
  const url = kind === 'block' ? blockUrl(network, hash) : extrinsicUrl(network, hash);
  const label = children ?? short(hash, length);
  return url ? <a className="chain-link" href={url} target="_blank" rel="noreferrer" title={`${kind === 'block' ? 'Block' : 'Extrinsic'} ${hash} on ${network.name}`}>{label}<ArrowUpRight size={12} aria-hidden="true"/></a> : <span className="chain-link pending">{label}</span>;
}

const BADGE = { passed: 'pass', approved: 'pass', reproduced: 'pass', accepted: 'pass', finalized: 'pass', listed: 'pass', failed: 'fail', refused: 'fail', differs: 'fail', 'changes-requested': 'fail', blocked: 'hold', unknown: 'hold', pending: 'hold', partial: 'hold', running: 'run', idle: 'quiet', locked: 'quiet' };
export function Badge({ status, children }) {
  return <span className={`badge ${BADGE[status] || status || 'quiet'}`}><span className="badge-dot" aria-hidden="true"/>{children}</span>;
}

export function CopyButton({ value, label = 'Copy', className = '' }) {
  const [done, setDone] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); } catch { setDone(false); } }
  return <button type="button" className={`copy-button ${className}`} onClick={copy} aria-label={done ? 'Copied' : `${label} to clipboard`}>{done ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}<span>{done ? 'Copied' : label}</span></button>;
}

export function CodeBlock({ code, language = '', title }) {
  return <figure className="code-block">
    <figcaption><span>{title || language}</span><CopyButton value={code}/></figcaption>
    <pre tabIndex={0}><code>{code}</code></pre>
  </figure>;
}

/** Hash routes carry a sub-path: #/docs/check, #/app/run/submit. */
export function useSubRoute(prefix) {
  const read = () => location.hash.startsWith(prefix) ? location.hash.slice(prefix.length).replace(/^\//, '').split(/[?#]/)[0] : '';
  const [value, setValue] = useState(read);
  useEffect(() => { const listen = () => setValue(read()); addEventListener('hashchange', listen); return () => removeEventListener('hashchange', listen); }, []);
  return value;
}
