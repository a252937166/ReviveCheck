// Integration docs: how to reach each capability from an agent, an app, a
// terminal or the chain itself. One long page, so search and scroll both work.
import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { CodeBlock, useSubRoute } from './site.jsx';
import { SETUP, PRODUCTS, FEATURES, REFERENCE } from './docs-content.js';
import { STAGE_ICONS } from './Lifecycle.jsx';

const TOOLS = [
  ['network_status', 'Finalized head, runtime and identity of either network', 'network'],
  ['check_release', 'Check a release at one finalized block and seal a report', 'release | plan, previousReportHash'],
  ['get_report', 'Load a report by hash and verify its SHA-256', 'reportHash | report'],
  ['replay_report', 'Re-read a report at its pinned block', 'reportHash | report'],
  ['compare_reports', 'Compare two reports of one target', 'baselineHash, candidateHash'],
  ['retrieve_evidence', 'Retrieve a report stored through remark.store and verify both hashes', 'extrinsicHash, blockHash, expectedHash'],
  ['assess_promotion', 'Ask V3 Live whether a passed report can stand', 'reportHash | report'],
  ['read_registry', 'Read a release and a decision through both interfaces', 'releaseId | owner + label, reviewer'],
  ['token_list_status', 'Read a token’s listing in the VerifiedTokenList through both interfaces', 'token'],
  ['list_releases', 'The public feed: releases, decisions, listings and stored reports', 'owner, label'],
  ['prepare_transaction', 'Build and dry-run a submit, review, list, store or remark, unsigned', 'action, reportHash, label, releaseId, approved, decision, token, reviewer, decimals, from'],
  ['verify_attestation', 'Verify a review remark from chain data', 'extrinsicHash, blockHash'],
];

export function Tabs({ tabs, id }) {
  const names = Object.keys(tabs);
  const [tab, setTab] = useState(names[0]);
  return <div className="doc-tabs">
    <div className="tabs" role="tablist" aria-label="Integration">{names.map((name) => <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel`} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}><CodeBlock code={tabs[tab]} title={tab === 'MCP' ? 'Tool and arguments' : tab}/></div>
  </div>;
}

function Feature({ feature }) {
  const Icon = STAGE_ICONS[feature.id === 'attest' ? 'approve' : feature.id === 'reports' ? 'replay' : feature.id];
  return <section className="doc-section" id={`doc-${feature.id}`} aria-labelledby={`h-${feature.id}`}>
    <div className="doc-title">{Icon && <span className="stage-icon"><Icon size={16} aria-hidden="true"/></span>}<h2 id={`h-${feature.id}`}>{feature.title}</h2><code className="tool-name">{feature.tool}</code></div>
    <p className="doc-lede">{feature.summary}</p>
    <dl className="doc-facts">
      <div><dt>Needs</dt><dd><ul>{feature.needs.map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
      <div><dt>Shows</dt><dd>{feature.shows}</dd></div>
      <div><dt>Does not show</dt><dd>{feature.limits}</dd></div>
    </dl>
    <Tabs tabs={feature.tabs} id={feature.id}/>
    <details className="doc-output"><summary>Example result</summary><CodeBlock code={feature.output} title="JSON, trimmed"/></details>
    {['check', 'recheck', 'store', 'submit', 'approve', 'consume', 'promote', 'watch'].includes(feature.id) && <a className="text-link" href={`#/app/run/${feature.id}`}>Try it in the studio<ArrowRight size={14} aria-hidden="true"/></a>}
  </section>;
}

export default function Docs() {
  const route = useSubRoute('#/docs');
  const [current, setCurrent] = useState(route || 'start');
  useEffect(() => {
    if (!route) { window.scrollTo({ top: 0 }); return; }
    const target = document.getElementById(`doc-${route}`);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    setCurrent(route);
  }, [route]);
  // The current section is the last one whose top has passed just under the sticky header.
  useEffect(() => {
    let frame = 0;
    const sections = [...document.querySelectorAll('.doc-section')];
    const update = () => {
      frame = 0;
      let active = sections[0];
      for (const section of sections) if (section.getBoundingClientRect().top <= 170) active = section;
      if (active) setCurrent(active.id.replace('doc-', ''));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);
  const groups = [['Get started', SETUP.map(({ id, title }) => [id, title])], ['Products', PRODUCTS.map(({ id, title }) => [id, title.split(':')[0]])], ['Capabilities', FEATURES.map(({ id, title }) => [id, title])], ['Reference', [['tools', 'Tool reference'], ['registry', 'ReleaseRegistry'], ['tokenlist', 'VerifiedTokenList'], ['networks', 'Networks']]]];
  return <main className="docs" id="main">
    <aside className="docs-nav" aria-label="Docs">
      {groups.map(([title, items]) => <div key={title}><h2>{title}</h2><ul>{items.map(([id, label]) => <li key={id}><a href={`#/docs/${id}`} aria-current={current === id ? 'location' : undefined}>{label}</a></li>)}</ul></div>)}
    </aside>
    <label className="docs-jump"><span>Jump to</span><select value={current} onChange={(event) => { location.hash = `#/docs/${event.target.value}`; }}>{groups.map(([title, items]) => <optgroup key={title} label={title}>{items.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}</select></label>
    <article className="docs-body">
      <header className="docs-head"><h1>Integrate ReviveCheck</h1><p>Three components built on Portaldot V3’s modules: a registry your contracts read, evidence stored on-chain, and a verification API for agents, apps and CI. Each section names what it needs, what it shows and what it does not.</p></header>
      {[...SETUP, ...PRODUCTS].map((section) => <section className="doc-section" id={`doc-${section.id}`} key={section.id} aria-labelledby={`h-${section.id}`}>
        <div className="doc-title"><h2 id={`h-${section.id}`}>{section.title}</h2></div>
        {section.body.map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>)}
        {section.rows && <dl className="kv-list">{section.rows.map(([label, value]) => <div className="kv" key={label}><dt>{label}</dt><dd className="mono small">{value}</dd></div>)}</dl>}
        {section.code.map((block) => <CodeBlock key={block.title} code={block.code} title={block.title}/>)}
      </section>)}
      {FEATURES.map((feature) => <Feature key={feature.id} feature={feature}/>)}
      <section className="doc-section" id="doc-tools" aria-labelledby="h-tools">
        <div className="doc-title"><h2 id="h-tools">Tool reference</h2></div>
        <p>The same twelve tools over MCP, <code>POST /api/tools/&lt;name&gt;</code> and <code>npm run rc -- &lt;name&gt;</code>. All are read-only.</p>
        <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Tool</th><th scope="col">What it does</th><th scope="col">Arguments</th></tr></thead><tbody>{TOOLS.map(([name, what, args]) => <tr key={name}><th scope="row"><code>{name}</code></th><td>{what}</td><td className="mono small">{args}</td></tr>)}</tbody></table></div>
      </section>
      {['registry', 'tokenlist', 'networks'].map((id) => <section className="doc-section" id={`doc-${id}`} key={id} aria-labelledby={`h-${id}`}>
        <div className="doc-title"><h2 id={`h-${id}`}>{REFERENCE[id].title}</h2></div>
        <dl className="kv-list">{REFERENCE[id].rows.map(([label, value]) => <div className="kv" key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>)}</dl>
        {REFERENCE[id].code && <CodeBlock code={REFERENCE[id].code} title="ABI"/>}
      </section>)}
    </article>
  </main>;
}
