import { useState } from 'react';
import { BuildingBoard } from '../components/BuildingBoard';
import { GoodsPanel } from '../components/GoodsPanel';
import { Shortfalls } from '../components/Shortfalls';
import { useApp } from '../useAppState';

export function GoodsTab() {
  const { state, plan, apply } = useApp();
  const { earned, target } = state.idp;
  const [error, setError] = useState<string | null>(null);

  const setTarget = (raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw);
    if (n !== null && (!Number.isInteger(n) || n < 0)) return;
    setError(apply(s => ({ ...s, idp: { ...s.idp, target: n } })));
  };

  return (
    <div className="goods-tab">
      <p className="summary" data-testid="idp-progress">
        {target === null ? `IDP: ${earned}` : `IDP: ${earned} / ${target}`}{' '}
        <label>Target{' '}
          <input type="number" min={0} step={1} aria-label="IDP target" placeholder="none"
            value={target ?? ''} onChange={e => setTarget(e.target.value)} />
        </label>
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {target !== null && target > 0 && (
        <progress aria-label="IDP progress" max={target} value={Math.min(earned, target)} />
      )}
      <BuildingBoard pipeline="goods" />
      <GoodsPanel />
      <Shortfalls expansion={plan.goods} />
    </div>
  );
}
