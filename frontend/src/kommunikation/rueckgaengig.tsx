import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

/**
 * Direktaktion mit Rückgängig-Weg (LFH-343 · C8, Befund H50).
 *
 * ── WARUM ─────────────────────────────────────────────────────────────
 *
 * Jede Routine-Statusaktion der vier Kommunikations-Karten kostete zwei Klicks:
 * einen auf den Knopf, einen auf das „Bestätigen" des `Popconfirm`. Bei ~40
 * Meldungen je Schicht sind das ~40 reine Bestätigungsklicks nur fürs Sichten.
 * Dieser Weg kostet einen — und einen zweiten nur dann, wenn es der falsche war.
 *
 * ── ER IST KEIN ERFOLGS-TOAST ─────────────────────────────────────────
 *
 * CLAUDE.md führt EEMUA 191 gegen eine Meldung alle 30 s (Autosave). Der
 * Unterschied ist nicht die Häufigkeit, sondern die Art: ein **handlungsfähiger**
 * Toast ist ein Bedienelement mit begrenzter Lebensdauer, keine Zustandsmeldung.
 * Er erscheint nur nach einer Nutzeraktion, nie nach einem Live-Ereignis, und er
 * ersetzt eine Rückfrage, die vorher zwei Interaktionen kostete — die Zahl der
 * Unterbrechungen sinkt, sie steigt nicht.
 *
 * ── ER WIRD NUR GEZEIGT, WO DER RÜCKWEG EXISTIERT ─────────────────────
 *
 * Gemessen am 21.08.2026 hatte im Bestand nur die Meldung einen (`setze_status`
 * ohne Übergangsriegel). Auftrag, Erinnerung und Nachforderung haben ihre in
 * derselben Änderung bekommen. Ein Rückgängig-Knopf, der 422 liefert, wäre
 * schlechter als kein Knopf.
 */

/** Wie lange der Rückgängig-Weg offensteht. Antds Vorgabe (3 s) ist für eine
 *  Kenntnisnahme gedacht; hier ist eine Entscheidung zu treffen. */
const DAUER_S = 6;

/**
 * Fester Schlüssel: eine zweite Aktion ERSETZT den stehenden Toast, statt einen
 * zweiten daneben zu stapeln. Zwei gleichzeitig sichtbare Rückwege sagten nicht,
 * welcher zu welchem Datensatz gehört — und wer in Serie sichtet, erzeugt sie im
 * Sekundentakt.
 */
const SCHLUESSEL = 'lfh-rueckgaengig';

export function zeigeRueckgaengig(api: MessageInstance, text: string, aufRueckgaengig: () => void) {
  // Lokal statt State: der Toast lebt außerhalb des React-Baums des Auslösers und
  // wird nach dem Klick ohnehin zerstört.
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
            // Ein zweiter Klick schriebe denselben Status noch einmal — samt
            // Invalidierung und Live-Ereignis für nichts.
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
