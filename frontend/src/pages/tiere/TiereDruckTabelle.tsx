import type { Tier } from '../../api/types';
import { tierRegistrierAnzeige } from '../../api/einsatzTier';
import type { AnzeigeKonventionen } from '../../anzeige/format';
import DruckTabelle, { druckZeit, type DruckSpalte } from '../../druck/DruckTabelle';
import { SPEZIES_META, TIER_STATUS, halterNummer } from './tierHelfer';

interface Props {
  /** Die gedruckte Auswahl, in beliebiger Ordnung. */
  tiere: readonly Tier[];
  konventionen: AnzeigeKonventionen;
}

/** Halter auf Papier: Registriernummer der Person (ggf. storniert), sonst Kontakt, sonst „unbekannt". */
function halterText(t: Tier): string {
  const nummer = halterNummer(t);
  if (nummer != null) return t.halter_storniert_at ? `${nummer} (storniert)` : nummer;
  return t.halter_kontakt || 'unbekannt';
}

/**
 * Papierform der Tierliste (LFH-727, design.md D6): die Spalten der Liste als Text, aufsteigend
 * nach Registriernummer.
 */
export default function TiereDruckTabelle({ tiere, konventionen }: Props) {
  const spalten: DruckSpalte<Tier>[] = [
    { titel: 'Nr.', mono: true, wert: (t) => tierRegistrierAnzeige(t.registrier_nr) },
    { titel: 'Status', wert: (t) => TIER_STATUS[t.status].label },
    { titel: 'Spezies', wert: (t) => SPEZIES_META[t.spezies] },
    { titel: 'Rufname', wert: (t) => t.rufname ?? '—' },
    { titel: 'Rasse', wert: (t) => t.rasse_beschreibung ?? '—' },
    { titel: 'Halter', wert: halterText },
    { titel: 'Antreffort', wert: (t) => t.antreff_ort ?? '—' },
    { titel: 'erfasst', mono: true, wert: (t) => druckZeit(t.erfasst_at, konventionen) },
  ];
  return (
    <DruckTabelle
      kennung="tiere-druck-tabelle"
      spalten={spalten}
      zeilen={[...tiere].sort((a, b) => a.registrier_nr - b.registrier_nr)}
      schluessel={(t) => t.id}
    />
  );
}
