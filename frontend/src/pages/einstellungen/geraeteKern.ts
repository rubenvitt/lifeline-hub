/**
 * Reiner Kern der Geräte-Sektion (LFH-892). Basename bewusst nicht `EinsatzGeraete.ts`
 * (Kollisionsregel `direkteinstiegKern`).
 */
import dayjs, { type Dayjs } from 'dayjs';
import type {
  AnsichtSperre,
  Funktionsansicht,
  KopplungAnzeige,
  KopplungStatus,
} from '../../api/types';

/** Anzeigename je Ansicht, in Bedienreihenfolge der Auswahl. Exhaustiv über das Enum. */
export const ANSICHT_LABEL: Record<Funktionsansicht, string> = {
  'uhs-tablet': 'UHS-Tablet',
  'uhs-laptop': 'UHS-Laptop',
  lagemonitor: 'Lagemonitor',
};

/** Was eine Ansicht kann, ein Satz je Ansicht für die Auswahl. */
export const ANSICHT_ZWECK: Record<Funktionsansicht, string> = {
  'uhs-tablet': 'Aufnahme, Patienten und Grundriss einer UHS.',
  'uhs-laptop': 'Wie das Tablet, dazu Plätze, Material und Meldungen der UHS.',
  lagemonitor: 'Verdichtetes Lagebild für den Führungsraum, ohne Personendaten.',
};

/** Ob die Ansicht an genau eine UHS gebunden ist (Spiegel von `ist_stellengebunden`). */
export function istStellengebunden(ansicht: Funktionsansicht): boolean {
  return ansicht === 'uhs-tablet' || ansicht === 'uhs-laptop';
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

/** Gesperrte Module der Ansicht, als Satz für die Kopplungsmaske; `null` ohne Sperre. */
export function sperrSatz(
  sperren: readonly AnsichtSperre[],
  ansicht: Funktionsansicht | undefined,
  modulName: (key: string) => string,
): string | null {
  if (!ansicht) return null;
  const module = sperren.find((s) => s.ansicht === ansicht)?.gesperrte_module ?? [];
  if (module.length === 0) return null;
  const namen = module.map(modulName).join(', ');
  return `In diesem Einsatz ${module.length === 1 ? 'ist' : 'sind'} ${namen} für einfache Mitglieder gesperrt. Ein ${ANSICHT_LABEL[ansicht]} könnte ${module.length === 1 ? 'dieses Modul' : 'diese Module'} nicht nutzen.`;
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
