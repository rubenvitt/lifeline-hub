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

export function zeigeRueckgaengig(api: MessageInstance, text: string, aufRueckgaengig: () => void) {
  // Lokal statt State: der Toast lebt außerhalb des React-Baums des Auslösers.
  let verbraucht = false;
  api.open({
    key: SCHLUESSEL,
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
            api.destroy(SCHLUESSEL);
          }}
        >
          Rückgängig
        </Button>
      </Space>
    ),
  });
}
