import type { AnzeigeKonventionen } from '../../anzeige/format';
import { kraefteText } from '../../anzeige/staerke';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import type { KennzahlTon, KennzahlZustand } from '../../components/instrument';
import {
  NICHT_FREIGEGEBEN,
  auftraegeNotiz,
  meldungenNotiz,
  type Zaehlstand,
  type auftragsStand,
  type meldungsStand,
} from './fuehrungsZahlen';
import type { Lagebild, Quellzustand } from './lagebild';

/**
 * Was eine Kennzahl des Lagebilds zeigt, unabhängig von der Form (LLH-1747, Spec
 * `grossbild-ansicht`, „Dieselben Zahlen wie die Seite“): die Seite setzt es in `Kennzahl`, das
 * Großbild in `GrossKennzahl`. So laufen Wert, Ton, „—“ mit Grund und Datenzustand nicht
 * auseinander. Rein.
 */
export interface KennzahlAnzeige {
  titel: string;
  wert: string | number;
  einheit?: string;
  notiz: string;
  ton: KennzahlTon;
  zustand: KennzahlZustand;
  /** Nur die Seite springt; das Großbild liest es nicht. */
  ziel?: string;
}

type BandKennzahl = Lagebild['kennzahlen'][number];

/** `Datenzustand` → Zustand der Kennzahl (`leer` gibt es dort nicht: eine Null ist ein Wert). */
function alsKennzahlZustand(z: Exclude<Quellzustand, 'gesperrt'>): KennzahlZustand {
  return z === 'leer' ? 'daten' : z;
}

/**
 * Eine Kennzahl des Bands. Nicht freigegeben (LFH-669): „—“ mit Grund, kein Ausfall, keine
 * erfundene 0, kein Sprung.
 */
export function bandKennzahl(k: BandKennzahl, z: Quellzustand, ziel?: string): KennzahlAnzeige {
  if (z === 'gesperrt') {
    return {
      titel: k.etikett,
      wert: '—',
      notiz: NICHT_FREIGEGEBEN,
      ton: 'neutral',
      zustand: 'daten',
    };
  }
  return {
    titel: k.etikett,
    wert: k.wert,
    einheit: k.einheit,
    notiz: k.notiz,
    ton: k.ton,
    zustand: alsKennzahlZustand(z),
    ziel,
  };
}

interface FuehrungsQuellen {
  /** `null`, solange das Lagebild noch nicht steht: dann behauptet der Führungsstand nichts. */
  lagebild: Lagebild | null;
  auftraege: ReturnType<typeof auftragsStand>;
  meldungen: ReturnType<typeof meldungsStand>;
  lageberichte: Quellzustand;
  uhs: Quellzustand;
  konv: AnzeigeKonventionen;
  /** Sprungziele der Seite; das Großbild lässt sie weg. */
  ziele?: {
    auftraege: string;
    meldungen: string;
    lageberichte: string;
    lagebericht: (id: number) => string;
    uhs: string;
  };
}

/**
 * Der Führungsstand: Aufträge offen, Meldungen offen, Lagebericht, UHS aktiv. Aufträge und
 * Meldungen aus dem Modulzähler (LFH-550), die Überfällig-Zahlen sind Alarmbeiträge. Der
 * Lagebericht hat keinen Ton (LFH-532): ein Entwurf ist kein Warnzustand.
 */
export function fuehrungsKennzahlen(q: FuehrungsQuellen): KennzahlAnzeige[] {
  const { lagebild, auftraege, meldungen, konv, ziele } = q;
  const fuehrung = lagebild?.fuehrung;
  const zZaehlstand = (z: Zaehlstand<unknown>): KennzahlZustand =>
    !lagebild || z.zustand === 'laden' ? 'laden' : z.zustand === 'fehler' ? 'fehler' : 'daten';
  const zQuelle = (z: Quellzustand): KennzahlZustand =>
    !lagebild ? 'laden' : z === 'gesperrt' ? 'daten' : alsKennzahlZustand(z);
  // Gesperrt erst mit Lagebild: vorher behauptet der Führungsstand keinen Stand, auch keinen Grund.
  const berichteGesperrt = lagebild != null && q.lageberichte === 'gesperrt';
  const uhsGesperrt = lagebild != null && q.uhs === 'gesperrt';

  return [
    {
      titel: 'Aufträge offen',
      wert:
        auftraege.zustand === 'daten'
          ? auftraege.zahl.offen
          : auftraege.zustand === 'gesperrt'
            ? '—'
            : '',
      notiz:
        auftraege.zustand === 'daten'
          ? auftraegeNotiz(auftraege.zahl)
          : auftraege.zustand === 'gesperrt'
            ? NICHT_FREIGEGEBEN
            : '',
      ton: auftraege.zustand === 'daten' && auftraege.zahl.ueberfaellig > 0 ? 'alarm' : 'neutral',
      zustand: zZaehlstand(auftraege),
      ziel: auftraege.zustand === 'gesperrt' ? undefined : ziele?.auftraege,
    },
    {
      titel: 'Meldungen offen',
      wert:
        meldungen.zustand === 'daten'
          ? meldungen.zahl.offen
          : meldungen.zustand === 'gesperrt'
            ? '—'
            : '',
      notiz:
        meldungen.zustand === 'daten'
          ? meldungenNotiz(meldungen.zahl)
          : meldungen.zustand === 'gesperrt'
            ? NICHT_FREIGEGEBEN
            : '',
      ton:
        meldungen.zustand === 'daten' && meldungen.zahl.bestaetigung_ueberfaellig > 0
          ? 'alarm'
          : 'neutral',
      zustand: zZaehlstand(meldungen),
      ziel: meldungen.zustand === 'gesperrt' ? undefined : ziele?.meldungen,
    },
    {
      titel: 'Lagebericht',
      // `stand` ist ein UTC-Wirestring ohne Zonenkennung; die Zone hängt an den Konventionen.
      wert: berichteGesperrt
        ? '—'
        : fuehrung?.bericht
          ? zeitKurz(fuehrung.bericht.stand, konv)
          : 'keiner',
      notiz: berichteGesperrt
        ? NICHT_FREIGEGEBEN
        : fuehrung?.bericht
          ? `${fuehrung.bericht.statusLabel} · ${fuehrung.bericht.titel}`
          : 'noch nicht erstellt',
      ton: 'neutral',
      zustand: zQuelle(q.lageberichte),
      ziel: berichteGesperrt
        ? undefined
        : fuehrung?.bericht
          ? ziele?.lagebericht(fuehrung.bericht.id)
          : ziele?.lageberichte,
    },
    {
      titel: 'UHS aktiv',
      wert: uhsGesperrt ? '—' : (fuehrung?.uhsAktiv ?? ''),
      notiz: uhsGesperrt
        ? NICHT_FREIGEGEBEN
        : `${fuehrung?.uhsGeplant ?? 0} geplant · ${kraefteText(fuehrung?.uhsKraefte ?? 0)}`,
      ton: 'neutral',
      zustand: zQuelle(q.uhs),
      ziel: uhsGesperrt ? undefined : ziele?.uhs,
    },
  ];
}
