import React,{useEffect,useMemo,useState} from 'react';
import QRCode from 'qrcode';
import {ExternalLink,Download,LoaderCircle,Clock3,ScanLine,Globe2,ChevronDown} from 'lucide-react';
import {reportExplorerEvidence,explorerQrSvgDataUrl} from '../lib/explorer.js';
import {downloadBlob} from '../lib/share.js';

const targetKinds=new Set(['contract','native-asset-precompile','evm-transaction','native-extrinsic']);
const addressKinds=new Set(['contract','native-asset-precompile']);
const kindNotes={
  contract:'Reported H160 target. Explorer access or a QR does not verify deployment.',
  'native-asset-precompile':'Existing public system precompile. This is not a contract deployed by this project.',
  'evm-transaction':'Ethereum transaction hash. It is distinct from a native extrinsic hash.',
  'native-extrinsic':'Native extrinsic hash. It is distinct from an Ethereum transaction hash.',
};
const kindTitles={contract:'Contract target','native-asset-precompile':'Public asset precompile','evm-transaction':'EVM transaction','native-extrinsic':'Native extrinsic'};
const completeIdentifier=item=>addressKinds.has(item.kind)?/^0x[0-9a-fA-F]{40}$/.test(item.identifier||''):['evm-transaction','native-extrinsic'].includes(item.kind)?/^0x[0-9a-fA-F]{64}$/.test(item.identifier||''):['home','finalized-block'].includes(item.kind);

function dataUrlBlob(dataUrl,type){
  const comma=dataUrl.indexOf(',');
  if(comma<0)throw new Error('The QR image could not be prepared.');
  const header=dataUrl.slice(0,comma),content=dataUrl.slice(comma+1);
  if(header.includes(';base64'))return new Blob([Uint8Array.from(atob(content),char=>char.charCodeAt(0))],{type});
  return new Blob([decodeURIComponent(content)],{type});
}

function TargetEvidence({item}){
  const [svg,setSvg]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const qrKind=item.qrKind||(item.url?'explorer':null);
  const qrValue=item.qrValue||(qrKind==='explorer'?item.url:null);
  const identifierOnly=qrKind==='identifier';
  const qrLabel=identifierOnly?addressKinds.has(item.kind)?'Address only':'Hash only':'Official explorer link';
  useEffect(()=>{
    let alive=true;setSvg('');setError('');setNotice('');
    (async()=>{
      if(!completeIdentifier(item)||!qrValue)throw new Error('A validated address, transaction hash, or official route is required for this QR.');
      if(identifierOnly){
        if(!targetKinds.has(item.kind)||qrValue!==item.identifier)throw new Error('The identifier QR does not match the report target.');
      }
      const data=explorerQrSvgDataUrl(qrValue);
      if(typeof data!=='string'||!data.startsWith('data:image/svg+xml'))throw new Error('This target is not approved for a QR.');
      if(alive)setSvg(data);
    })().catch(e=>alive&&setError(e.message||'This QR is unavailable. Inspect the source evidence.'));
    return()=>{alive=false;};
  },[item.url,item.kind,item.identifier,qrKind,qrValue]);
  async function download(format){
    if(!svg)return;
    setBusy(format);setError('');setNotice('');
    try{
      const identifier=String(item.identifier||item.kind).replace(/[^A-Za-z0-9-]/g,'').slice(0,18);
      const name=`revivecheck-${item.kind}-${identifier}-${qrKind}-qr.${format}`;
      const source=format==='svg'?svg:await QRCode.toDataURL(qrValue,{type:'image/png',width:1024,errorCorrectionLevel:'M',margin:4,color:{dark:'#18357f',light:'#ffffff'}});
      downloadBlob(dataUrlBlob(source,format==='svg'?'image/svg+xml':'image/png'),name);
      setNotice(`${format.toUpperCase()} QR downloaded. Encoded content: ${identifierOnly?'identifier only':'official explorer URL'}.`);
    }catch(e){setError(e.message||'The QR download failed. Copy the full identifier or link instead.');}
    finally{setBusy('');}
  }
  const title=kindTitles[item.kind]||item.label;
  const image=svg?<img src={svg} width="144" height="144" alt={`${qrLabel}: ${qrValue}`}/>:<span className="explorer-qr-unavailable"><ScanLine size={22}/>{error?'QR unavailable':'Preparing QR…'}</span>;
  return <div className={`explorer-target ${item.kind}`}>
    <div className="explorer-target-copy"><div className="explorer-target-heading"><h4>{title}</h4><span>{item.chainLabel}</span></div>{item.identifier&&<code className="explorer-identifier">{item.identifier}</code>}
      {item.url?<a className="explorer-official-url" href={item.url} target="_blank" rel="noreferrer">{item.url}<ExternalLink size={12}/></a>:<p className="explorer-route-pending"><Clock3 size={13}/>Explorer has no verified detail route.</p>}
      {identifierOnly&&<p className="explorer-identifier-note"><strong>{qrLabel}.</strong> The QR contains the exact {addressKinds.has(item.kind)?'H160 address':'transaction hash'} above. It does not open an explorer or initiate a transaction.</p>}
      <p className="explorer-target-note">{kindNotes[item.kind]}{item.scope&&<span>{item.scope}</span>}</p>
      {error&&<p className="explorer-qr-error" role="alert">{error}</p>}{notice&&<p className="explorer-download-notice" role="status">{notice}</p>}
    </div>
    <div className="explorer-qr">{item.url&&!identifierOnly?<a className="explorer-qr-image" href={item.url} target="_blank" rel="noreferrer" aria-label={`Open official explorer for ${title.toLowerCase()} ${item.identifier||''}`}>{image}</a>:<div className="explorer-qr-image">{image}</div>}<span>{qrLabel}</span><div className="explorer-qr-downloads"><button type="button" className="text-button" disabled={!svg||!!busy} onClick={()=>download('svg')} aria-label={`Download SVG QR for ${title.toLowerCase()} ${item.identifier||''}`}>{busy==='svg'?<LoaderCircle className="spin" size={12}/>:<Download size={12}/>}SVG</button><button type="button" className="text-button" disabled={!svg||!!busy} onClick={()=>download('png')} aria-label={`Download PNG QR for ${title.toLowerCase()} ${item.identifier||''}`}>{busy==='png'?<LoaderCircle className="spin" size={12}/>:<Download size={12}/>}PNG</button></div></div>
  </div>;
}

