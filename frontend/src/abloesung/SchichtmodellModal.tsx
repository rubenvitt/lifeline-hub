import { Collapse, Form, Input } from 'antd';
import { useState } from 'react';
import {
  ABLOESUNG_RHYTHMUS_MAX_MINUTEN,
  SCHICHTMODELL_BEZEICHNUNG_MAX,
  SCHICHTMODELL_MINDESTDAUER_MAX_MINUTEN,
  SCHICHTMODELL_VORLAUF_MAX_MINUTEN,
  SCHICHTMODELL_WECHSELZEITEN_MAX,
} from '../api/eingabegrenzen';
import type { SchichtmodellTyp, SchichtmodellWerteBody } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { Segmentleiste } from '../components/instrument';
import { mitVorgabe } from '../components/vorgabeText';
import { dauerRegel, formatDauer, uhrzeitenRegel } from './dauer';
import {
  buildWerteBody,
  PLANUNGSVORLAUF_VORGABE_MINUTEN,
  toFormWerte,
  VORWARNUNG_VORGABE_MINUTEN,
  vorlaufKopf,
  type SchichtmodellFormWerte,
  type SchichtmodellVorlage,
} from './schichtmodellForm';

/**
 * Anlegen und Ändern eines Schichtmodells (LLH-1122) — in den Stammdaten und als eigene Werte
 * am Einsatz (Einsatz-Einstellungen, Abschnitt „Ablösung“).
 *
 * Feldbudget (LFH-19, Modal ≤ ~3): sichtbar sind Bezeichnung, Typ und der Wert des Typs
 * (Rhythmus, oder Wechselzeiten und Mindestdauer: dann vier). Vorwarnung und Planungsvorlauf
 * stehen im Klappteil; dessen Kopf nennt beide wirksamen Werte, auch die Vorgabe, und er geht
 * bei einem Prüffehler darin selbst auf (Ausnahme nach LFH-974, `meldungen/MeldungFormular.tsx`).
 *
 * Dauern als Text („8 h“, „7:30 h“, `abloesung/dauer.ts`), Wechselzeiten taktisch („0600 1800“).
 * Ein leeres Vorlauf-Feld schickt nichts: der Server nimmt dann seine Vorgabe, die der
 * Platzhalter nennt. Vorbelegt wird über `initialValues`; der Aufrufer montiert den Dialog je Ziel
 * frisch.
 */

const TYP_OPTIONEN = [
  { wert: 'rhythmus' as const, label: 'Rhythmus' },
  { wert: 'wechselzeiten' as const, label: 'Wechselzeiten' },
];

/** Die Segmentleiste als Formularfeld: `Form.Item` reicht `value`/`onChange` hinein. */
function TypField({
  value,
  onChange,
}: {
  value?: SchichtmodellTyp;
  onChange?: (typ: SchichtmodellTyp) => void;
}) {
  return (
    <Segmentleiste<SchichtmodellTyp>
      beschriftung="Typ"
      wert={value ?? 'rhythmus'}
      onWechsel={(typ) => onChange?.(typ)}
      optionen={TYP_OPTIONEN}
    />
  );
}

/** Felder im Klappteil: ein Prüffehler darin öffnet ihn. */
const EINGEKLAPPT = new Set(['vorwarnung', 'planungsvorlauf']);

