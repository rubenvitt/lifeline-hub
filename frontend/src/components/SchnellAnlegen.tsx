import { Button, Input, Space, theme } from 'antd';
import type { InputRef } from 'antd';
import { useId, useRef, useState } from 'react';

/**
 * Schnellanlegen eines Ein-Feld-Katalogeintrags (LFH-332 · B4): Eingabefeld, Knopf, Reset im
 * Erfolgsfall, kein Dialog — statt eines Modals, das nach jedem Eintrag schließt.
 *
 * ── ABGRENZUNG ZU `Erfassung.tsx` ──────────────────────────────────
 *
 * Hier gibt es **ein** Feld; ein Formular mit Validierungsschicht wäre Aufbau ohne Ertrag. Beide
 * teilen den Vertrag von `onAnlegen`: **es muss ablehnen, wenn das Speichern fehlschlägt**
 * (`mutateAsync`, nicht `mutate`) — sonst leert das Primitiv das Feld, obwohl der Eintrag nie
 * ankam.
 *
 * ── KEIN FORMULAR, UND DAS IST ABSICHT ─────────────────────────────
 *
 * Weder antd-`Form` noch natives `<form>`; abgeschickt wird über `onClick` und `onPressEnter`,
 * **nicht** über `htmlType="submit"`. Das Primitiv kann in einem fremden Formular landen, und
 * ein verschachteltes Formular schickt beim Absenden das äußere nativ mit ab und lädt die Seite
 * neu.
 *
 * ── DREI KLEINE ENTSCHEIDUNGEN ─────────────────────────────────────
 *
 * 1. Der Knopf wird bei leerem Feld **nicht abgeschaltet**, er tut dann nur nichts: ausgegraut
 *    sähe die einzige sichtbare Handlung aus wie fehlendes Recht. **Deshalb ist `gesperrt` eine
 *    eigene Prop** (LFH-346): das Grau bedeutet fehlendes Recht, und den Grund trägt der
 *    `RechteHinweis` über der Zeile. Die Zeile bleibt sichtbar, statt zu verschwinden.
 * 2. Der Fokus kehrt **im nächsten Bild** ins Feld zurück, dieselbe Vorsicht wie in
 *    `Erfassung.tsx`, wo ein direkter `focus()` auf `<body>` landete. In jsdom ist der direkte
 *    Aufruf hier ebenfalls grün; die Verzögerung kostet nichts.
 * 3. Geleert wird **nur, wenn im Feld noch der abgeschickte Text steht** — sonst fräße das
 *    Leeren die nächste Eingabe, wenn jemand weitertippt, während der vorige Datensatz noch
 *    unterwegs ist.
 */

interface SchnellAnlegenProps {
  /**
   * Sichtbare Beschriftung über dem Feld und zugleich sein zugänglicher Name (echtes
   * `<label for>`, kein Platzhalter als Ersatz).
   */
  beschriftung: string;
  /** Beispieltext im leeren Feld. Ergaenzt die Beschriftung, ersetzt sie nicht. */
  platzhalter?: string;
  /** Beschriftung des Knopfes. Default `'Anlegen'`. */
  knopfText?: string;
  /**
   * Anlegen. Bekommt den **beschnittenen** Text; wird bei leerer Eingabe nie gerufen. **Muss bei
   * Ablehnung ablehnen**, sonst leert die Zeile das Feld. Die Fehlermeldung bleibt beim Aufrufer.
   */
  onAnlegen: (text: string) => Promise<unknown>;
  /** Laeuft die Mutation? Setzt den Knopf auf Ladeanzeige. */
  laeuft?: boolean;
  /**
   * Fehlt das Recht? Sperrt **Feld und Knopf** — die Zeile bleibt sichtbar (Kopf, 1.). Den Grund
   * nennt der Aufrufer über seinen `RechteHinweis`.
   */
  gesperrt?: boolean;
}

/**
 * Eine Zeile: beschriftetes Feld + Anlegen-Knopf. Enter im Feld legt an, nach
 * Erfolg ist das Feld leer und traegt wieder den Fokus.
 */
export default function SchnellAnlegen({
  beschriftung,
  platzhalter,
  knopfText = 'Anlegen',
  onAnlegen,
  laeuft = false,
  gesperrt = false,
}: SchnellAnlegenProps) {
  const { token } = theme.useToken();
  const feldId = useId();
  const feldRef = useRef<InputRef>(null);
  const [text, setText] = useState('');

  async function anlegen() {
    // Läuft schon einer: kein zweiter. Der Riegel trägt BEIDE Wege — Knopf und Enter im Feld.
    if (laeuft) return;
    // Kein Recht: nichts anlegen. Der Riegel sitzt HIER und nicht am Knopf, weil `onPressEnter` am
    // Feld hängt; dass eine gesperrte Eingabe stumm bleibt, wird nicht vorausgesetzt.
    if (gesperrt) return;
    const abgeschickt = text;
    const wert = abgeschickt.trim();
    // Leer oder nur Leerzeichen: nichts tun, kein Fehler.
    if (wert === '') return;
    try {
      await onAnlegen(wert);
    } catch {
      // Abgelehnt: Text stehen lassen. Gemeldet hat der Aufrufer bereits.
      return;
    }
    // Nur leeren, wenn niemand zwischenzeitlich weitergetippt hat (Kopf, 3.).
    setText((aktuell) => (aktuell === abgeschickt ? '' : aktuell));
    requestAnimationFrame(() => feldRef.current?.focus());
  }

  return (
    <div style={{ marginBlockEnd: token.margin }}>
      <label
        htmlFor={feldId}
        style={{
          display: 'block',
          marginBlockEnd: token.marginXXS,
          color: token.colorText,
          fontSize: token.fontSize,
        }}
      >
        {beschriftung}
      </label>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          id={feldId}
          ref={feldRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={() => void anlegen()}
          placeholder={platzhalter}
          disabled={gesperrt}
        />
        <Button type="primary" loading={laeuft} disabled={gesperrt} onClick={() => void anlegen()}>
          {knopfText}
        </Button>
      </Space.Compact>
    </div>
  );
}
