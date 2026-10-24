import React, {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {Share2, Copy, Download, QrCode, ExternalLink, LoaderCircle, CircleAlert} from 'lucide-react';
import {makeShareLink, downloadBlob, downloadJson} from '../lib/share.js';

export default function SharePanel({run,onPrepared}) {
  const [share,setShare]=useState(null),[svg,setSvg]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{let alive=true;setShare(null);setSvg('');setError('');setNotice('');makeShareLink(run).then(async result=>{const code=await QRCode.toString(result.qrUrl,{type:'svg',errorCorrectionLevel:'M',margin:4,width:256,color:{dark:'#0f1428',light:'#ffffff'}});if(alive){setShare(result);setSvg(code);}}).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[run]);
  async function copy(){try{await navigator.clipboard.writeText(share.url);setNotice('Full report link copied. The recipient can verify it without your local server.');onPrepared?.(share.published?{method:'public-url',url:share.url}:{method:'fragment'});}catch{setNotice('Clipboard unavailable. Select and copy the full link below.');}}
  function exportReport(){downloadJson(run,`revivecheck-${run.id}.json`);onPrepared?.({method:'json'});setNotice('Original JSON downloaded. Send it with the viewer link.');}
  return <section className="share-panel panel" id="share"><div className="panel-heading"><h2><Share2 size={18}/> Share this exact report</h2><span className="section-index">03</span></div><p className="section-description">The recipient verifies the report in their browser. Names, addresses, results, and source evidence are included; share public information only.</p>
    {error?<div className="inline-error" role="alert"><CircleAlert size={17}/>{error}</div>:!share?<div className="inline-loading" role="status"><LoaderCircle className="spin" size={17}/> Preparing a verifiable link…</div>:<div className="share-content"><div className="share-copy">
      <label>{share.url?'Complete report link':'Public review viewer'}<textarea readOnly rows={3} value={share.url || share.qrUrl} onFocus={event=>event.target.select()} aria-label={share.url?'Complete compressed report link':'Public review viewer link'}/></label>
      <div className="button-row">{share.url?<button className="button primary" onClick={copy}><Copy size={15}/>Copy report link</button>:<a className="button primary" href={share.qrUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Open viewer</a>}<button className="button secondary" onClick={exportReport}><Download size={15}/>Report JSON</button></div>
      <p className="help-text">{share.published?'This exact report was read back from the public evidence site and its fingerprint verified. The short link opens it directly.':share.requiresFile?'This report exceeds the safe link size. Send the original JSON with the viewer link.':'The compressed report stays in the URL fragment. The viewer needs no backend, login, or local workspace.'}</p>
      {!share.qrIncludesReport && <p className="qr-note"><CircleAlert size={15}/>The QR opens a fingerprint-bound viewer. The full report is too long for a reliable QR: the recipient must import the matching JSON.</p>}
      {notice && <p className="inline-success" role="status">{notice}</p>}
    </div><div className="qr-block"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} width="176" height="176" alt={share.qrIncludesReport?'QR code containing this verified report link':'QR code for the public viewer; matching report JSON required'}/><span>{share.qrIncludesReport?'Scan to open this report':'Scan viewer + import JSON'}</span><button className="text-button" onClick={()=>downloadBlob(new Blob([svg],{type:'image/svg+xml'}),`revivecheck-${run.id}-qr.svg`)}><QrCode size={14}/>Download QR SVG</button></div></div>}
  </section>;
}
