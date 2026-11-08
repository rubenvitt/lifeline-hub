import { Form, Input } from 'antd';
import {
  SCHICHTPLAN_MAX_DIENST_MAX_MINUTEN,
  SCHICHTPLAN_MAX_DIENST_MIN_MINUTEN,
  SCHICHTPLAN_MIN_RUHE_MAX_MINUTEN,
} from '../api/eingabegrenzen';
import type { SchichtplanGrenzwerte, SchichtplanGrenzwerteBody } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { mitVorgabe } from '../components/vorgabeText';
import { dauerRegel, formatDauer } from './dauer';
import {
  grenzwerteBody,
  grenzwerteFormWerte,
  MAX_DIENST_VORGABE_MINUTEN,
  MIN_RUHE_VORGABE_MINUTEN,
  type GrenzwerteFormWerte,
} from './grenzwerte';

/**
 * Dialog „Dienst und Ruhe“ (LLH-1603, Einsatz-Einstellungen › Ablösung): Höchstdienst und
 * Mindestruhe des Einsatzes, gegen die der Plan-Befund `dienst` und die Einstufung der
 * Kräfte-Zeitachse prüfen.
 *
 * Dauern als Text über `abloesung/dauer.ts`. Ein leeres Feld heißt Vorgabe, und der Platzhalter
 * nennt sie. Gesendet wird nur, was sich geändert hat (`grenzwerte.ts:grenzwerteBody`); ändert
 * sich nichts, schließt der Dialog ohne Aufruf. Der Aufrufer montiert ihn je Öffnen frisch.
 */

interface GrenzwerteModalProps {
  /** Der Stand, gegen den der Dialog vergleicht (aus dem Plan). */
  grenzwerte: SchichtplanGrenzwerte;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`), damit die Felder stehen bleiben. */
  onSpeichern: (body: SchichtplanGrenzwerteBody) => Promise<unknown>;
  onSchliessen: () => void;
}

export default function GrenzwerteModal({
  grenzwerte,
  speicherung,
  onSpeichern,
  onSchliessen,
}: GrenzwerteModalProps) {
  const [form] = Form.useForm<GrenzwerteFormWerte>();

  return (
    <ErfassungsModal<GrenzwerteFormWerte>
      offen
      titel="Dienst und Ruhe"
      form={form}
      erfassenText="Speichern"
      laeuft={speicherung.isPending}
      speicherung={speicherung}
      initialValues={grenzwerteFormWerte(grenzwerte)}
      onErfassen={async (w) => {
        const body = grenzwerteBody(grenzwerte, w);
        if (body) await onSpeichern(body);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<GrenzwerteFormWerte>
        label="Höchstdienst"
        name="max_dienst"
        rules={[
          dauerRegel({
            pflicht: false,
            min: SCHICHTPLAN_MAX_DIENST_MIN_MINUTEN,
            max: SCHICHTPLAN_MAX_DIENST_MAX_MINUTEN,
          }),
        ]}
      >
        <Input
          placeholder={mitVorgabe(formatDauer(MAX_DIENST_VORGABE_MINUTEN))}
          autoComplete="off"
        />
      </Form.Item>
      <Form.Item<GrenzwerteFormWerte>
        label="Mindestruhe"
        name="min_ruhe"
        rules={[dauerRegel({ pflicht: false, min: 0, max: SCHICHTPLAN_MIN_RUHE_MAX_MINUTEN })]}
      >
        <Input placeholder={mitVorgabe(formatDauer(MIN_RUHE_VORGABE_MINUTEN))} autoComplete="off" />
      </Form.Item>
    </ErfassungsModal>
  );
}
