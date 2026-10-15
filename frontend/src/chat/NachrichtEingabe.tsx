import { IconBueroklammer } from '../icons';
import { Button, Mentions, Space, Upload } from 'antd';
import { ERWAEHNUNGEN_MAX, ETB_INHALT_MAX } from '../api/eingabegrenzen';
import type { ChatErwaehnung } from '../api/types';
import { istZuLang, zeichenGrenze, Zeichenzaehler } from '../components/zeichenGrenze';
import { schriftStil, useRollen } from '../components/instrument/rollenwerte';
import type { UploadFile } from 'antd';
import { useMemo, useRef, useState } from 'react';
import { erwaehnungenAusText, type ErwaehnungVorschlag } from './erwaehnung';
import { AusgangUnbekannt, NetzFehler, fehlerText, type UploadFortschritt } from '../api/client';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import UploadFortschrittAnzeige from '../components/UploadFortschritt';

/**
 * Überschrift eines Sende-Fehlers nach der Phase des Abbruchs (LFH-1021, wie `ablageFehlerKopf`):
 * ohne Antwort nach dem letzten Byte ist der Ausgang unbekannt, nicht „nicht gesendet“.
 */
export function sendeFehlerKopf(fehler: unknown): { titel: string; fallback?: string } {
  if (fehler instanceof AusgangUnbekannt)
    return { titel: 'Senden unklar', fallback: fehlerText(fehler) };
  if (fehler instanceof NetzFehler)
    return { titel: 'Nicht gesendet', fallback: fehlerText(fehler) };
  return { titel: 'Nicht gesendet' };
}

interface Props {
  /**
   * Sendet Text und/oder Anhänge, dazu die Erwähnten des Texts (LLH-1220). Text oder Anhänge
   * sind nicht leer. Lehnt bei Ablehnung ab (`mutateAsync`): dann bleiben Text und Anhänge
   * stehen (LFH-795).
   */
  onSenden: (text: string, dateien: File[], erwaehnungen: ChatErwaehnung[]) => Promise<unknown>;
  /** Wen `@` vorschlägt: Mitglieder und besetzte Funktionen (`chat/erwaehnung.ts`). */
  vorschlaege?: readonly ErwaehnungVorschlag[];
  /** true, solange Upload/Sende-Mutation läuft. */
  senden: boolean;
  /** Stand der Anhang-Übertragung, nur während sie läuft (LFH-1021). */
  fortschritt?: UploadFortschritt | null;
  /** `mutation.error` des letzten Sendens; geht beim nächsten Absenden. */
  fehler?: unknown;
}

const KEINE_VORSCHLAEGE: readonly ErwaehnungVorschlag[] = [];

