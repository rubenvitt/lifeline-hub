/**
 * Reiner Kern der Geräte-Sektion (LFH-892). Basename bewusst nicht `EinsatzGeraete.ts`
 * (Kollisionsregel `direkteinstiegKern`).
 */
import dayjs, { type Dayjs } from 'dayjs';
import type {
  AnsichtAuswahl,
  AnsichtSperre,
  Funktionsansicht,
  KopplungAnzeige,
  KopplungStatus,
  Bindungsart,
} from '../../api/types';

/** Anzeigename je Ansicht, in Bedienreihenfolge der Auswahl. Exhaustiv über das Enum. */
export const ANSICHT_LABEL: Record<Funktionsansicht, string> = {
  'uhs-tablet': 'UHS-Tablet',
  'uhs-laptop': 'UHS-Laptop',
  lagemonitor: 'Lagemonitor',
  betreuungsstelle: 'Betreuungsstelle',
  bereitstellungsraum: 'Bereitstellungsraum',
  einsatzabschnitt: 'Einsatzabschnitt',
  verpflegung: 'Verpflegung',
};

/** Was eine Ansicht kann, in wenigen Fachwörtern für die Auswahl (kein Satz, LFH-1078). */
export const ANSICHT_ZWECK: Record<Funktionsansicht, string> = {
  'uhs-tablet': 'Aufnahme, Patienten, Grundriss einer UHS',
  'uhs-laptop': 'Wie Tablet, dazu Plätze, Material, Meldungen',
  lagemonitor: 'Verdichtetes Lagebild, ohne Personendaten',
  betreuungsstelle: 'Belegung, Betroffene, Meldungen einer Betreuungsstelle',
  bereitstellungsraum: 'Kräfte an- und abmelden in einem Bereitstellungsraum',
  einsatzabschnitt: 'Kräfte, Aufträge, Meldungen eines Abschnitts',
  verpflegung: 'Portionen je Zeitfenster ausgeben',
};

/** Feld der Kopplungsmaske je Stellenart: Beschriftung, Platzhalter, leere Auswahl. */
export const STELLENART_FELD: Record<
  Bindungsart,
  { label: string; platzhalter: string; leer: string }
> = {
  uhs: {
    label: 'Unfallhilfsstelle',
    platzhalter: 'UHS wählen',
    leer: 'Keine UHS in diesem Einsatz',
  },
  betreuungsstelle: {
    label: 'Betreuungsstelle',
    platzhalter: 'Betreuungsstelle wählen',
    leer: 'Keine Betreuungsstelle in diesem Einsatz',
  },
  bereitstellungsraum: {
    label: 'Bereitstellungsraum',
    platzhalter: 'Bereitstellungsraum wählen',
    leer: 'Kein Bereitstellungsraum in diesem Einsatz',
  },
  einsatzabschnitt: {
    label: 'Einsatzabschnitt',
    platzhalter: 'Abschnitt wählen',
    leer: 'Kein Abschnitt in diesem Einsatz',
  },
};

/**
 * Art der Stelle, an die die Ansicht gebunden ist, laut der Übersicht des Servers
 * (`GeraeteUebersicht.ansichten`); `null` ohne Stellenbindung oder für eine Ansicht, die der
 * Server nicht anbietet.
 */
export function stellenartVon(
  ansichten: readonly AnsichtAuswahl[],
  ansicht: Funktionsansicht | undefined,
): Bindungsart | null {
  if (!ansicht) return null;
  return ansichten.find((a) => a.ansicht === ansicht)?.stellenart ?? null;
}

/** Eine wählbare Stelle der Kopplungsmaske. */
export interface StellenOption {
  value: number;
  label: string;
}

/** Wählbar wie beim Server (`stelle_pruefen`): keine stornierte, keine aufgelöste UHS und kein
 *  aufgelöster Bereitstellungsraum; eine geschlossene Betreuungsstelle bleibt wählbar. */
