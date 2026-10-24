// Routes: the marketing site (landing, docs), the app (dashboard pages, the
// lifecycle run, the reviewer, the local workbench), all over hash routes so
// the static build serves every page from one index.html.
import React, { useEffect, useState } from 'react';
import Review from './Review.jsx';
import Landing from './Landing.jsx';
import Docs from './Docs.jsx';
import Dashboard, { AppShell } from './Dashboard.jsx';
import { SiteHeader, SiteFooter, NetworkProvider } from './site.jsx';
import { WalletProvider } from './WalletContext.jsx';

const TITLES = { app: 'App · ReviveCheck', docs: 'Docs · ReviveCheck', review: 'Report reviewer · ReviveCheck' };
const DEFAULT_TITLE = 'ReviveCheck · Release approvals your contracts enforce, on Portaldot V3';

function Site({ active, children }) {
  return <div className="site"><a className="skip-link" href="#main">Skip to content</a><SiteHeader active={active}/>{children}<SiteFooter/></div>;
}

export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const listen = () => setHash(location.hash); addEventListener('hashchange', listen); return () => removeEventListener('hashchange', listen); }, []);
  // The studio's earlier address keeps working.
  useEffect(() => { if (location.hash.startsWith('#/try')) location.replace(`#/app/run${location.hash.slice(5)}`); }, [hash]);
  const route = (hash.split('/')[1] || '').split('?')[0];
  useEffect(() => { document.title = TITLES[route] || DEFAULT_TITLE; }, [route]);
  const reportLink = new URLSearchParams(location.search).has('report');
  let page = null;
  if (hash.startsWith('#/review') || reportLink) page = <AppShell page="review" bare><Review hash={hash}/></AppShell>;
  else if (hash.startsWith('#/try')) page = null;
  else if (hash.startsWith('#/app')) page = <Dashboard/>;
  else if (hash.startsWith('#/docs')) page = <Site active="docs"><Docs/></Site>;
  else page = <Site active=""><Landing/></Site>;
  return <NetworkProvider><WalletProvider>{page}</WalletProvider></NetworkProvider>;
}
