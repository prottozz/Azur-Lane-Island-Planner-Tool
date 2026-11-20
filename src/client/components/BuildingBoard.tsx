import { useState } from 'react';
import { cancelJob, finishJob, startJob } from '../../shared/actions';
import type { Suggestion } from '../../shared/planner/suggest';
import { formatDuration, hhmm } from '../../shared/time';
import type { Building, GameData, Job } from '../../shared/types';
import { useApp, useNow } from '../useAppState';
import { JobDialog } from './JobDialog';

/** Jobs no slot row shows: their building is missing or inactive, or their slot is beyond the building's slot count. */
export function orphanJobs(gd: GameData, jobs: Job[]): Job[] {
  return jobs.filter(j => {
    const b = gd.buildings[j.buildingId];
    return !b || !b.active || j.slot >= b.slots;
  });
}

export function BuildingBoard({ pipeline }: { pipeline: 'food' | 'goods' }) {
  const { gd, state, plan, apply } = useApp();
  const now = useNow();
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const name = (id: string) => gd.items[id]?.name ?? id;
  const recipeName = (recipeId: string) => {
    const out = gd.recipes[recipeId]?.outputs[0];
    return out ? name(out.item) : recipeId;
  };
  const servesPipeline = (b: Building) => b.pipeline === pipeline || b.pipeline === 'both';
  const buildings = Object.values(gd.buildings)
    .filter(b => b.active && servesPipeline(b))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Jobs of a missing building show on every board; jobs of an inactive building on that building's boards.
  const orphans = orphanJobs(gd, state.jobs).filter(j => !gd.buildings[j.buildingId] || servesPipeline(gd.buildings[j.buildingId]));

  const run = (fn: Parameters<typeof apply>[0]) => setError(apply(fn));
  const remove = (job: Job) => {
    const refund = gd.recipes[job.recipeId] ? ' Its inputs are refunded.' : ' Its recipe no longer exists, so nothing is refunded.';
    if (window.confirm(`Remove this job?${refund}`)) run((s, g) => cancelJob(s, g, job.id));
  };

  const renderSuggestion = (sug: Suggestion) => (
    <span className="suggestion">
      {recipeName(sug.recipeId)} ×{sug.runs} <span className="muted">{sug.reason}</span>
    </span>
  );

  /** Inline "Waiting for … (ready HH:MM)" / "Missing: …" so a disabled Start explains itself. */
  const blockers = (sug: Suggestion) => {
    const waiting = sug.waitingFor ?? [];
    if (waiting.length === 0 && sug.missing.length === 0) return null;
    return (
      <span className="blockers" data-testid="blockers">
        {waiting.map(w => (
          <span key={`w-${w.item}`} className="waiting">Waiting for {name(w.item)} (ready {hhmm(new Date(w.readyAt))})</span>
        ))}
        {sug.missing.length > 0 && (
          <span className="missing">Missing: {sug.missing.map(q => `${name(q.item)} ×${q.qty}`).join(', ')}</span>
        )}
      </span>
    );
  };

  const renderSlot = (b: Building, slot: number) => {
    const key = `${b.id}:${slot}`;
    const job: Job | undefined = state.jobs.find(j => j.buildingId === b.id && j.slot === slot);
    const sug = plan.suggestions.find(x => x.buildingId === b.id && x.slot === slot);
    const recipe = job ? gd.recipes[job.recipeId] : undefined;
    const secondsLeft = job ? (Date.parse(job.endsAt) - now.getTime()) / 1000 : 0;
    const ready = job !== undefined && secondsLeft <= 0;
    const blocked = sug !== undefined && (sug.missing.length > 0 || (sug.waitingFor?.length ?? 0) > 0);

    return (
      <div key={key} className="slot-block">
        <div className="slot-row" data-testid={`slot-${b.id}-${slot}`}>
          <span className="slot-label muted">Slot {slot + 1}</span>
          {job ? (
            <>
              <span className="slot-job">
                {recipeName(job.recipeId)} <span>{job.runs}{recipe ? `/${recipe.maxRuns}` : ''}</span>
                {!recipe && <span className="muted"> (recipe deleted)</span>}
              </span>
              {ready ? <strong className="ready">Ready</strong> : <span className="countdown">{formatDuration(secondsLeft)}</span>}
              {recipe ? (
                <>
                  <button className={ready ? 'primary' : undefined} onClick={() => run((s, g) => finishJob(s, g, job.id))}>Finish</button>
                  {!ready && (
                    <button className="small" onClick={() => {
                      if (window.confirm('Cancel this job and refund its inputs?')) run((s, g) => cancelJob(s, g, job.id));
                    }}>Cancel</button>
                  )}
                </>
              ) : (
                <button className="small" onClick={() => remove(job)}>Remove</button>
              )}
              {ready && sug && <span className="muted">Next: {renderSuggestion(sug)}</span>}
            </>
          ) : (
            <>
              {sug ? (
                <>
                  {renderSuggestion(sug)}
                  {blockers(sug)}
                  <button
                    className="primary"
                    disabled={blocked}
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
      {orphans.length > 0 && (
        <section className="building orphans" data-testid="orphan-jobs">
          <h3>Other running jobs</h3>
          <p className="muted">These jobs are on a building or slot that is missing or inactive.</p>
          <ul>
            {orphans.map(job => {
              const b = gd.buildings[job.buildingId];
              const recipe = gd.recipes[job.recipeId];
              const ready = Date.parse(job.endsAt) <= now.getTime();
              return (
                <li key={job.id} data-testid={`orphan-${job.id}`}>
                  {recipeName(job.recipeId)} ×{job.runs} — {b ? `${b.name}, slot ${job.slot + 1}${b.active ? '' : ' (inactive)'}` : `unknown building ${job.buildingId}`}
                  {' · '}{ready ? 'Ready' : `ends ${hhmm(new Date(job.endsAt))}`}{' '}
                  {recipe && <button className="small" onClick={() => run((s, g) => finishJob(s, g, job.id))}>Finish</button>}{' '}
                  <button className="small" onClick={() => remove(job)}>Remove</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
