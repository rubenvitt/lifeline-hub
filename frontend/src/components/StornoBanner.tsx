import { Alert, Input } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { cloneElement, type ReactElement } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { uhrzeit, zeitKurz } from '../anzeige/zeitDarstellung';

/** Storno-Stand eines Datensatzes, wie ihn Detail oder Stand-Abfrage liefern (`StornoStand`). */
export interface StornoStandAnzeige {
  storniert_at?: string | null;
  storniert_von_name?: string | null;
}

/**
 * Wortlaut des Storno-Banners (LLH-1832, Spec `storno-sperre`, „Das Banner nennt, wer storniert
 * hat und wann“): „Storniert von {Name} um {Uhrzeit}“, an einem anderen Tag „am {Tag} {Uhrzeit}“
 * (Rolle „kurz“ der Zeitdarstellung); ohne bekannten Namen (Storno vor 0355) ohne „von …“.
 * `null`, solange nicht storniert.
 */
export function stornoText(
  stand: StornoStandAnzeige,
  konv: AnzeigeKonventionen,
  jetzt: Dayjs | number = Date.now(),
): string | null {
  if (!stand.storniert_at) return null;
  const kurz = zeitKurz(stand.storniert_at, konv, jetzt);
  const heute = kurz === uhrzeit(stand.storniert_at, konv);
  const wann = `${heute ? 'um' : 'am'} ${kurz}`;
  return stand.storniert_von_name
    ? `Storniert von ${stand.storniert_von_name} ${wann}`
    : `Storniert ${wann}`;
}

interface StornoBannerProps {
  /** Stand aus Detail oder Stand-Abfrage; ohne `storniert_at` rendert der Banner nichts. */
  stand: StornoStandAnzeige | null | undefined;
}

/**
 * Banner einer gesperrten Detailseite, deren Datensatz storniert ist (LLH-1832, Spec
 * `storno-sperre`). Steht oben im Hinweis-Slot der Seite, als Warnfläche (`Alert` auf der
 * Statusfläche, `frontend/AGENTS.md`, „Hinweisflächen sind Statusflächen“) und `role="status"`,
 * damit Hilfstechnik den Wechsel ansagt. Die Sperre selbst leitet die Seite aus demselben Stand ab.
 */
export function StornoBanner({ stand }: StornoBannerProps) {
  const { konventionen } = useAnzeigeKonventionen();
  const text = stand ? stornoText(stand, konventionen, dayjs()) : null;
  if (text === null) return null;
  return (
    <div data-lfh="storno-banner">
      <Alert type="warning" showIcon role="status" title={text} />
    </div>
  );
}

/**
 * Ein Eingabeelement eines offenen Bearbeiten-Formulars, nachdem der Datensatz storniert wurde
 * (LLH-1832, Spec `storno-sperre`, „Eine offene Eingabe bleibt beim Sperren lesbar“): Textfelder
 * werden `readOnly`, damit ihr Text markier- und kopierbar bleibt; alles andere (Auswahl, Zahl,
 * Ort) wird `disabled`.
 */
export function entwurfNurLesen<P extends { readOnly?: boolean; disabled?: boolean }>(
  input: ReactElement<P>,
): ReactElement<P> {
  const istText = input.type === Input || input.type === Input.TextArea;
  return cloneElement(input, (istText ? { readOnly: true } : { disabled: true }) as Partial<P>);
}
