import { Button, Input, Space, theme } from 'antd';
import type { InputRef } from 'antd';
import { useId, useRef, useState } from 'react';

/**
 * Schnellanlegen eines Ein-Feld-Katalogeintrags (LFH-332 · B4).
 *
 * **Das Problem, gemessen am 29.07.2026 (Befund M43).** Neun von neun
 * Stammdaten-Modalen schliessen nach dem Speichern. Wer 25 Qualifikationen
 * nachtraegt, klickt drei Mal je Eintrag — oeffnen, tippen, speichern —, also
 * 75 Mal fuer eine Liste, in der nur ein einziges Feld Pflicht ist.
 *
 * **Das Vorbild liegt im Repo**, nicht in einem Entwurf: `StichworteTab` traegt
 * seit jeher genau diese Zeile — Eingabefeld, Knopf, Reset im Erfolgsfall, kein
 * Dialog. Dieses Primitiv hebt das Muster aus der einen Datei heraus, damit die
 * vier Katalogtabs es teilen statt es zu kopieren.
 *
 * ── ABGRENZUNG ZU `Erfassung.tsx` ──────────────────────────────────
 *
 * `ErfassungsFormular` traegt ein antd-`Form` mit mehreren `Form.Item`, einen
 * Serienzaehler und Wertuebernahme. Das ist die richtige Huelle fuer eine
 * Erfassungsmaske mit fuenf Feldern. Hier gibt es **ein** Feld; ein Formular
 * mit Validierungsschicht darum waere Aufbau ohne Ertrag. Die eine Regel, die
 * beide teilen, ist der Vertrag von `onAnlegen`: **es muss ablehnen, wenn das
 * Speichern fehlschlaegt** (`mutateAsync`, nicht `mutate`) — sonst leert dieses
 * Primitiv das Feld, obwohl der Eintrag nie ankam.
 *
 * ── KEIN FORMULAR, UND DAS IST ABSICHT ─────────────────────────────
 *
 * Weder ein antd-`Form` noch ein natives `<form>`. Abgeschickt wird ueber
 * `onClick` und `onPressEnter`, **nicht** ueber `htmlType="submit"`. Grund: das
 * Primitiv steht dauerhaft auf der Seite und kann jederzeit in einem fremden
 * Formular landen (eine Einstellungsseite, ein Filterrahmen). Ein
 * verschachteltes Formular schickt beim Absenden das aeussere Formular nativ
 * mit ab und laedt die Seite neu — im Repo bereits einmal gemessen und als
 * Erinnerung festgehalten. Mit einem Klick-Ausloeser kann das nicht passieren.
 *
 * ── DREI KLEINE ENTSCHEIDUNGEN ─────────────────────────────────────
 *
 * 1. Der Knopf wird bei leerem Feld **nicht abgeschaltet**, er tut dann nur
 *    nichts — wie im Vorbild. Ein ausgegrauter Primaerknopf ist auf einer sonst
 *    leeren Katalogseite die einzige sichtbare Handlung; ausgegraut sieht sie
 *    aus wie fehlendes Recht, nicht wie fehlender Text.
 * 2. Der Fokus kehrt **im naechsten Bild** ins Feld zurueck, nicht sofort —
 *    dieselbe Vorsichtsmassnahme wie in `Erfassung.tsx`, wo gemessen wurde, dass
 *    ein direkter `focus()` nach dem Speichern auf `<body>` landet. Ehrlich
 *    dazugesagt: HIER ist der direkte Aufruf in jsdom ebenfalls gruen (das Feld
 *    wird nicht neu montiert, nur neu gerendert) — die Verzoegerung deckt also
 *    einen Fall ab, den der Test nicht zeigen kann, und kostet nichts.
 * 3. Geleert wird **nur, wenn im Feld noch der abgeschickte Text steht.** Das
 *    Vorbild leert unbedingt (`setNeuerText('')` im `onSuccess`) und frisst
 *    damit die naechste Eingabe, wenn jemand weitertippt, waehrend der
 *    vorherige Datensatz noch unterwegs ist — genau der Minutentakt an
 *    Aufnahme/BHP/BTP, fuer den dieses Primitiv existiert.
 */

interface SchnellAnlegenProps {
  /**
   * Sichtbare Beschriftung ueber dem Feld — und zugleich sein zugaenglicher
   * Name (echtes `<label for>`, kein Platzhalter als Ersatz).
   */
  beschriftung: string;
  /** Beispieltext im leeren Feld. Ergaenzt die Beschriftung, ersetzt sie nicht. */
  platzhalter?: string;
  /** Beschriftung des Knopfes. Default `'Anlegen'`. */
  knopfText?: string;
  /**
   * Anlegen. Bekommt den **beschnittenen** Text; wird bei leerer Eingabe nie
   * gerufen. **Muss bei Ablehnung ablehnen** — sonst leert die Zeile das Feld,
   * obwohl der Eintrag nie ankam. Die Fehlermeldung bleibt beim Aufrufer
   * (`onError` der Mutation).
   */
  onAnlegen: (text: string) => Promise<unknown>;
  /** Laeuft die Mutation? Setzt den Knopf auf Ladeanzeige. */
  laeuft?: boolean;
}

/**
 * Eine Zeile: beschriftetes Feld + Anlegen-Knopf. Enter im Feld legt an, nach
 * Erfolg ist das Feld leer und traegt wieder den Fokus.
 */
export default function SchnellAnlegen({
  beschriftung, platzhalter, knopfText = 'Anlegen', onAnlegen, laeuft = false,
}: SchnellAnlegenProps) {
  const { token } = theme.useToken();
  const feldId = useId();
  const feldRef = useRef<InputRef>(null);
  const [text, setText] = useState('');

  async function anlegen() {
    // Laeuft schon einer: kein zweiter. Dieser Riegel traegt BEIDE Wege — Knopf
    // und Enter im Feld. Ob antd einen Klick auf einen ladenden Knopf ohnehin
    // verwirft, ist damit gleichgueltig und wird hier nicht vorausgesetzt.
    if (laeuft) return;
    const abgeschickt = text;
    const wert = abgeschickt.trim();
    // Leer oder nur Leerzeichen: nichts tun. Kein Fehlerton — es ist kein
    // Fehler, sondern eine Eingabe, die noch nicht angefangen hat.
    if (wert === '') return;
    try {
      await onAnlegen(wert);
    } catch {
      // Abgelehnt: Text stehen lassen, damit die Eingabe nicht verloren geht.
      // Gemeldet hat der Aufrufer bereits.
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
        />
        <Button type="primary" loading={laeuft} onClick={() => void anlegen()}>
          {knopfText}
        </Button>
      </Space.Compact>
    </div>
  );
}
