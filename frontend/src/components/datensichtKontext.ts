/**
 * Einträge des Kontextmenüs einer `Datensicht`-Zeile (LLH-1596, design.md D6): dieselbe Quelle wie
 * Primärknopf und ⋮-Menü der Zeile, keine zweite Liste.
 */
import type { MenueEintrag } from './MenueAusloeser';
import type { PrimaerAktion, WeitereAktionen } from './Datensicht';

/** Schlüssel der Primäraktion im Kontextmenü; kein `weitere`-Schlüssel darf so heißen. */
export const PRIMAER_SCHLUESSEL = '__primaer';

export interface ZeilenAktionen<T> {
  aktion?: PrimaerAktion<T>;
  weitere?: WeitereAktionen<T>;
}

/**
 * Primäraktion (wenn gesetzt und für die Zeile sichtbar) vor den `weitere`-Einträgen. Läuft eine
 * Aktion aus dem ⋮-Menü, stehen dessen Einträge gesperrt da (der Auslöser ist dann gesperrt); die
 * Primäraktion bleibt wählbar wie ihr Knopf. Leere Liste ⇒ kein Menü, das Browsermenü bleibt.
 */
export function kontextEintraege<T>(
  { aktion, weitere }: ZeilenAktionen<T>,
  zeile: T,
): MenueEintrag[] {
  const eintraege: MenueEintrag[] = [];
  if (aktion && (aktion.sichtbar?.(zeile) ?? true)) {
    eintraege.push({ key: PRIMAER_SCHLUESSEL, label: aktion.etikett });
  }
  if (weitere) {
    const laeuft = weitere.laeuft?.(zeile) ?? false;
    for (const e of weitere.eintraege(zeile)) {
      eintraege.push(laeuft ? { ...e, gesperrt: true } : e);
    }
  }
  return eintraege;
}

/** Name des Menüs für Hilfstechnik: der des ⋮-Auslösers, sonst ein allgemeiner. */
export function kontextName<T>({ weitere }: ZeilenAktionen<T>, zeile: T): string {
  return weitere?.zugaenglicherName(zeile) ?? 'Aktionen';
}

interface Rueckfrage {
  confirm: (config: {
    title: string;
    okText: string;
    okButtonProps?: { danger: true };
    onOk: () => void;
  }) => unknown;
}

/**
 * Führt die Wahl aus. Die Primäraktion fragt wie ihr Knopf nach, wenn sie `bestaetigung` trägt, im
 * Dialog statt in einer Blase am Menü (Spec `datensatz-aktionsmenue`, „Rückfrage im Dialog“).
 */
export function fuehreKontextWahlAus<T>(
  { aktion, weitere }: ZeilenAktionen<T>,
  zeile: T,
  key: string,
  modal: Rueckfrage,
): void {
  if (key === PRIMAER_SCHLUESSEL) {
    if (!aktion) return;
    if (aktion.bestaetigung == null) {
      aktion.onKlick(zeile);
      return;
    }
    modal.confirm({
      title: aktion.bestaetigung,
      okText: aktion.bestaetigungKnopf ?? aktion.etikett,
      ...(aktion.bestaetigungGefahr ? { okButtonProps: { danger: true as const } } : {}),
      onOk: () => aktion.onKlick(zeile),
    });
    return;
  }
  weitere?.onWahl(key, zeile);
}
