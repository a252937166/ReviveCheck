import React, { useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle, PenLine, ShieldCheck, Wallet } from 'lucide-react';
import { short } from './components.jsx';
import { Badge, ChainLink, CopyButton, fmt } from './site.jsx';
import { useWallet } from './WalletContext.jsx';
import { NETWORKS } from '../lib/networks.js';

// Record a reviewer decision as System.remark_with_event from the connected
// Polkadot wallet, or verify one signed elsewhere. The page never handles keys.
export default function AttestPanel({ reportHash, decision = 'accepted', heading = 'Record your decision on-chain' }) {
  const { account, openDialog } = useWallet();
  const [state, setState] = useState({});
  const [hashInput, setHashInput] = useState('');
  const update = (patch) => setState((current) => ({ ...current, ...patch }));
  const remark = /^[a-f0-9]{64}$/.test(reportHash || '') ? `revivecheck:1:review:${decision}:${reportHash}` : '';
  useEffect(() => { setState({}); }, [reportHash, decision]);
  useEffect(() => {
    if (!remark || account?.kind !== 'polkadot') return;
    import('./wallet.js').then((module) => module.nativeFee(account, { action: 'remark', remark })).then((fee) => update({ fee })).catch(() => {});
  }, [remark, account?.address]);
  async function sign() {
    update({ status: 'signing', error: '', stage: 'signing' });
    try {
      const signed = await (await import('./wallet.js')).sendRemark(account, remark, ({ stage }) => update({ stage }));
      const { verifyAttestation } = await import('./engine.js');
      const result = await verifyAttestation(signed);
      update({ status: result.verified ? 'done' : 'error', result, error: result.verified ? '' : result.reasons.join(' ') });
    } catch (error) { update({ status: 'error', error: error.message }); }
  }
  async function verifyPasted(event) {
    event.preventDefault();
    update({ status: 'verifying', error: '' });
    const { verifyAttestation } = await import('./engine.js');
    const result = await verifyAttestation({ extrinsicHash: hashInput.trim() }).catch((error) => ({ verified: false, reasons: [error.message] }));
    if (result.verified && result.reportHash !== reportHash) update({ status: 'error', result: null, error: `That remark attests report ${short(result.reportHash, 14)}, not this one.` });
    else update({ status: result.verified ? 'done' : 'error', result: result.verified ? result : null, error: result.verified ? '' : result.reasons.join(' ') });
  }
  const { result } = state;
  const signing = state.status === 'signing';
  const stageText = { signing: 'Waiting for your wallet…', submitted: 'Submitted…', 'in-block': 'In a block; waiting for finality…' }[state.stage] || 'Signing…';
  return <div className="own-attestation">
    <h3>{heading}</h3>
    <p className="sheet-note">Sign one <code>system.remark_with_event</code> on the {NETWORKS.testnet.shortName}. The chain authenticates your account, and the remark binds your decision to this exact report hash.</p>
    <div className="remark-preview"><code>{remark || 'A sealed report hash is needed first.'}</code>{remark && <CopyButton value={remark}/>}</div>
    <div className="button-pair">
      {account?.kind === 'polkadot'
        ? <button type="button" className="btn btn-primary btn-sm" disabled={!remark || signing} onClick={sign}>{signing ? <LoaderCircle className="spin" size={14}/> : <PenLine size={14}/>}{signing ? stageText : 'Sign the remark'}</button>
        : <button type="button" className="btn btn-primary btn-sm" disabled={!remark} onClick={openDialog}><Wallet size={14}/>{account ? 'Connect a Polkadot wallet' : 'Connect wallet'}</button>}
      {state.fee && <span className="muted">Fee about {(Number(state.fee) / 1e14).toFixed(4)} tPOT</span>}
    </div>
    <form className="paste-verify" onSubmit={verifyPasted}><label htmlFor={`extrinsic-${reportHash}`}>Signed elsewhere, for example in Polkadot.js Apps? Paste the extrinsic hash</label><div><input id={`extrinsic-${reportHash}`} value={hashInput} onChange={(event) => setHashInput(event.target.value)} placeholder="0x… (64 hex characters)" spellCheck="false" autoComplete="off"/><button type="submit" className="btn btn-secondary btn-sm" disabled={!/^0x[0-9a-fA-F]{64}$/.test(hashInput.trim()) || state.status === 'verifying'}>{state.status === 'verifying' ? <LoaderCircle className="spin" size={14}/> : <ShieldCheck size={14}/>}Verify</button></div></form>
    {state.error && <p className="form-error" role="alert"><CircleAlert size={14}/>{state.error}</p>}
    {result?.verified && <div className="attested" role="status"><Badge status="passed">On-chain</Badge><p><strong>{result.decision === 'accepted' ? 'Accepted' : 'Changes requested'}</strong> by <code>{short(result.reviewer, 16)}</code>{result.identity ? ` (${result.identity})` : ''} for report <code>{short(result.reportHash, 14)}</code>, finalized in block #{fmt(result.blockNumber)}. <ChainLink hash={result.extrinsicHash} kind="extrinsic">View the extrinsic</ChainLink></p></div>}
  </div>;
}
