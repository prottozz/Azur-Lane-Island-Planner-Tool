// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTab } from '../../src/client/tabs/DataTab';
import { AppStateContext, NowContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
import type { GameData, Result, State } from '../../src/shared/types';

const NOW = new Date(2026, 0, 1, 12, 0, 0);

function item(id: string, name: string, season: 'permanent' | number = 'permanent') {
  return { id, name, category: 'x', idp: null, cafeValue: null, season, active: true };
}

function makeGd(): GameData {
  const gd = emptyGameData();
  gd.items.seeds = item('seeds', 'Wheat Seeds');
  gd.items.wheat = item('wheat', 'Wheat');
  gd.items.corn = item('corn', 'Corn', 5);
  gd.items.spare = item('spare', 'Spare Item');
  gd.buildings.field = { id: 'field', name: 'Field', kind: 'field', pipeline: 'food', slots: 2, season: 'permanent', active: true };
  gd.buildings.kitchen = { id: 'kitchen', name: 'Kitchen', kind: 'kitchen', pipeline: 'food', slots: 1, season: 'permanent', active: true };
  gd.recipes.wheat = {
    id: 'wheat', buildingId: 'field', inputs: [{ item: 'seeds', qty: 9 }], outputs: [{ item: 'wheat', qty: 1 }], bonus: [],
    maxRuns: 12, secondsPerRun: 3600, stamina: 0, season: 'permanent', active: true,
  };
  gd.cafes.cafe = { id: 'cafe', name: 'Tea House', kitchenBuildingId: 'kitchen', sellable: [], ranks: [{ name: 'Rank 1', dishSlots: 2, capacityPerDish: 10 }], season: 'permanent', active: true };
  gd.shop.push({ item: 'seeds', price: 50, currency: 'coin', shop: 'General' });
  gd.spawns.sp = { id: 'sp', item: 'wheat', qtyPerDay: 3, season: 'permanent', active: true };
  return gd;
}

interface Holder { gd: GameData; state: State }

function Harness({ holder }: { holder: Holder }) {
  const [gd, setGd] = useState(holder.gd);
  const app: AppState = {
    gd, state: holder.state, plan: buildPlan(gd, holder.state, NOW), warnings: [],
    apply: () => null,
    applyGameData(fn: (g: GameData) => Result<GameData> | GameData) {
      const r = fn(holder.gd);
      if ('ok' in r && typeof r.ok === 'boolean') {
        if (!r.ok) return r.error;
        holder.gd = r.value;
      } else holder.gd = r as GameData;
      setGd(holder.gd);
      return null;
    },
    applyAll(fn) {
      const r = fn(holder.state, holder.gd);
      if ('ok' in r && typeof r.ok === 'boolean') {
        if (!r.ok) return r.error;
        holder.state = r.value.state;
        holder.gd = r.value.gd;
      } else {
        holder.state = (r as { state: State }).state;
        holder.gd = (r as { gd: GameData }).gd;
      }
      setGd(holder.gd);
      return null;
    },
    undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
  };
  return <AppStateContext.Provider value={app}><NowContext.Provider value={NOW}><DataTab /></NowContext.Provider></AppStateContext.Provider>;
}

function setup() {
  const holder: Holder = { gd: makeGd(), state: emptyState(NOW) };
  render(<Harness holder={holder} />);
  return holder;
}

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
function typeInto(label: string, value: string, how: 'blur' | 'enter' = 'blur') {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  if (how === 'blur') fireEvent.blur(input); else fireEvent.keyDown(input, { key: 'Enter' });
  return input;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DataTab', () => {
  it('editing max runs to 10 updates "to fill the job" to 90', () => {
    const holder = setup();
    tab('Recipes');
    expect(screen.getByTestId('fill-wheat').textContent).toBe('108 Wheat Seeds');
    typeInto('Max runs Wheat @ Field', '10');
    expect(holder.gd.recipes.wheat.maxRuns).toBe(10);
    expect(screen.getByTestId('fill-wheat').textContent).toBe('90 Wheat Seeds');
  });

  it('rejects an invalid max runs with an inline error and keeps the old value', () => {
    const holder = setup();
    tab('Recipes');
    for (const bad of ['0', 'abc', '1.5', '']) {
      typeInto('Max runs Wheat @ Field', bad);
      expect(within(screen.getByTestId('row-wheat')).getByRole('alert')).toBeTruthy();
      expect(holder.gd.recipes.wheat.maxRuns).toBe(12);
    }
    expect(screen.getByTestId('fill-wheat').textContent).toBe('108 Wheat Seeds');
  });

  it('commits on Enter only, and Escape reverts', () => {
    const holder = setup();
    const input = screen.getByLabelText('Name Spare Item') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed' } });
    expect(holder.gd.items.spare.name).toBe('Spare Item');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(holder.gd.items.spare.name).toBe('Renamed');
    const again = screen.getByLabelText('Name Renamed') as HTMLInputElement;
    fireEvent.change(again, { target: { value: 'Other' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect((screen.getByLabelText('Name Renamed') as HTMLInputElement).value).toBe('Renamed');
  });

  it('validates item fields: empty name, idp, café value', () => {
    const holder = setup();
    typeInto('Name Spare Item', '  ');
    expect(holder.gd.items.spare.name).toBe('Spare Item');
    typeInto('IDP Spare Item', '-2');
    expect(holder.gd.items.spare.idp).toBeNull();
    typeInto('IDP Spare Item', '4.5');
    expect(holder.gd.items.spare.idp).toBe(4.5);
    typeInto('IDP Spare Item', '');
    expect(holder.gd.items.spare.idp).toBeNull();
    typeInto('Café value Spare Item', '12');
    expect(holder.gd.items.spare.cafeValue).toBe(12);
  });

  it('parses a typed duration and rejects junk', () => {
    const holder = setup();
    tab('Recipes');
    typeInto('Time per run Wheat @ Field', '1h 30m');
    expect(holder.gd.recipes.wheat.secondsPerRun).toBe(5400);
    expect((screen.getByLabelText('Time per run Wheat @ Field') as HTMLInputElement).value).toBe('1:30:00');
    typeInto('Time per run Wheat @ Field', 'abc');
    expect(within(screen.getByTestId('row-wheat')).getByRole('alert')).toBeTruthy();
    expect(holder.gd.recipes.wheat.secondsPerRun).toBe(5400);
  });

  it('blocks deleting a referenced item and shows what uses it; unreferenced deletes', () => {
    const holder = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Wheat Seeds' }));
    const alert = within(screen.getByTestId('row-seeds')).getByRole('alert');
    expect(alert.textContent).toContain('used by');
    expect(alert.textContent).toContain('recipe Wheat');
    expect(holder.gd.items.seeds).toBeTruthy();
    expect(screen.getByTestId('row-seeds')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Spare Item' }));
    expect(holder.gd.items.spare).toBeUndefined();
    expect(screen.queryByTestId('row-spare')).toBeNull();
  });

  it('adds and duplicates items with custom ids and the current season', () => {
    const holder = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const added = Object.values(holder.gd.items).find(i => i.name === 'New item')!;
    expect(added.id.startsWith('custom-')).toBe(true);
    expect(added).toMatchObject({ season: 5, active: true, idp: null });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Spare Item' }));
    const copy = Object.values(holder.gd.items).find(i => i.name === 'Spare Item (copy)')!;
    expect(copy.id).not.toBe('spare');
    expect(copy.id.startsWith('custom-')).toBe(true);
  });

  it('a new or duplicated row appears first and highlighted until the next edit', () => {
    const holder = setup();
    const rowIds = () => screen.getAllByTestId(/^row-/).map(r => r.dataset.testid);
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const added = Object.values(holder.gd.items).find(i => i.name === 'New item')!;
    expect(rowIds()[0]).toBe(`row-${added.id}`);
    expect(screen.getByTestId(`row-${added.id}`).className).toBe('fresh');
    typeInto('Category Wheat', 'grain');                                  // any edit clears it
    expect(screen.getByTestId(`row-${added.id}`).className).toBe('');
    expect(rowIds()[0]).not.toBe(`row-${added.id}`);
    tab('Shop');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Wheat Seeds in General' }));
    expect(rowIds()).toEqual(['row-1', 'row-0']);
    expect(screen.getByTestId('row-1').className).toBe('fresh');
  });

  it('switches the season filter to All (with a note) when it would hide a new row', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Season filter'), { target: { value: 'permanent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect((screen.getByLabelText('Season filter') as HTMLSelectElement).value).toBe('all');
    expect(screen.getByRole('status').textContent).toMatch(/switched to All/);
    expect(screen.getByDisplayValue('New item')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Season filter'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Corn' }));   // season 5 copy: stays visible, no note
    expect((screen.getByLabelText('Season filter') as HTMLSelectElement).value).toBe('5');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('removing a café rank remaps café plans in the same change', () => {
    const holder = setup();
    holder.gd.cafes.cafe.ranks = ['A', 'B', 'C'].map(name => ({ name, dishSlots: 1, capacityPerDish: 1 }));
    holder.state = { ...holder.state, cafePlans: [{ cafeId: 'cafe', rankIndex: 2, dishes: [] }] };
    cleanup();
    render(<Harness holder={holder} />);
    tab('Cafés');
    fireEvent.click(screen.getByLabelText('Remove rank 1 of Tea House'));
    expect(holder.gd.cafes.cafe.ranks.map(r => r.name)).toEqual(['B', 'C']);
    expect(holder.state.cafePlans[0].rankIndex).toBe(1);
  });

  it('Fish tab lists items with fishing info, read-only', () => {
    const holder = setup();
    holder.gd.items.koi = { ...item('koi', 'Koi'), fishing: { location: 'Pond', bait: 'Worm', rodLevel: 2, qte: 'Hard', usedIn: 'Koi Soup', idpNote: '12 IDP/fish' } };
    cleanup();
    render(<Harness holder={holder} />);
    tab('Fish');
    const row = screen.getByTestId('fish-koi');
    expect([...row.querySelectorAll('td')].map(td => td.textContent)).toEqual(['Koi', 'Pond', 'Worm', '2', 'Hard', 'Koi Soup', '12 IDP/fish']);
    expect(screen.getAllByTestId(/^fish-/).filter(e => e.tagName === 'TR')).toHaveLength(1);
    expect(within(screen.getByTestId('fish-table')).queryByRole('textbox')).toBeNull();
  });

  it('season filter 5 hides permanent items; inactive are hidden until toggled', () => {
    const holder = setup();
    expect(screen.getByTestId('row-wheat')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Season filter'), { target: { value: '5' } });
    expect(screen.queryByTestId('row-wheat')).toBeNull();
    expect(screen.getByTestId('row-corn')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Season filter'), { target: { value: 'permanent' } });
    expect(screen.queryByTestId('row-corn')).toBeNull();
    expect(screen.getByTestId('row-wheat')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Season filter'), { target: { value: 'all' } });
    fireEvent.click(screen.getByLabelText('Active Spare Item'));
    expect(holder.gd.items.spare.active).toBe(false);
    expect(screen.queryByTestId('row-spare')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.getByTestId('row-spare')).toBeTruthy();
  });

  it('edits recipe chips: add an input, remove an input, protects the last output', () => {
    const holder = setup();
    tab('Recipes');
    expect(screen.getByText('Wheat Seeds ×9')).toBeTruthy();
    expect(screen.queryByLabelText('Inputs Wheat @ Field item')).toBeNull();   // picker renders only after "+ add"
    fireEvent.click(screen.getByLabelText('Add item to Inputs Wheat @ Field'));
    fireEvent.change(screen.getByLabelText('Inputs Wheat @ Field item'), { target: { value: 'corn' } });
    fireEvent.change(screen.getByLabelText('Inputs Wheat @ Field qty'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Add to Inputs Wheat @ Field'));
    expect(holder.gd.recipes.wheat.inputs).toEqual([{ item: 'seeds', qty: 9 }, { item: 'corn', qty: 4 }]);
    expect(screen.getByTestId('fill-wheat').textContent).toBe('108 Wheat Seeds, 48 Corn');
    expect(screen.queryByLabelText('Inputs Wheat @ Field item')).toBeNull();   // closes after a successful add
    fireEvent.click(screen.getByLabelText('Remove Corn from Inputs Wheat @ Field'));
    expect(holder.gd.recipes.wheat.inputs).toEqual([{ item: 'seeds', qty: 9 }]);
    fireEvent.click(screen.getByLabelText('Remove Wheat from Outputs Wheat @ Field'));
    expect(holder.gd.recipes.wheat.outputs).toHaveLength(1);
    expect(within(screen.getByTestId('row-wheat')).getByRole('alert')).toBeTruthy();
  });

  it('adds a bonus output with an every-runs field', () => {
    const holder = setup();
    tab('Recipes');
    fireEvent.click(screen.getByLabelText('Add item to Bonus Wheat @ Field'));
    fireEvent.change(screen.getByLabelText('Bonus Wheat @ Field qty'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Bonus Wheat @ Field every runs'), { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('Add to Bonus Wheat @ Field'));
    expect(holder.gd.recipes.wheat.bonus).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Bonus Wheat @ Field every runs'), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('Add to Bonus Wheat @ Field'));
    expect(holder.gd.recipes.wheat.bonus).toEqual([{ item: 'corn', qty: 2, everyRuns: 5 }]);
  });

  it('edits buildings: slots must be an integer of at least 1', () => {
    const holder = setup();
    tab('Buildings');
    typeInto('Slots Field', '0');
    expect(holder.gd.buildings.field.slots).toBe(2);
    typeInto('Slots Field', '3');
    expect(holder.gd.buildings.field.slots).toBe(3);
    fireEvent.change(screen.getByLabelText('Pipeline Field'), { target: { value: 'goods' } });
    expect(holder.gd.buildings.field.pipeline).toBe('goods');
  });

  it('blocks deleting a building used by a recipe', () => {
    const holder = setup();
    tab('Buildings');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Field' }));
    expect(within(screen.getByTestId('row-field')).getByRole('alert').textContent).toContain('used by');
    expect(holder.gd.buildings.field).toBeTruthy();
  });

  it('edits cafés: rank values and sellable chips', () => {
    const holder = setup();
    tab('Cafés');
    typeInto('Tea House rank 1 dish slots', '0');
    expect(holder.gd.cafes.cafe.ranks[0].dishSlots).toBe(2);
    typeInto('Tea House rank 1 dish slots', '3');
    expect(holder.gd.cafes.cafe.ranks[0].dishSlots).toBe(3);
    fireEvent.click(screen.getByLabelText('Add rank to Tea House'));
    expect(holder.gd.cafes.cafe.ranks).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Remove rank 2 of Tea House'));
    expect(holder.gd.cafes.cafe.ranks).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Add item to Sellable Tea House'));
    fireEvent.change(screen.getByLabelText('Sellable Tea House item'), { target: { value: 'wheat' } });
    fireEvent.click(screen.getByLabelText('Add to Sellable Tea House'));
    expect(holder.gd.cafes.cafe.sellable).toEqual(['wheat']);
  });

  it('edits shop prices and deletes shop entries and spawns directly', () => {
    const holder = setup();
    tab('Shop');
    typeInto('Price Wheat Seeds in General', '-1');
    expect(holder.gd.shop[0].price).toBe(50);
    typeInto('Price Wheat Seeds in General', '75');
    expect(holder.gd.shop[0].price).toBe(75);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Wheat Seeds in General' }));
    expect(holder.gd.shop).toHaveLength(0);
    tab('Daily spawns');
    typeInto('Qty per day Wheat', '0');
    expect(holder.gd.spawns.sp.qtyPerDay).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Wheat' }));
    expect(holder.gd.spawns.sp).toBeUndefined();
  });

  it('paste import previews 2 valid rows and 1 error, then adds the rows in the current season', () => {
    const holder = setup();
    const text = [
      'Building\tInputs\tOutputs\tMax runs\tTime per run\tSeason',
      'Field\tWheat Seeds x3\tWheat x1\t8\t1:00:00\t',
      'Kitchen\tWheat x2\tCorn x1\t4\t30m\t',
      'Nowhere\tWheat x2\tCorn x1\t4\t30m\t',
    ].join('\n');
    fireEvent.change(screen.getByLabelText('Paste kind'), { target: { value: 'recipes' } });
    fireEvent.change(screen.getByLabelText('Paste data'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getAllByTestId('paste-row')).toHaveLength(2);
    expect(within(screen.getByTestId('paste-errors')).getAllByRole('listitem')).toHaveLength(1);
    const before = Object.keys(holder.gd.recipes).length;
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 rows' }));
    const added = Object.values(holder.gd.recipes).filter(r => r.id.startsWith('custom-'));
    expect(Object.keys(holder.gd.recipes)).toHaveLength(before + 2);
    expect(added.map(r => r.season)).toEqual([5, 5]);
  });

  it('paste import of items keeps an explicit permanent season', () => {
    const holder = setup();
    const text = 'Name\tCategory\tIDP\tCafé\tSeason\nFoo\tx\t\t\t\nBar\tx\t\t\tpermanent';
    fireEvent.change(screen.getByLabelText('Paste data'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 rows' }));
    const seasonOf = (n: string) => Object.values(holder.gd.items).find(i => i.name === n)!.season;
    expect(seasonOf('Foo')).toBe(5);
    expect(seasonOf('Bar')).toBe('permanent');
  });

  it('exports gamedata as island-gamedata-YYYY-MM-DD.json', () => {
    setup();
    const create = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(name).toMatch(/^island-gamedata-\d{4}-\d{2}-\d{2}\.json$/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  function importFile(content: string) {
    const input = screen.getByLabelText('Import JSON file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([content], 'x.json', { type: 'application/json' })] } });
  }

  it('import JSON with the wrong version shows an error and changes nothing', async () => {
    const holder = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const before = holder.gd;
    importFile(JSON.stringify({ ...emptyGameData(), version: 2 }));
    const alert = await screen.findByText(/unsupported version/);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(confirm).not.toHaveBeenCalled();
    expect(holder.gd).toBe(before);
  });

  it('import JSON with a wrong container type shows an error', async () => {
    setup();
    importFile(JSON.stringify({ ...emptyGameData(), shop: {} }));
    expect(await screen.findByText(/"shop" must be a list/)).toBeTruthy();
  });

  it('import JSON replaces all game data only after confirmation', async () => {
    const holder = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const next = emptyGameData();
    next.items.z = item('z', 'Zed');
    const before = holder.gd;
    importFile(JSON.stringify(next));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith('Replace all game data? This can be undone.');
    expect(holder.gd).toBe(before);
    importFile(JSON.stringify(next));
    await waitFor(() => expect(holder.gd.items.z?.name).toBe('Zed'));
    expect(holder.gd.items.seeds).toBeUndefined();
  });
});
