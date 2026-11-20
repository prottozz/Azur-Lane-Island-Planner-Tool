import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { ErrorBoundary } from './ErrorBoundary';
import { CafeTab } from './tabs/CafeTab';
import { DataTab } from './tabs/DataTab';
import { GoodsTab } from './tabs/GoodsTab';
import { StockTab } from './tabs/StockTab';

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
        {/* Keyed by tab: a crash in one tab leaves the header and the other tabs (including Data → Import JSON) usable. */}
        <ErrorBoundary key={tab}>
          {tab === 'cafe' ? <CafeTab /> : tab === 'goods' ? <GoodsTab /> : tab === 'stock' ? <StockTab /> : <DataTab />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