export default function ExplorerEvidence({run}){
  const evidence=useMemo(()=>{try{return reportExplorerEvidence(run);}catch{return {eligible:false,reason:'Explorer targets could not be resolved from this report. Inspect the source evidence.',chainLabel:'Portaldot V3 Testnet',items:[],pending:[]};}},[run]);
  const items=Array.isArray(evidence.items)?evidence.items:[];
  const targets=items.filter(item=>targetKinds.has(item.kind));
  const otherLinks=items.filter(item=>!targetKinds.has(item.kind)&&item.url);
  const pending=(evidence.pending||[]).filter(item=>!targets.some(target=>target.kind===item.kind&&target.qrKind==='identifier'&&target.routeStatus==='unsupported'));
  return <section className="explorer-evidence" aria-label="Official explorer evidence"><div className="explorer-section-heading"><h3><Globe2 size={15}/>Explorer & target identifiers</h3><span>{evidence.chainLabel||'Portaldot V3 Testnet'}</span></div>
    {!evidence.eligible?<p className="explorer-pending"><Clock3 size={14}/><span>{evidence.reason||'Live pinned testnet evidence is required. No explorer or identifier QR is generated for this report.'}</span></p>:<>
      {otherLinks.length>0&&<><div className="explorer-context-links">{otherLinks.map(item=><a key={`${item.kind}-${item.url}`} href={item.url} target="_blank" rel="noreferrer">{item.label}<ExternalLink size={12}/></a>)}</div><details className="explorer-navigation-qr"><summary><ScanLine size={13}/>Explorer navigation QR codes<ChevronDown size={13}/></summary>{otherLinks.map(item=><TargetEvidence key={`${item.kind}-${item.url}`} item={item}/>)}</details></>}
      {targets.map(item=><TargetEvidence key={`${item.kind}-${item.identifier}`} item={item}/>)}
      {pending.map((item,index)=><div className="explorer-pending" key={`${item.kind}-${index}`}><Clock3 size={14}/><div><strong>{item.label||kindTitles[item.kind]||'Evidence pending'}</strong><p>{item.reason||'No verified target is available yet.'}</p></div></div>)}
      <p className="explorer-scope-note">Explorer links open its current view. A working link, QR, or runtime version does not validate this report, transaction outcome, or project ownership.</p>
    </>}
  </section>;
}
