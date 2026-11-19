import { BuildingBoard } from '../components/BuildingBoard';
import { GoodsPanel } from '../components/GoodsPanel';
import { Shortfalls } from '../components/Shortfalls';
import { useApp } from '../useAppState';

export function GoodsTab() {
  const { state, plan, apply } = useApp();
  const { earned, target } = state.idp;

  const setTarget = (raw: string) => {
    if (raw.trim() === '') { apply(s => ({ ...s, idp: { ...s.idp, target: null } })); return; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return;
    apply(s => ({ ...s, idp: { ...s.idp, target: n } }));
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
      {target !== null && target > 0 && (
        <progress aria-label="IDP progress" max={target} value={Math.min(earned, target)} />
      )}
      <BuildingBoard pipeline="goods" />
      <GoodsPanel />
      <Shortfalls expansion={plan.goods} />
    </div>
  );
}