export function stellenOptionen(
  quellen: {
    uhs?: readonly {
      id: number;
      bezeichnung: string;
      status: string;
      storniert_at?: string | null;
    }[];
    betreuungsstellen?: readonly {
      id: number;
      bezeichnung: string;
      storniert_at?: string | null;
    }[];
    bereitstellungsraeume?: readonly {
      id: number;
      bezeichnung: string;
      status: string;
      storniert_at?: string | null;
    }[];
    abschnitte?: readonly { id: number; name: string }[];
  },
  art: Bindungsart,
): StellenOption[] {
  const benutzbar = (s: { status?: string; storniert_at?: string | null }) =>
    !s.storniert_at && s.status !== 'aufgeloest';
  switch (art) {
    case 'uhs':
      return (quellen.uhs ?? [])
        .filter(benutzbar)
        .map((u) => ({ value: u.id, label: u.bezeichnung }));
    case 'betreuungsstelle':
      return (quellen.betreuungsstellen ?? [])
        .filter((s) => !s.storniert_at)
        .map((s) => ({ value: s.id, label: s.bezeichnung }));
    case 'bereitstellungsraum':
      return (quellen.bereitstellungsraeume ?? [])
        .filter(benutzbar)
        .map((b) => ({ value: b.id, label: b.bezeichnung }));
    case 'einsatzabschnitt':
      return (quellen.abschnitte ?? []).map((a) => ({ value: a.id, label: a.name }));
  }
}

/** Zustand als Wort; die Farbe trägt keine Aussage allein (WCAG 1.4.1). */
export const STATUS_WORT: Record<KopplungStatus, string> = {
  wartend: 'wartet auf Gerät',
  aktiv: 'gekoppelt',
  abgelaufen: 'abgelaufen',
  widerrufen: 'widerrufen',
};

/** Ob die Einsatzleitung an der Kopplung noch etwas tun kann. Eine abgelaufene lässt sich
 *  verlängern und neu ausstellen, eine widerrufene nicht. */
export function istBeendet(k: Pick<KopplungAnzeige, 'status'>): boolean {
  return k.status === 'widerrufen';
}

/** Gesperrte Module der Ansicht, als kurze Zeile für die Kopplungsmaske; `null` ohne Sperre. */
export function sperrSatz(
  sperren: readonly AnsichtSperre[],
  ansicht: Funktionsansicht | undefined,
  modulName: (key: string) => string,
): string | null {
  if (!ansicht) return null;
  const module = sperren.find((s) => s.ansicht === ansicht)?.gesperrte_module ?? [];
  if (module.length === 0) return null;
  const namen = module.map(modulName).join(', ');
  const fehlt = module.length === 1 ? 'fehlt' : 'fehlen';
  return `${namen} für einfache Mitglieder gesperrt – ${fehlt} auf dem ${ANSICHT_LABEL[ansicht]}`;
}

/** Code in Vierergruppen („ABCD-1234"), wie er sich vorlesen lässt. */
export function codeGruppiert(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Höchste Kopplungsdauer ab jetzt (Spiegel von `HOECHSTENS_STUNDEN`). */
export const HOECHSTENS_STUNDEN = 72;

/** Vorbelegung beim Verlängern: 24 Stunden ab jetzt, auf die Minute. */
export function verlaengernVorbelegung(jetzt: Dayjs = dayjs()): Dayjs {
  return jetzt.add(24, 'hour').startOf('minute');
}

/** Prüft ein gewünschtes Ende wie der Server: in der Zukunft, höchstens 72 h ab jetzt. */
export function endeFehler(ende: Dayjs | null | undefined, jetzt: Dayjs = dayjs()): string | null {
  if (!ende) return 'Ende angeben';
  if (!ende.isAfter(jetzt)) return 'Das Ende muss in der Zukunft liegen';
  if (ende.isAfter(jetzt.add(HOECHSTENS_STUNDEN, 'hour'))) {
    return `Höchstens ${HOECHSTENS_STUNDEN} Stunden ab jetzt`;
  }
  return null;
}
