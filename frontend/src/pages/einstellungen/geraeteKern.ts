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
  verpflegung: 'Portionen je Zeitfenster ausgeben, Fehlmenge melden',
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
  verpflegungsstelle: {
    label: 'Verpflegungsstelle',
    platzhalter: 'Verpflegungsstelle wählen',
    leer: 'Keine Verpflegungsstelle in diesem Einsatz',
  },
};

/** Das Stellenfeld der Kopplungsmaske: die Art der Stelle und ob sie Pflicht ist. */
export interface StellenFeld {
  art: Bindungsart;
  /** `false`: wahlweise (Verpflegung, LLH-1048); ohne Stelle koppelt das Gerät einsatzweit. */
  pflicht: boolean;
}

/**
 * Das Stellenfeld der Ansicht laut der Übersicht des Servers (`GeraeteUebersicht.ansichten`,
 * `stellenart` und `stelle_pflicht`); `null` ohne Stellenbindung (Lagemonitor) und für eine
 * Ansicht, die der Server nicht anbietet.
 */
export function stellenFeldVon(
  ansichten: readonly AnsichtAuswahl[],
  ansicht: Funktionsansicht | undefined,
): StellenFeld | null {
  if (!ansicht) return null;
  const auswahl = ansichten.find((a) => a.ansicht === ansicht);
  if (!auswahl?.stellenart) return null;
  return { art: auswahl.stellenart, pflicht: auswahl.stelle_pflicht };
}

/**
 * Wert der Option „ohne Stelle (einsatzweit)“ einer wahlweisen Stelle. Eine eigene Option statt
 * eines Löschkreuzes: das Kreuz ist mit Handschuh kein Ziel, und die Vorgabe steht sichtbar.
 */
export const OHNE_STELLE = 'einsatzweit';
export const OHNE_STELLE_LABEL = 'ohne Stelle (einsatzweit)';

/** Wert des Stellenfelds: eine Kennung oder, bei wahlweiser Stelle, {@link OHNE_STELLE}. */
export type StellenWert = number | typeof OHNE_STELLE;

/** Die `stelle_id` der neuen Kopplung; `null` ohne Stellenfeld und für „ohne Stelle“. */
export function stelleIdAusWahl(
  feld: StellenFeld | null,
  wert: StellenWert | null | undefined,
): number | null {
  if (!feld || wert == null || wert === OHNE_STELLE) return null;
  return wert;
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
    verpflegungsstellen?: readonly { id: number; bezeichnung: string; status: string }[];
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
    case 'verpflegungsstelle':
      // `stellen` aus `GET …/verpflegung` kommt ohne stornierte; aufgelöst lehnt der Server ab.
      return (quellen.verpflegungsstellen ?? [])
        .filter(benutzbar)
        .map((s) => ({ value: s.id, label: s.bezeichnung }));
  }
}

/** Zustand als Wort; die Farbe trägt keine Aussage allein (WCAG 1.4.1). */
export const STATUS_WORT: Record<KopplungStatus, string> = {
  wartend: 'wartet auf Gerät',
  aktiv: 'gekoppelt',
  abgelaufen: 'abgelaufen',
  widerrufen: 'widerrufen',
};

/** Ob die Einsatzleitung an der Kopplung nichts mehr tun kann. Eine abgelaufene ist so zu Ende
 *  wie eine widerrufene: der Server lehnt Verlängern und neuen Code für beide ab
 *  (`fordere_offen` in `src/geraet/repo.rs`, LFH-1143); für das Gerät gibt es eine neue Kopplung. */
export function istBeendet(k: Pick<KopplungAnzeige, 'status'>): boolean {
  return k.status === 'widerrufen' || k.status === 'abgelaufen';
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
  return `${namen} für gekoppelte Geräte gesperrt – ${fehlt} auf dem ${ANSICHT_LABEL[ansicht]}`;
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
