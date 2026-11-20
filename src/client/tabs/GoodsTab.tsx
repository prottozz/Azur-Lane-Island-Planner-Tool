import { BuildingBoard } from '../components/BuildingBoard';
import { GoodsPanel } from '../components/GoodsPanel';
import { CommitInput } from '../components/CommitInput';
import { Shortfalls } from '../components/Shortfalls';
import { useApp } from '../useAppState';

export function GoodsTab() {
  const { state, plan, apply } = useApp();
  const { earned, target } = state.idp;

  const setTarget = (raw: string): string | null => {
    const t = raw.trim();
    if (t !== '' && !/^\d+$/.test(t)) return 'IDP target must be a whole number, zero or more, or blank';
    const n = t === '' ? null : Number(t);
    return apply(s => ({ ...s, idp: { ...s.idp, target: n } }));
  };

  return (
    <div className="goods-tab">
      <p className="summary" data-testid="idp-progress">
        {target === null ? `IDP: ${earned}` : `IDP: ${earned} / ${target}`}{' '}
        <label>Target{' '}
          <CommitInput numeric label="IDP target" value={target === null ? '' : String(target)} onCommit={setTarget} />
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
