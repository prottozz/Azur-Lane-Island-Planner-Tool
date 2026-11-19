import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { CafeTab } from './tabs/CafeTab';
import { GoodsTab } from './tabs/GoodsTab';

const TABS = [
  { id: 'cafe', label: 'Café / Money' },
  { id: 'goods', label: 'Goods / IDP' },
  { id: 'stock', label: 'Stock' },
  { id: 'data', label: 'Data' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const id = window.location.hash.replace(/^#/, '');
  return TABS.find(t => t.id === id)?.id ?? 'cafe';
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const label = TABS.find(t => t.id === tab)!.label;

  return (
    <div className="app">
      <Header />
      <nav className="tabs">
        {TABS.map(t => (
          <a key={t.id} href={`#${t.id}`} className={t.id === tab ? 'tab active' : 'tab'}>{t.label}</a>
        ))}
      </nav>
      <main className="tab-body">
        <h2>{label}</h2>
        {tab === 'cafe' ? <CafeTab /> : tab === 'goods' ? <GoodsTab /> : <p className="muted">Nothing here yet.</p>}
      </main>
    </div>
  );
}
