import { Button, Form, Input, InputNumber, type FormRule } from 'antd';
import type { ReactElement, ReactNode } from 'react';
import type { Erhebung, Evakuierungsbezirk, EvakuierungsbezirkPatch } from '../api/types';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { Datenfeld, DatenfeldEingabe, Datenraster, Paneel } from '../components/instrument';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';
import { bezirkPatchDreiseitig, type BezirkWerte } from './BetreuungDialoge';
import { ERHEBUNG_LABEL, mengeText, personenZahl } from './betreuungText';

/** Obergrenze je Personenzahl, gespiegelt aus `betreuung::MAX_PERSONEN` (darüber 400). */
const MAX_PERSONEN = 1_000_000;

/**
 * Als Regeln, NICHT als `min`/`max` am `InputNumber`: das klemmte still auf die Grenze (LLH-1101).
 * Die Meldung steht am Feld.
 */
const PLAN_REGELN: FormRule[] = [
  { required: true, message: 'Bitte eine Plangröße angeben' },
  { type: 'number', min: 1, message: 'Mindestens 1 Person' },
  {
    type: 'number',
    max: MAX_PERSONEN,
    message: `Höchstens ${personenZahl(MAX_PERSONEN)} Personen`,
  },
];

const ERHEBUNG_OPTIONEN = (['gezaehlt', 'geschaetzt'] as const).map((e: Erhebung) => ({
  value: e,
  label: ERHEBUNG_LABEL[e],
}));

const leer = '—';

/**
 * Stammdaten eines Evakuierungsbezirks mit Bearbeiten in der Ansicht (LLH-1076, design.md D6;
 * Muster Tier/Schaden, LLH-1101): EIN `Datenraster`, das in der Bearbeiten-Sitzung auf benannte
 * Eingaben (`DatenfeldEingabe`) schaltet, darunter die stehende Speichern-Leiste im `<form>`.
 *
 * Die Sitzung gehört der Seite (`beimOeffnen`, der eingefrorene Stand beim Öffnen; `null` =
 * Lesemodus), damit der Kopf seine Handlungen während der Sitzung verbirgt. Die Seite montiert
 * dieses Paneel je Sitzung neu (`key`), so stehen die Werte beim Öffnen genau einmal im Formular.
 *
 * PATCH dreiseitig (`bezirkPatchDreiseitig`): ein Feld geht nur hinaus, wenn die Person es
 * geändert hat UND der Live-Stand es noch nicht trägt — der Bezirk hat keinen CAS, ein
 * unberührtes Feld überschriebe sonst eine fremde Änderung. Ein leerer Patch sendet nichts.
 *
 * Verlassen-Schutz (`frontend/AGENTS.md`, „Formularseiten“): aktiv, solange die Sitzung offen
 * ist; der Schlüssel hängt an der Sitzung.
 */
