import type { AdapterAnzeige, AdapterArtAnzeige, AdapterListe } from '../api/types';

/**
 * Testdaten der Adapter-Verwaltung (LLH-2018). Die Art „Beispiel-Alarmquelle“ ist erfunden: in
 * Produktion gibt es noch keine (`Verzeichnis::produktiv()` ist leer).
 */
export const BEISPIEL_ART: AdapterArtAnzeige = {
  code: 'beispiel',
  bezeichnung: 'Beispiel-Alarmquelle',
  felder: [
    { name: 'url', bezeichnung: 'Adresse', typ: 'url', pflicht: true, max: 512 },
    { name: 'standort', bezeichnung: 'Standort-Kennung', typ: 'text', pflicht: false, max: 40 },
  ],
  plaetze: [
    { name: 'token', bezeichnung: 'API-Schlüssel', pflicht: true },
    { name: 'kennwort', bezeichnung: 'Kennwort des Abrufkontos', pflicht: false },
  ],
  intervall_min_s: 30,
  intervall_vorschlag_s: 60,
};

export function adapterFixture(id: string, extra: Partial<AdapterAnzeige> = {}): AdapterAnzeige {
  return {
    id,
    art: 'beispiel',
    art_bezeichnung: 'Beispiel-Alarmquelle',
    name: `Adapter ${id}`,
    einstellungen: { url: 'https://alarm.example/api', standort: 'WA-01' } as never,
    intervall_s: 60,
    lan_erlaubt: false,
    zustand: 'ok',
    fehlversuche: 0,
    letzter_erfolg_at: '2026-11-22 08:37:00',
    letzte_anzahl: 4,
    naechster_abruf_at: '2026-11-22 08:38:00',
    geheimnisse: [
      {
        name: 'token',
        bezeichnung: 'API-Schlüssel',
        pflicht: true,
        is_gesetzt: true,
        gesetzt_at: '2026-11-21 17:04:00',
        gesetzt_von_name: 'R. Vitt',
        is_unlesbar: false,
      },
      {
        name: 'kennwort',
        bezeichnung: 'Kennwort des Abrufkontos',
        pflicht: false,
        is_gesetzt: false,
        is_unlesbar: false,
      },
    ],
    angelegt_at: '2026-11-21 17:02:00',
    geaendert_at: '2026-11-21 17:04:00',
    ...extra,
  };
}

export function adapterListeFixture(extra: Partial<AdapterListe> = {}): AdapterListe {
  return {
    adapter: [adapterFixture('a1')],
    arten: [BEISPIEL_ART],
    speicher: 'bereit',
    speicher_fingerabdruck: '7f3a9c21e04b5d86',
    ...extra,
  };
}