export default function NachrichtEingabe({
  onSenden,
  senden,
  fortschritt,
  fehler,
  vorschlaege = KEINE_VORSCHLAEGE,
}: Props) {
  const { rollen } = useRollen();
  const [text, setText] = useState('');
  // Aus der Auswahl übernommene Vorschläge. Nur sie zählen: ein von Hand getipptes „@S4“ wird
  // nie zum Code (`frontend/src/fuehrung/AGENTS.md`, kein Rückschluss vom Freitext).
  const [gewaehlt, setGewaehlt] = useState<readonly ErwaehnungVorschlag[]>([]);
  const [dateien, setDateien] = useState<UploadFile[]>([]);
  // Riegel gegen ein zweites Enter, solange gesendet wird: der Text steht bis zum Erfolg noch im
  // Feld, und `loading` am Knopf sperrt nur Klicks.
  const sendetRef = useRef(false);

  // Kein antd-Formular: über der Grenze sperrt das Senden, der Zähler nennt die Überlänge, der Text
  // bleibt stehen (LFH-937, `components/zeichenGrenze.tsx`).
  const zuLang = istZuLang(text, ETB_INHALT_MAX);
  // Erwähnt ist, wer gewählt wurde und noch als `@Wert` im Text steht; ein gelöschter Name fällt
  // so mit heraus.
  const erwaehnungen = useMemo(() => erwaehnungenAusText(text, gewaehlt), [text, gewaehlt]);
  const zuViele = erwaehnungen.length > ERWAEHNUNGEN_MAX;
  const optionen = useMemo(
    () => vorschlaege.map((v) => ({ key: v.wert, value: v.wert, label: v.label })),
    [vorschlaege],
  );

  const absenden = async () => {
    if (sendetRef.current || zuLang || zuViele) return;
    const getrimmt = text.trim();
    // Die rohen File-Objekte stecken in originFileObj (beforeUpload=false → kein Auto-Upload).
    const rohdateien = dateien
      .map((f) => f.originFileObj as File | undefined)
      .filter((f): f is File => f !== undefined);
    if (!getrimmt && rohdateien.length === 0) return;
    // Feld und Liste bleiben während des Sendens bedienbar (offline pausiert die Mutation, bis das
    // Netz zurück ist). Nach dem Erfolg wird deshalb nur geleert, was gesendet wurde.
    const gesendeterText = text;
    const gesendeteDateien = new Set(dateien.map((f) => f.uid));
    const gesendeteWahl = new Set(gewaehlt.filter((v) => erwaehnungenAusText(text, [v]).length));
    sendetRef.current = true;
    try {
      await onSenden(getrimmt, rohdateien, erwaehnungen);
    } catch {
      // Abgelehnt: nichts leeren. Den Fehler meldet die Mutation des Aufrufers.
      return;
    } finally {
      sendetRef.current = false;
    }
    setText((jetzt) => (jetzt === gesendeterText ? '' : jetzt));
    setGewaehlt((jetzt) => jetzt.filter((v) => !gesendeteWahl.has(v)));
    setDateien((jetzt) => jetzt.filter((f) => !gesendeteDateien.has(f.uid)));
  };

  return (
    <div style={{ marginTop: 12 }}>
      <SpeicherFehler fehler={fehler} {...sendeFehlerKopf(fehler)} />
      <Space.Compact style={{ width: '100%' }}>
        <Mentions
          value={text}
          onChange={setText}
          options={optionen}
          onSelect={(option) => {
            const v = vorschlaege.find((x) => x.wert === option.value);
            if (v) setGewaehlt((jetzt) => (jetzt.includes(v) ? jetzt : [...jetzt, v]));
          }}
          placeholder="Nachricht…"
          // Grenze des Servers (LFH-937): eine Nachricht kann zum ETB-Eintrag heraufgestuft werden.
          // Ohne eingebauten Zähler: der legte das Feld in einen Rahmen, und das Textfeld verlöre
          // die 72-px-Trefffläche im Handschuh-Betrieb; der Zähler steht unter der Zeile.
          count={zeichenGrenze(ETB_INHALT_MAX, { zaehler: false })}
          autoSize={{ minRows: 1, maxRows: 4 }}
          // Enter bei offener Auswahl übernimmt den Vorschlag; gesendet wird erst danach.
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void absenden();
            }
          }}
        />
        <Button
          type="primary"
          loading={senden}
          disabled={zuLang || zuViele}
          onClick={() => void absenden()}
        >
          Senden
        </Button>
      </Space.Compact>
      <Zeichenzaehler wert={text} max={ETB_INHALT_MAX} />
      {zuViele && (
        <span
          data-lfh="erwaehnungen-zaehler"
          style={{ ...schriftStil('meta'), color: rollen.alarmText }}
        >
          {`${erwaehnungen.length} / ${ERWAEHNUNGEN_MAX} Erwähnungen · zu viele`}
        </span>
      )}
      <UploadFortschrittAnzeige stand={fortschritt ?? null} />
      <Upload
        multiple
        beforeUpload={() => false}
        fileList={dateien}
        onChange={({ fileList }) => setDateien(fileList)}
        style={{ marginTop: 8 }}
      >
        <Button type="text" icon={<IconBueroklammer />}>
          Anhang
        </Button>
      </Upload>
    </div>
  );
}
