/**
 * Aktionen einer Karte als Daten (LLH-1598, Spec `datensatz-aktionsmenue`, „Eine Karte mit mehreren
 * Knöpfen zeigt alle ihre Handlungen“; `openspec/changes/g11xq51l-kontextmenue-karten/design.md` D3).
 *
 * Eine Karte, die ihre Knöpfe selbst zeichnet, beschreibt ihre Handlungen EINMAL als geordnete
 * Liste: erst die Knöpfe der Aktionszeile, dann die Einträge ihres ⋮. Knopfzeile, ⋮ und
 * Kontextmenü (`useKartenKontext`) entstehen daraus; eine zweite Liste fürs Kontextmenü gibt es
 * nicht. Sprünge und Auswahlfelder gehören nicht hinein.
 */
import type { MenueEintrag } from './MenueAusloeser';

export interface KartenAktion<K extends string = string> extends MenueEintrag<K> {
  onWahl: () => void;
  /**
   * Fragt der Knopf vorher nach (Popconfirm)? Im Kontextmenü dieselbe Rückfrage im Dialog (Spec
   * „Rückfrage im Dialog, nicht im Menü“).
   */
  rueckfrage?: { titel: string; knopf: string; gefahr?: true };
  /**
   * Grund einer Sperre, den die Karte sichtbar neben dem Knopf zeigt; im Menü hängt er am
   * Etikett (Muster LFH-966). Ein ⋮-Eintrag, der den Grund schon im Etikett trägt, braucht ihn nicht.
   */
  sperrgrund?: string;
}

/** Menüeinträge des Kontextmenüs: dieselbe Reihenfolge, Grund einer Sperre am Etikett. */
export function kartenKontextEintraege<K extends string>(
  aktionen: readonly KartenAktion<K>[],
): MenueEintrag<K>[] {
  return aktionen.map(({ key, label, gefahr, icon, gesperrt, sperrgrund }) => ({
    key,
    label: gesperrt && sperrgrund ? `${label} (${sperrgrund})` : label,
    ...(gefahr ? { gefahr } : {}),
    ...(icon != null ? { icon } : {}),
    ...(gesperrt ? { gesperrt } : {}),
  }));
}

interface Rueckfrage {
  confirm: (config: {
    title: string;
    okText: string;
    cancelText: string;
    okButtonProps?: { danger: true };
    onOk: () => void;
  }) => unknown;
}

/**
 * Führt die Wahl aus; eine Aktion mit `rueckfrage` fragt erst im Dialog. Beim OK zählt der Stand
 * von `aktuelle()`, nicht der beim Öffnen: ist die Aktion inzwischen weggefallen oder gesperrt
 * (Live-Ereignis, anderer Platz), löst die Bestätigung nichts aus, wie ein `Popconfirm`, das mit
 * seinem Knopf verschwindet (LLH-1598, Befund aus dem Review).
 */
export function fuehreKartenWahlAus<K extends string>(
  aktionen: readonly KartenAktion<K>[],
  key: string,
  modal: Rueckfrage,
  aktuelle: () => readonly KartenAktion<K>[] = () => aktionen,
): void {
  const aktion = aktionen.find((a) => a.key === key);
  if (aktion == null || aktion.gesperrt) return;
  if (aktion.rueckfrage == null) {
    aktion.onWahl();
    return;
  }
  modal.confirm({
    title: aktion.rueckfrage.titel,
    okText: aktion.rueckfrage.knopf,
    cancelText: 'Abbrechen',
    ...(aktion.rueckfrage.gefahr ? { okButtonProps: { danger: true as const } } : {}),
    onOk: () => {
      const jetzt = aktuelle().find((a) => a.key === key);
      if (jetzt != null && !jetzt.gesperrt) jetzt.onWahl();
    },
  });
}
