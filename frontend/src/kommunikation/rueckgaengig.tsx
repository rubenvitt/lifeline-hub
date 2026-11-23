import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

/**
 * Direktaktion mit Rückgängig-Weg: ein Klick statt Knopf + `Popconfirm`, ein zweiter nur,
 * wenn es der falsche war.
 *
 * Kein Erfolgs-Toast im Sinn von EEMUA 191: ein handlungsfähiger Toast erscheint nur nach einer
 * Nutzeraktion, nie nach einem Live-Ereignis, und ersetzt eine Rückfrage.
 *
 * Nur dort zeigen, wo der Server einen Rückweg hat — ein Rückgängig-Knopf, der 422 liefert,
 * ist schlechter als keiner.
 */

/** Wie lange der Rückgängig-Weg offensteht. Antds Vorgabe (3 s) ist für eine
 *  Kenntnisnahme gedacht; hier ist eine Entscheidung zu treffen. */
const DAUER_S = 6;

/**
 * Fester Schlüssel: eine zweite Aktion ERSETZT den stehenden Toast. Zwei gleichzeitig sichtbare
 * Rückwege sagten nicht, welcher zu welchem Datensatz gehört.
 */
const SCHLUESSEL = 'lfh-rueckgaengig';

/**
 * Schließt den stehenden Rückgängig-Hinweis, wenn derselbe Rückweg an anderer Stelle gewählt
 * wurde (etwa „Rückgängig“ in der gehaltenen Zeile, LLH-1924): sonst schriebe sein Knopf die
 * Rücknahme ein zweites Mal.
 */
export function schliesseRueckgaengig(api: MessageInstance) {
  api.destroy(SCHLUESSEL);
}

export function zeigeRueckgaengig(
  api: MessageInstance,
  text: string,
  aufRueckgaengig: () => void,
  schluessel: string = SCHLUESSEL,
) {
  // Lokal statt State: der Toast lebt außerhalb des React-Baums des Auslösers.
  let verbraucht = false;
  api.open({
    key: schluessel,
    type: 'success',
    duration: DAUER_S,
    content: (
      <Space>
        <span>{text}</span>
        <Button
          type="link"
          onClick={() => {
            // Ein zweiter Klick schriebe denselben Status noch einmal, samt Invalidierung und Live-Ereignis.
            if (verbraucht) return;
            verbraucht = true;
            aufRueckgaengig();
            api.destroy(schluessel);
          }}
        >
          Rückgängig
        </Button>
      </Space>
    ),
  });
}

/** Statusarten mit Quittung und Rückweg (LLH-1781 Fahrzeug, LLH-1986 die übrigen). */
export type StatusArt = 'fahrzeug' | 'personal' | 'material' | 'einheit';

/**
 * Quittung nach einem Statuswechsel (LLH-1781, LLH-1986; Regel `kraefte/AGENTS.md`, „Quittung und
 * Rücknahme eines Statuswechsels“): „85-1: S2 → S3 · Rückgängig“. Eigener Schlüssel je Art und
 * Kraft: zwei schnelle Wechsel an zwei Kräften überschreiben sich nicht, auch nicht bei gleicher
 * ID verschiedener Arten; ein zweiter Wechsel an derselben ersetzt den ersten. antds `message`
 * nimmt keinen Fokus, die Hand bleibt also an der Zeile oder Kachel.
 */
export function zeigeStatusQuittung(
  api: MessageInstance,
  q: { art: StatusArt; id: number; name: string; vorher: string; neu: string },
  aufRueckgaengig: () => void,
) {
  zeigeRueckgaengig(
    api,
    statusQuittungText(q),
    aufRueckgaengig,
    statusQuittungSchluessel(q.art, q.id),
  );
}

export function statusQuittungText(q: { name: string; vorher: string; neu: string }): string {
  return `${q.name}: ${q.vorher} → ${q.neu}`;
}

export function statusQuittungSchluessel(art: StatusArt, id: number): string {
  return `lfh-status-quittung-${art}-${id}`;
}
