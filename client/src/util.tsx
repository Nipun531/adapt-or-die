/**
 * Shared helpers: number formatting, item lookups, and the data/action hooks every view uses.
 * Visual state components live in ui/states.tsx.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, type Catalog, type Item, type Loadout } from './api';

export const n2 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : (Math.round(x * 100) / 100).toString());
export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const sideName = (s: string) => (s === 'player' ? 'You' : s === 'boss' ? 'Boss' : s);

export const CatalogContext = createContext<Catalog | null>(null);
export function useCatalog(): Catalog | null {
  return useContext(CatalogContext);
}
export function itemName(catalog: Catalog | null, id: string | null | undefined): string {
  if (!id) return '—';
  return findItem(catalog, id)?.name ?? id;
}
/** Live item, or an older-engine item (historical runs) when the id no longer exists. */
export function findItem(catalog: Catalog | null, id: string): Item | undefined {
  return catalog?.items.find((i) => i.id === id) ?? catalog?.legacyItems?.find((i) => i.id === id);
}
export function loadoutText(catalog: Catalog | null, lo: Loadout): string {
  const parts = [lo.hand1, lo.hand2, lo.armour].filter(Boolean).map((id) => itemName(catalog, id));
  return parts.length ? parts.join(' · ') : 'Unarmed, no armor';
}
export function modsText(m: { str: number; def: number; dex: number }): string {
  const parts = (['str', 'def', 'dex'] as const).filter((k) => m[k] !== 0).map((k) => `${m[k] > 0 ? '+' : ''}${m[k]} ${k.toUpperCase()}`);
  return parts.length ? parts.join(', ') : 'no modifiers';
}

/** Load data with loading/error state; `reload` re-runs the loader. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Wrap a mutating action: tracks busy state and the last error/success message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (success) setNotice(success);
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, notice, run, clear: () => { setError(null); setNotice(null); } };
}

export const signed = (x: number, digits = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;