interface SchichtmodellModalProps {
  titel: string;
  /** Vorbelegung; `null` = neues Modell. */
  vorlage: SchichtmodellVorlage | null;
  erfassenText?: string;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`), damit die Felder stehen bleiben. */
  onErfassen: (werte: SchichtmodellWerteBody) => Promise<unknown>;
  onSchliessen: () => void;
}

export default function SchichtmodellModal({
  titel,
  vorlage,
  erfassenText = 'Speichern',
  speicherung,
  onErfassen,
  onSchliessen,
}: SchichtmodellModalProps) {
  const [form] = Form.useForm<SchichtmodellFormWerte>();
  const start = toFormWerte(vorlage);
  const typ = Form.useWatch('typ', form) ?? start.typ;
  const vorwarnung = Form.useWatch('vorwarnung', form);
  const planungsvorlauf = Form.useWatch('planungsvorlauf', form);
  // Offen, wenn das Modell vom Vorlauf der Vorgabe abweicht: was gilt, soll man sehen.
  const [vorlaufOffen, setVorlaufOffen] = useState(
    start.vorwarnung != null || start.planungsvorlauf != null,
  );

  return (
    <ErfassungsModal<SchichtmodellFormWerte>
      offen
      titel={titel}
      form={form}
      erfassenText={erfassenText}
      laeuft={speicherung.isPending}
      speicherung={speicherung}
      initialValues={start}
      onErfassen={(w) => onErfassen(buildWerteBody(w))}
      onPruefungGescheitert={(felder) => {
        if (felder.some((f) => EINGEKLAPPT.has(f))) setVorlaufOffen(true);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<SchichtmodellFormWerte>
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. 12-h-Schicht" maxLength={SCHICHTMODELL_BEZEICHNUNG_MAX} />
      </Form.Item>
      <Form.Item<SchichtmodellFormWerte> label="Typ" name="typ">
        <TypField />
      </Form.Item>
      {typ === 'rhythmus' ? (
        <Form.Item<SchichtmodellFormWerte>
          label="Rhythmus"
          name="rhythmus"
          required
          rules={[
            dauerRegel({
              pflicht: true,
              min: 30,
              max: ABLOESUNG_RHYTHMUS_MAX_MINUTEN,
              pflichtText: 'Bitte einen Rhythmus angeben',
            }),
          ]}
        >
          <Input autoComplete="off" />
        </Form.Item>
      ) : (
        <>
          <Form.Item<SchichtmodellFormWerte>
            label="Wechselzeiten"
            name="wechselzeiten"
            required
            rules={[uhrzeitenRegel(SCHICHTMODELL_WECHSELZEITEN_MAX)]}
          >
            <Input placeholder="z. B. 0600 1800" autoComplete="off" />
          </Form.Item>
          <Form.Item<SchichtmodellFormWerte>
            label="Mindestdauer"
            name="mindestdauer"
            required
            rules={[
              dauerRegel({
                pflicht: true,
                min: 0,
                max: SCHICHTMODELL_MINDESTDAUER_MAX_MINUTEN,
                pflichtText: 'Bitte eine Mindestdauer angeben',
              }),
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
        </>
      )}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        activeKey={vorlaufOffen ? ['vorlauf'] : []}
        onChange={(keys) => setVorlaufOffen(keys.includes('vorlauf'))}
        items={[
          {
            key: 'vorlauf',
            label: vorlaufKopf({ vorwarnung, planungsvorlauf }),
            // Montiert auch zugeklappt: die Werte gehören zum Modell und gehen mit.
            forceRender: true,
            children: (
              <>
                <Form.Item<SchichtmodellFormWerte>
                  label="Vorwarnung"
                  name="vorwarnung"
                  rules={[
                    dauerRegel({ pflicht: false, min: 1, max: SCHICHTMODELL_VORLAUF_MAX_MINUTEN }),
                  ]}
                >
                  <Input
                    placeholder={mitVorgabe(formatDauer(VORWARNUNG_VORGABE_MINUTEN))}
                    autoComplete="off"
                  />
                </Form.Item>
                <Form.Item<SchichtmodellFormWerte>
                  label="Planungsvorlauf"
                  name="planungsvorlauf"
                  rules={[
                    dauerRegel({ pflicht: false, min: 1, max: SCHICHTMODELL_VORLAUF_MAX_MINUTEN }),
                  ]}
                >
                  <Input
                    placeholder={mitVorgabe(formatDauer(PLANUNGSVORLAUF_VORGABE_MINUTEN))}
                    autoComplete="off"
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
