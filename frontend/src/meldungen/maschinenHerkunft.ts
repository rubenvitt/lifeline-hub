import type { MaschinenHerkunft, ReportSuggestion } from '../api/types';

/**
 * Herkunft eines Vorschlags aus dem Maschinen-Eingang (LLH-2112) und einer daraus übernommenen
 * Meldung als Text. Der Vorschlag trägt sie mit englischen Wire-Feldern (`source`), die Meldung
 * mit deutschen (`maschinen_herkunft`); beide Formen gehen hier hinein.
 */
type Herkunft = ReportSuggestion['source'] | MaschinenHerkunft;

/** Lesbare Namen bekannter Adapter; ein unbekannter erscheint mit seinem Kennwort. */
const ADAPTER_NAME: Record<string, string> = { meshtastic: 'Mesh' };

/** Wie der Adapter seinen Absender nennt. */
const ABSENDER_WORT: Record<string, string> = { meshtastic: 'Knoten' };

function teile(h: Herkunft): {
  adapter: string;
  kennung: string;
  name?: string;
  signiert: boolean;
} {
  const kennung = 'kennung' in h ? h.kennung : h.sender_id;
  const name = ('kennung' in h ? h.name : h.sender_name)?.trim() || undefined;
  const signiert = 'kennung' in h ? h.signiert : h.signed;
  return { adapter: h.adapter, kennung, name, signiert };
}

const adapterName = (adapter: string) => ADAPTER_NAME[adapter] ?? adapter;
const signaturWort = (signiert: boolean) => (signiert ? 'signiert' : 'nicht signiert');

/** „Mesh · Knoten „Nord-1“ (!a1b2c3d4) · nicht signiert“, ohne Namen „Mesh · Knoten !77ee01ff · signiert“. */
export function herkunftText(h: Herkunft): string {
  const { adapter, kennung, name, signiert } = teile(h);
  const wort = ABSENDER_WORT[adapter] ?? 'Absender';
  const absender = name ? `${wort} „${name}“ (${kennung})` : `${wort} ${kennung}`;
  return [adapterName(adapter), absender, signaturWort(signiert)].join(' · ');
}

/** Kurzform fürs Etikett an der Meldung: „Mesh · Nord-1 · nicht signiert“ (Name, sonst Kennung). */
export function herkunftKurz(h: Herkunft): string {
  const { adapter, kennung, name, signiert } = teile(h);
  return [adapterName(adapter), name ?? kennung, signaturWort(signiert)].join(' · ');
}

/** Absender der übernommenen Meldung: der Name, sonst die Kennung. */
export function herkunftAbsender(h: Herkunft): string {
  const { kennung, name } = teile(h);
  return name ?? kennung;
}
