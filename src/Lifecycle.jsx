// The lifecycle diagram: seven stages on one track across two networks, with the
// loop back to Check. The landing drives it from the recorded run; the studio
// drives the same track from the visitor's own run.
import React from 'react';
import { Activity, BadgeCheck, Database, FileUp, GitCompareArrows, Globe, History, Plug, ScanSearch } from 'lucide-react';
import { STAGES, LANES } from './stages.js';
import { Badge } from './site.jsx';

export const STAGE_ICONS = { check: ScanSearch, recheck: GitCompareArrows, replay: History, store: Database, submit: FileUp, approve: BadgeCheck, consume: Plug, promote: Globe, watch: Activity };
const TESTNET_SPAN = STAGES.filter((stage) => stage.lane === 'testnet').length;

/**
 * state: stage id → { status, label, detail } where detail is a short reference line.
 * reached: how many stages, in order, the run has reached; their connectors fill.
 */
export default function Lifecycle({ state = {}, reached = STAGES.length, selected, onSelect, running = -1, compact = false, label = 'Release lifecycle' }) {
  return <div className={`pipeline ${compact ? 'compact' : ''}`} style={{ '--stages': STAGES.length }}>
    <div className="pipeline-lanes" aria-hidden="true">
      <span className="lane testnet" style={{ gridColumn: `1 / span ${TESTNET_SPAN}` }}>{LANES.testnet}<i>native + EVM</i></span>
      <span className="lane live" style={{ gridColumn: `${TESTNET_SPAN + 1} / span 1` }}>{LANES.live}</span>
      <span className="lane both" style={{ gridColumn: `${TESTNET_SPAN + 2} / span 1` }}>{LANES.both}</span>
    </div>
    <ol className="pipeline-track" aria-label={label}>
      {STAGES.map((stage, index) => {
        const Icon = STAGE_ICONS[stage.id];
        const entry = state[stage.id] || {};
        const isRunning = running === index;
        const isReached = index < reached;
        const status = isRunning ? 'running' : isReached ? entry.status || 'idle' : 'pending';
        return <li key={stage.id} className={`stage ${stage.lane} ${isReached ? 'reached' : ''} ${isRunning ? 'running' : ''} ${selected === stage.id ? 'selected' : ''}`} data-status={status}>
          <button type="button" className="stage-node" onClick={() => onSelect?.(stage.id)} aria-pressed={selected === stage.id} aria-label={`${stage.name}: ${stage.summary}. ${isReached && entry.label ? entry.label : ''}`}>
            <span className="stage-top"><span className={`stage-icon ${stage.kind}`}><Icon size={16} aria-hidden="true"/></span><span className="stage-name">{stage.name}</span>{stage.lane !== 'testnet' && <span className={`stage-lane ${stage.lane}`}>{LANES[stage.lane]}</span>}</span>
            <span className="stage-summary">{stage.summary}</span>
            <span className="stage-status">
              {isRunning ? <Badge status="running">Running</Badge> : isReached && entry.label ? <Badge status={entry.status}>{entry.label}</Badge> : <Badge status="idle">{entry.idle || 'Not yet'}</Badge>}
            </span>
            {entry.detail && <span className="stage-ref">{isReached ? entry.detail : ' '}</span>}
          </button>
        </li>;
      })}
    </ol>
    <div className="pipeline-loop" aria-hidden="true"><span>A new release or a runtime change starts the loop again</span></div>
  </div>;
}
