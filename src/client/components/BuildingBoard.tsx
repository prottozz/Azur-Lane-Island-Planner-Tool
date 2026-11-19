import { useState } from 'react';
import { cancelJob, finishJob, startJob } from '../../shared/actions';
import type { Suggestion } from '../../shared/planner/suggest';
import { formatDuration } from '../../shared/time';
import type { Building, Job } from '../../shared/types';
import { useApp } from '../useAppState';
import { JobDialog } from './JobDialog';

export function BuildingBoard({ pipeline }: { pipeline: 'food' | 'goods' }) {
  const { gd, state, plan, now, apply } = useApp();
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const name = (id: string) => gd.items[id]?.name ?? id;
  const recipeName = (recipeId: string) => {
    const out = gd.recipes[recipeId]?.outputs[0];
    return out ? name(out.item) : recipeId;
  };
  const buildings = Object.values(gd.buildings)
    .filter(b => b.active && (b.pipeline === pipeline || b.pipeline === 'both'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const run = (fn: Parameters<typeof apply>[0]) => setError(apply(fn));

  const renderSuggestion = (sug: Suggestion) => (
    <span className="suggestion">
      {recipeName(sug.recipeId)} ×{sug.runs} <span className="muted">{sug.reason}</span>
    </span>
  );

  const renderSlot = (b: Building, slot: number) => {
    const key = `${b.id}:${slot}`;
    const job: Job | undefined = state.jobs.find(j => j.buildingId === b.id && j.slot === slot);
    const sug = plan.suggestions.find(x => x.buildingId === b.id && x.slot === slot);
    const maxRuns = job ? gd.recipes[job.recipeId]?.maxRuns : undefined;
    const secondsLeft = job ? (Date.parse(job.endsAt) - now.getTime()) / 1000 : 0;
    const ready = job !== undefined && secondsLeft <= 0;

    return (
      <div key={key} className="slot-block">
        <div className="slot-row" data-testid={`slot-${b.id}-${slot}`}>
          <span className="slot-label muted">Slot {slot + 1}</span>
          {job ? (
            <>
              <span className="slot-job">
                {recipeName(job.recipeId)} <span>{job.runs}{maxRuns !== undefined ? `/${maxRuns}` : ''}</span>
              </span>
              {ready ? <strong className="ready">Ready</strong> : <span className="countdown">{formatDuration(secondsLeft)}</span>}
              <button className={ready ? 'primary' : undefined} onClick={() => run((s, g) => finishJob(s, g, job.id))}>Finish</button>
              {!ready && (
                <button className="small" onClick={() => {
                  if (window.confirm('Cancel this job and refund its inputs?')) run((s, g) => cancelJob(s, g, job.id));
                }}>Cancel</button>
              )}
              {ready && sug && <span className="muted">Next: {renderSuggestion(sug)}</span>}
            </>
          ) : (
            <>
              {sug ? (
                <>
                  {renderSuggestion(sug)}
                  <button
                    className="primary"
                    disabled={sug.missing.length > 0}
                    title={sug.missing.length > 0 ? `Missing: ${sug.missing.map(q => `${name(q.item)} ×${q.qty}`).join(', ')}` : undefined}
                    onClick={() => { setOpenSlot(null); run((s, g) => startJob(s, g, {
                      buildingId: b.id, slot, recipeId: sug.recipeId, runs: sug.runs, now: new Date(),
                    })); }}
                  >Start</button>
                </>
              ) : <span className="muted">No suggestion</span>}
              <button onClick={() => setOpenSlot(openSlot === key ? null : key)}>Other…</button>
            </>
          )}
        </div>
        {openSlot === key && !job && (
          <JobDialog buildingId={b.id} slot={slot} onClose={() => setOpenSlot(null)} />
        )}
      </div>
    );
  };

  return (
    <div className="building-board">
      {error && <p className="error" role="alert">{error}</p>}
      {buildings.length === 0 && <p className="muted">No active buildings for this pipeline.</p>}
      {buildings.map(b => (
        <section key={b.id} className="building">
          <h3>{b.name}</h3>
          {Array.from({ length: b.slots }, (_, i) => renderSlot(b, i))}
        </section>
      ))}
    </div>
  );
}
