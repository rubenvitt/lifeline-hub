import { Form } from 'antd';
import { useMemo } from 'react';
import type { Rule } from 'antd/es/form';
import type { Nachforderung, NachforderungZusageEingabe } from '../api/types';
import {
  NACHFORDERUNG_ZUSAGE_RUFNAME_MAX,
  NACHFORDERUNG_ZUSAGE_RUFNAMEN_MAX,
} from '../api/eingabegrenzen';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { ErfassungsFormular, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { Select } from '../components/Select';
import { nachforderungName } from './nachforderungName';
import { bereinigeWer, zusageBody, zusageStart, type ZusageWerte } from './zusage';

const KEINE: string[] = [];

/** „Wer“ einer Zusage: höchstens so viele Einträge wie zugesagt, jeder in der Grenze (D2). */
export function werRegeln(anzahlFeld: string): Rule[] {
  return [
    ({ getFieldValue }) => ({
      validator: (_r, wert: string[] | undefined) => {
        const wer = bereinigeWer(wert);
        const anzahl = getFieldValue(anzahlFeld) as number | null | undefined;
        if (wer.some((w) => w.length > NACHFORDERUNG_ZUSAGE_RUFNAME_MAX)) {
          return Promise.reject(
            new Error(`Höchstens ${NACHFORDERUNG_ZUSAGE_RUFNAME_MAX} Zeichen je Eintrag`),
          );
        }
        if (anzahl != null && wer.length > anzahl) {
          return Promise.reject(new Error(`Höchstens ${anzahl} unter „Wer“`));
        }
        return Promise.resolve();
      },
    }),
  ];
}

/**
 * Das Feld „Wer“: Rufnamen oder freie Angaben, mit Komma oder Enter getrennt; mit Vorschlägen aus
 * den Einheiten des Einsatzes, sobald die Seite sie kennt (LLH-1383 D10).
 */
export function WerFeld({
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
  vorschlaege = KEINE,
}: {
  value?: string[];
  onChange?: (wer: string[]) => void;
  id?: string;
  'aria-label': string;
  /** Rufnamen der Einheiten im Einsatz (LLH-1383 D10); ohne bleibt das Feld reiner Freitext. */
  vorschlaege?: readonly string[];
}) {
  const optionen = useMemo(() => vorschlaege.map((v) => ({ value: v, label: v })), [vorschlaege]);
  return (
    <Select<string[]>
      id={id}
      aria-label={ariaLabel}
      mode="tags"
      value={value ?? KEINE}
      onChange={(w) => onChange?.(w)}
      tokenSeparators={[',']}
      maxCount={NACHFORDERUNG_ZUSAGE_RUFNAMEN_MAX}
      options={optionen}
      // Freitext ohne Vorschläge: eine leere Liste darunter wäre nur Rauschen.
      open={optionen.length > 0 ? undefined : false}
      suffixIcon={null}
      style={{ width: '100%' }}
    />
  );
}

/**
 * Zusage an der Karte erfassen (LLH-1097 D10): „Zugesagt“ (Vorgabe = angefordert), „Wer“ und
 * „Eintreffen erwartet“; kein Modal. Eine kleinere Menge teilt der Server in zwei Positionen (D1).
 * Enter sendet, auch im Mengenfeld: die Zusage ohne Angaben bleibt ein Klick plus Enter. Die Felder
 * stehen untereinander: die Karte ist eine Spalte des Boards, schmal auf jeder Breite.
 */
export default function ZusageFormular({
  nachforderung: n,
  werVorschlaege,
  onSenden,
  onSchliessen,
  speicherung,
}: {
  nachforderung: Nachforderung;
  /** Vorschläge für „Wer“ aus den Einheiten des Einsatzes (LLH-1383 D10). */
  werVorschlaege?: readonly string[];
  /** **Muss bei Ablehnung ablehnen** (`mutateAsync`): dann bleibt die Eingabe stehen. */
  onSenden: (zusage: NachforderungZusageEingabe) => Promise<unknown>;
  onSchliessen: () => void;
  speicherung?: Speicherung;
}) {
  const [form] = Form.useForm<ZusageWerte>();
  const name = nachforderungName(n);
  const mengenRegeln: Rule[] =
    n.anzahl != null
      ? [
          {
            type: 'number',
            max: n.anzahl,
            message: `Höchstens ${n.anzahl} angefordert`,
          },
        ]
      : [];
  return (
    <section aria-label={`Zusage zu ${name}`} data-lfh="nachforderung-zusage">
      <ErfassungsFormular<ZusageWerte>
        form={form}
        initialValues={zusageStart(n)}
        onErfassen={(w) => onSenden(zusageBody(w))}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
        laeuft={speicherung?.isPending}
        speicherung={speicherung}
        speicherFehlerTitel="Zusage nicht erfasst"
        speicherFehlerFallback="Zusage fehlgeschlagen"
        erfassenText="Zusage erfassen"
      >
        <Form.Item name="anzahl" label="Zugesagt" rules={mengenRegeln}>
          <MengenFeld beschriftung="Zugesagt" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="wer" label="Wer" dependencies={['anzahl']} rules={werRegeln('anzahl')}>
          <WerFeld aria-label="Wer" vorschlaege={werVorschlaege} />
        </Form.Item>
        <Form.Item name="eintreffen" label="Eintreffen erwartet">
          <ZeitpunktEingabe
            art="frist"
            aria-label="Eintreffen erwartet"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </ErfassungsFormular>
    </section>
  );
}
