import { useState } from 'react';
import type { KeyboardEvent } from 'react';

interface Props {
  label: string;
  value: string;
  numeric?: boolean;
  /** Called on blur/Enter with the typed text; returns an error message, or null when accepted. */
  onCommit(raw: string): string | null;
}

/** Text input that commits only on blur/Enter (never per keystroke); Escape reverts. Shows its error inline. */
export function CommitInput({ label, value, numeric, onCommit }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    if (draft === value) { setDraft(null); setError(null); return; }
    const err = onCommit(draft);
    setError(err);
    if (!err) setDraft(null);
  };
  const revert = () => { setDraft(null); setError(null); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') revert();
  };

  return (
    <>
      <input type="text" inputMode={numeric ? 'decimal' : undefined} aria-label={label} value={draft ?? value}
        onChange={e => { setDraft(e.target.value); setError(null); }}
        onBlur={commit} onKeyDown={onKeyDown} />
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}