export default function BezirkStammdaten({
  bezirk,
  beimOeffnen,
  abschnitte,
  laeuft,
  fehler,
  onSpeichern,
  onBeenden,
}: {
  /** Der AKTUELLE Stand aus dem Cache (Live). */
  bezirk: Evakuierungsbezirk;
  /** Stand beim Öffnen der Sitzung; `null` im Lesemodus. */
  beimOeffnen: Evakuierungsbezirk | null;
  abschnitte: readonly { value: number; label: string }[];
  laeuft: boolean;
  /** Ablehnung des Speicherns — steht am Formular. */
  fehler: unknown;
  /** Sendet den (nicht leeren) Patch; lehnt bei Ablehnung ab. */
  onSpeichern: (patch: EvakuierungsbezirkPatch) => Promise<unknown>;
  /** Sitzung beenden (Abbrechen, Erfolg, nichts zu speichern). */
  onBeenden: () => void;
}) {
  const [form] = Form.useForm<BezirkWerte>();
  const bearbeiten = beimOeffnen != null;
  const speicherLeiste = useSpeicherLeiste({ hasAbbrechen: true });
  const schutz = useFormularVerlassenSchutz({
    aktiv: bearbeiten,
    schluessel: bearbeiten ? bezirk.id : null,
  });

  const zelle = (
    name: keyof BezirkWerte,
    label: string,
    eingabe: ReactElement<{ id?: string }>,
    anzeige: ReactNode,
    {
      mono = false,
      breit = false,
      rules,
    }: { mono?: boolean; breit?: boolean; rules?: FormRule[] } = {},
  ) =>
    bearbeiten ? (
      <DatenfeldEingabe label={label} name={name} rules={rules} breit={breit}>
        {eingabe}
      </DatenfeldEingabe>
    ) : (
      <Datenfeld label={label} mono={mono} breit={breit}>
        {anzeige}
      </Datenfeld>
    );

  const raster = (
    <Datenraster spalten={3} beschriftung={`Stammdaten Bezirk ${bezirk.bezeichnung}`}>
      {zelle('bezeichnung', 'Bezeichnung', <Input />, bezirk.bezeichnung, {
        rules: [{ required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' }],
      })}
      {zelle(
        'plan_personen',
        'Plangröße (Personen)',
        <InputNumber precision={0} style={{ width: '100%' }} />,
        mengeText(bezirk.plan_personen, bezirk.plan_erhebung),
        { mono: true, rules: PLAN_REGELN },
      )}
      {zelle(
        'plan_erhebung',
        'Erhebung der Plangröße',
        <Select options={ERHEBUNG_OPTIONEN} />,
        ERHEBUNG_LABEL[bezirk.plan_erhebung],
        { rules: [{ required: true, message: 'Bitte die Erhebung angeben' }] },
      )}
      {zelle(
        'abschnitt_id',
        'Einsatzabschnitt',
        <Select
          allowClear
          placeholder="ohne Abschnitt"
          options={[...abschnitte]}
          notFoundContent="Keine Einsatzabschnitte angelegt"
        />,
        bezirk.abschnitt_name ?? leer,
      )}
      {zelle('sammelstelle', 'Sammelstelle', <Input />, bezirk.sammelstelle ?? leer)}
      {zelle('notiz', 'Notiz', <Input.TextArea autoSize={{ minRows: 2 }} />, bezirk.notiz ?? leer, {
        breit: true,
      })}
    </Datenraster>
  );

  return (
    <Paneel titel="Stammdaten" koerperPolster>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      {beimOeffnen ? (
        <Form<BezirkWerte>
          form={form}
          initialValues={{
            bezeichnung: beimOeffnen.bezeichnung,
            plan_personen: beimOeffnen.plan_personen,
            plan_erhebung: beimOeffnen.plan_erhebung,
            abschnitt_id: beimOeffnen.abschnitt_id ?? undefined,
            sammelstelle: beimOeffnen.sammelstelle ?? undefined,
            notiz: beimOeffnen.notiz ?? undefined,
          }}
          onValuesChange={schutz.geaendert}
          // Nach gescheiterter Prüfung steht der Fokus im ersten Feld mit Meldung (LLH-1101).
          scrollToFirstError={{ focus: true }}
          onFinish={(werte) => {
            const patch = bezirkPatchDreiseitig(beimOeffnen, bezirk, werte);
            if (Object.keys(patch).length === 0) {
              onBeenden();
              return;
            }
            const fassung = schutz.fassung();
            onSpeichern(patch).then(
              () => {
                schutz.gespeichert(fassung);
                onBeenden();
              },
              // Die Ablehnung steht am Formular (`fehler`); die Sitzung bleibt offen.
              () => undefined,
            );
          }}
        >
          {raster}
          {fehler != null && (
            <div style={{ marginTop: 16 }}>
              <SpeicherFehler fehler={fehler} titel="Bezirk konnte nicht gespeichert werden" />
            </div>
          )}
          <div {...speicherLeiste} style={{ ...speicherLeiste.style, marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={laeuft}>
              Speichern
            </Button>
            {/* Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort. */}
            <Button disabled={laeuft} onClick={onBeenden}>
              Abbrechen
            </Button>
          </div>
        </Form>
      ) : (
        raster
      )}
    </Paneel>
  );
}
