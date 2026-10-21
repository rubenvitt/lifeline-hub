import dayjs from 'dayjs';
import type { FormInstance } from 'antd';
import { alsBackendZeit } from '../anzeige/zeitEingabe';

/**
 * Stand der Übernahme je Abschnitt (LLH-1357, Spec `lagevortrag-uebernahme`): wann der Text eines
 * Abschnitts mit Quelle zuletzt übernommen wurde. Er reist als `uebernommen_at` im Abschnitt
 * (`LageberichtAbschnitt`), das Fortschreiben trägt ihn mit dem Text in die neue Fassung. Gesetzt
 * wird er nur hier im Client, im Moment der Übernahme: Einzelübernahme, Sammelfüllung und
 * Startinhalt.
 */

/**
 * Formularfeld der Stände: `['uebernommen_at', <schlüssel>]`, neben den Abschnitten als Feldern der
 * obersten Ebene. Kein Abschnitt einer Vorlage heißt so (`standFeld.test.ts`).
 */
export const UEBERNOMMEN_FIELD = 'uebernommen_at';

export type Staende = Record<string, string | undefined>;

/** Name des Formularfelds für den Stand eines Abschnitts. */
export function standFeld(schluessel: string): [typeof UEBERNOMMEN_FIELD, string] {
  return [UEBERNOMMEN_FIELD, schluessel];
}

/** Jetzt im Wire-Format (UTC ohne Zonenkennung), wie jede Zeit an den Server. */
export function standJetzt(): string {
  return alsBackendZeit(dayjs());
}

/**
 * Stammt der Stand aus der Vorfassung? Ja, wenn der Entwurf fortgeschrieben ist (`grenze` = sein
 * `erstellt_at`, sonst `undefined`) und der Stand davor liegt: fortgeschrieben wird nur
 * Freigegebenes, jeder ältere Stand entstand also vor der Freigabe der Vorfassung. Beide im
 * Wire-Format, daher genügt der Textvergleich.
 */
export function isAusVorfassung(stand: string, grenze: string | undefined): boolean {
  return grenze != null && stand < grenze;
}

const isLeer = (wert: unknown) => !(typeof wert === 'string' && wert.trim() !== '');

/**
 * Ein ganz geleerter Abschnitt verliert seinen Stand, damit ein danach getippter eigener Text
 * keinen fremden trägt (der Server verwirft ihn an einem leeren Abschnitt ebenso). Für
 * `onValuesChange` der Seite: `geaendert` sind die eben getippten Felder.
 */
export function verwerfeStandGeleerter(
  form: FormInstance,
  geaendert: Record<string, unknown>,
): void {
  for (const [schluessel, wert] of Object.entries(geaendert)) {
    if (schluessel === UEBERNOMMEN_FIELD || !isLeer(wert)) continue;
    if (form.getFieldValue(standFeld(schluessel)) != null) {
      form.setFieldValue(standFeld(schluessel), undefined);
    }
  }
}
