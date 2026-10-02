/**
 * Dreipunkt-Auslöser für GEBÜNDELTE Datensatz-Aktionen (LFH-365, Baustein seit LFH-683).
 *
 * Regel: `frontend/AGENTS.md`, „Aktionen" → „Datensatz-Aktionen werden gebündelt"; Anforderungen:
 * `openspec/specs/datensatz-aktionsmenue/spec.md`. Der Baustein trägt die Mechanik genau einmal:
 * icon-only `type="text"`, Zeichen in `aria-hidden`-Hülle, `trigger={['click']}`, `autoFocus`,
 * Zuordnung am Menü, Gefahr hinter EINEM Trenner, kein Auslöser ohne Einträge. WANN gebündelt wird
 * (ab drei, nach Rechteprüfung), entscheidet der Aufrufer.
 *
 * Neue Kopien verhindert `menueAusloeser.guard.test.ts`.
 */
import { Button, Dropdown, type MenuProps } from 'antd';
import type { ReactNode } from 'react';
import { IconPunkteSenkrecht } from '../icons';

/** Ein Eintrag des gebündelten Menüs. */
export interface MenueEintrag<K extends string = string> {
  key: K;
  /**
   * Nur Text: ein Etikett aus Knoten war das Einfallstor für eine Rückfrage-Blase im Menü. Eine
   * Rückfrage gehört in ein `<Modal>` beim Aufrufer.
   */
  label: string;
  /**
   * Unumkehrbares (Stornieren): der Eintrag wird rot und steht hinter einem Trenner, der Trennung,
   * die in einer Knopfreihe der Abstand wäre.
   */
  gefahr?: true;
  icon?: ReactNode;
  /** Gerade nicht möglich, aber sein Fehlen verwirrte (oberster Pegel: „Nach oben"). */
  gesperrt?: true;
}

/** Menüeinträge für antd: die Gefahr hinter einem Trenner, sonst in Lieferreihenfolge. */
export function menueEintraege(eintraege: readonly MenueEintrag[]): MenuProps['items'] {
  const eintrag = (e: MenueEintrag) => ({
    key: e.key,
    label: e.label,
    ...(e.icon != null ? { icon: e.icon } : {}),
    ...(e.gesperrt ? { disabled: true } : {}),
    ...(e.gefahr ? { danger: true } : {}),
  });
  const neutral = eintraege.filter((e) => !e.gefahr);
  const gefahr = eintraege.filter((e) => e.gefahr);
  return [
    ...neutral.map(eintrag),
    ...(neutral.length > 0 && gefahr.length > 0 ? [{ type: 'divider' as const }] : []),
    ...gefahr.map(eintrag),
  ];
}

export interface MenueAusloeserProps<K extends string = string> {
  /** Nach Rechte- und Zustandsprüfung. Leer ⇒ kein Auslöser. */
  eintraege: readonly MenueEintrag<K>[];
  /** MIT Kennung des Datensatzes („Aktionen zu Stelle Turnhalle Nord"). */
  zugaenglicherName: string;
  onWahl: (key: K) => void;
  gesperrt?: boolean;
  /** Eine ausgelöste Aktion läuft noch; zeigt sich am Auslöser. */
  laeuft?: boolean;
}

export function MenueAusloeser<K extends string = string>({
  eintraege,
  zugaenglicherName,
  onWahl,
  gesperrt,
  laeuft,
}: MenueAusloeserProps<K>) {
  if (eintraege.length === 0) return null;
  return (
    /*
     * RIEGEL GEGEN PORTAL-AUFSTEIGEN (LFH-367/B5g, gemessen in `docs/leitlinien/
     * bedien-leitlinie-herleitungen.md`). Das Menü liegt im DOM unter `document.body`, sein Klick
     * steigt aber durch den KOMPONENTENbaum zu jedem Vorfahren auf (Zeile öffnen, Chip bearbeiten);
     * ein Riegel im `menu.onClick` kommt zu spät und feuert für das Polster gar nicht. Gestoppt wird
     * genau, was nicht aus dem eigenen DOM-Teilbaum kommt; der Auslöser reicht weiter durch.
     *
     * Nur `click`: React stoppt dabei auch das native Event am Portal-Container, und rc-dropdown
     * hört Escape (`keydown`) am `window`. `pointerdown` bleibt ebenso frei (Dokument-Hörer in
     * `etb/Schnellerfassung.tsx`, `components/zugPointerSensor.ts`). Ein Klick im Menü erreicht
     * `document`/`window` damit nicht mehr; dort hört im Frontend niemand auf `click` (geprüft
     * LFH-683). Wer einen solchen Hörer einführt, hört in der Capture-Phase.
     */
    <span
      style={{ display: 'inline-flex' }}
      onClick={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) event.stopPropagation();
      }}
    >
      <Dropdown
        trigger={['click']}
        // Ohne `autoFocus` bleibt der Fokus am Auslöser, und die Pfeiltasten heben im Menü nichts
        // hervor. In jsdom nicht beobachtbar; belegt im Browser (`e2e/etb-chronologie.spec.ts`,
        // „LFH-683: Menüauslöser per Tastatur“).
        autoFocus
        disabled={gesperrt}
        menu={{
          items: menueEintraege(eintraege),
          // Zuordnung am Menü, nicht je Eintrag: die Einträge bleiben reine Beschreibung.
          onClick: ({ key }) => onWahl(key as K),
        }}
      >
        {/* Kein `size`: die Höhe kommt aus `controlHeight` und zieht mit der Dichtestufe mit. */}
        <Button
          type="text"
          disabled={gesperrt}
          loading={laeuft}
          aria-label={zugaenglicherName}
          icon={
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <IconPunkteSenkrecht />
            </span>
          }
        />
      </Dropdown>
    </span>
  );
}
