import { Button, Flex, Form, Typography } from 'antd';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import type { MassnahmeEingabe, TransportEingabe } from '../api/einsatzPerson';
import type {
  Fachrichtung,
  Massnahme,
  MassnahmeArt,
  PersonDetail,
  TransportArt,
  TransportPrioritaet,
} from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeUhrzeit } from '../anzeige/format';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ErfassungsFormular } from '../components/Erfassung';
import { Segmentleiste, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import BestaetigtVonFeld, { BESTAETIGT_FELD } from '../geraet/BestaetigtVonFeld';
import FlaechenWahl from './FlaechenWahl';
import {
  FACHRICHTUNG_WORT,
  MASSNAHME_REIHE,
  MASSNAHME_WORT,
  TRANSPORT_ART_WORT,
  TRANSPORT_PRIORITAET_REIHE,
  gueltig,
} from './personMeta';

/**
 * Die Paneele „Transport festlegen“ und „Maßnahme erfassen“ des Patientenkopfs (Change
 * `y18v58dt-pat-kern`, design.md D14, Spec `personen-detail`, „Sichten, Verbleib und Notiz ohne
 * Dialog“). Wie Sichtung und Verbleib: die Mutation hält der Kopf (Wechselsperre), das Paneel
 * schließt nur sich selbst, eine Ablehnung bleibt in ihm stehen. Am UHS-Gerät nennt
 * `BestaetigtVonFeld` die bestätigende Person.
 */

/** „ohne“ als eigener Wert der Segmentleiste: die Leiste kennt kein Leer. */
const OHNE = 'ohne';
type MitOhne<W extends string> = W | typeof OHNE;

/** Eine Segmentleiste als Formularfeld; `null` steht als „ohne“. */
function SegmentFeld<W extends string>({
  id,
  value,
  onChange,
  optionen,
  beschriftung,
}: {
  id?: string;
  value?: MitOhne<W>;
  onChange?: (wert: MitOhne<W>) => void;
  optionen: readonly { wert: MitOhne<W>; label: string }[];
  beschriftung: string;
}) {
  return (
    <div id={id}>
      <Segmentleiste<MitOhne<W>>
        optionen={optionen}
        wert={value ?? OHNE}
        onWechsel={(w) => onChange?.(w)}
        beschriftung={beschriftung}
      />
    </div>
  );
}

interface TransportWerte {
  prioritaet: MitOhne<TransportPrioritaet>;
  art: MitOhne<TransportArt>;
  fachrichtung?: Fachrichtung | null;
  [BESTAETIGT_FELD]?: number;
}

const PRIORITAET_OPTIONEN = [
  ...TRANSPORT_PRIORITAET_REIHE.map((p) => ({ wert: p, label: p })),
  { wert: OHNE, label: 'ohne' },
] as const;

const ART_OPTIONEN = [
  ...(Object.keys(TRANSPORT_ART_WORT) as TransportArt[]).map((a) => ({
    wert: a,
    label: TRANSPORT_ART_WORT[a],
  })),
  { wert: OHNE, label: 'ohne' },
] as const;

const FACHRICHTUNG_OPTIONEN = (Object.keys(FACHRICHTUNG_WORT) as Fachrichtung[]).map((f) => ({
  value: f,
  label: FACHRICHTUNG_WORT[f],
}));

/** Formularwerte → voller Stand (Spec: jedes Feld einzeln leer, alle drei leer heben auf). */
export function transportEingabe(v: TransportWerte): TransportEingabe {
  const bestaetigt = v[BESTAETIGT_FELD];
  return {
    prioritaet: v.prioritaet === OHNE ? null : v.prioritaet,
    art: v.art === OHNE ? null : v.art,
    fachrichtung: v.fachrichtung ?? null,
    ...(bestaetigt != null ? { bestaetigt_personal_id: bestaetigt } : {}),
  };
}

/** Transport festlegen: vorbelegt mit dem aktuellen Stand der Person. */
export function TransportPaneel({
  einsatzId,
  person,
  mutation,
  onSchliessen,
}: {
  einsatzId: number;
  person: PersonDetail;
  mutation: UseMutationResult<unknown, Error, TransportEingabe>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<TransportWerte>();
  return (
    <section aria-label="Transport festlegen" data-lfh="transport-paneel">
      <ErfassungsFormular<TransportWerte>
        form={form}
        erfassenText="Transport festlegen"
        laeuft={mutation.isPending}
        speicherung={mutation}
        speicherFehlerTitel="Transport nicht festgelegt"
        initialValues={{
          prioritaet: person.transport_prioritaet ?? OHNE,
          art: person.transport_art ?? OHNE,
          fachrichtung: person.transport_fachrichtung ?? undefined,
        }}
        onErfassen={(v) => mutation.mutateAsync(transportEingabe(v))}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        <Form.Item label="Priorität" name="prioritaet">
          <SegmentFeld<TransportPrioritaet>
            optionen={PRIORITAET_OPTIONEN}
            beschriftung="Priorität"
          />
        </Form.Item>
        <Form.Item label="Art" name="art">
          <SegmentFeld<TransportArt> optionen={ART_OPTIONEN} beschriftung="Art" />
        </Form.Item>
        <Form.Item label="Fachrichtung" name="fachrichtung">
          <Select<Fachrichtung> allowClear options={FACHRICHTUNG_OPTIONEN} />
        </Form.Item>
        <BestaetigtVonFeld einsatzId={einsatzId} />
      </ErfassungsFormular>
    </section>
  );
}

interface MassnahmeWerte {
  art?: MassnahmeArt;
  durchgefuehrt?: Dayjs | null;
  [BESTAETIGT_FELD]?: number;
}

const MASSNAHME_OPTIONEN = MASSNAHME_REIHE.map((m) => ({ wert: m, label: MASSNAHME_WORT[m] }));

/** Formularwerte → Eingabe; ohne Uhrzeit setzt der Server die Erfassung als Durchführung. */
export function massnahmeEingabe(v: MassnahmeWerte & { art: MassnahmeArt }): MassnahmeEingabe {
  const bestaetigt = v[BESTAETIGT_FELD];
  return {
    art: v.art,
    ...(v.durchgefuehrt ? { zeitpunkt_at: alsBackendZeit(v.durchgefuehrt) } : {}),
    ...(bestaetigt != null ? { bestaetigt_personal_id: bestaetigt } : {}),
  };
}

/**
 * Maßnahme erfassen: Wahl aus dem Katalog als Flächen, optional die Uhrzeit der Durchführung.
 * Darunter die gültigen Maßnahmen mit „Aufheben“ (genau einmal, Spec `personen-massnahmen`):
 * eine versehentlich erfasste Maßnahme wird so korrigiert, sie bleibt im Verlauf.
 */
export function MassnahmePaneel({
  einsatzId,
  person,
  mutation,
  aufheben,
  onSchliessen,
}: {
  einsatzId: number;
  person: PersonDetail;
  mutation: UseMutationResult<unknown, Error, MassnahmeEingabe>;
  aufheben: UseMutationResult<unknown, Error, number>;
  onSchliessen: () => void;
}) {
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const [form] = Form.useForm<MassnahmeWerte>();
  const erfasst = gueltig(person.massnahmen ?? []);
  const name = (m: Massnahme) =>
    `Maßnahme ${MASSNAHME_WORT[m.art]} ${taktischeUhrzeit(m.zeitpunkt_at, konventionen)} aufheben`;
  return (
    <section aria-label="Maßnahme erfassen" data-lfh="massnahme-paneel">
      <ErfassungsFormular<MassnahmeWerte>
        form={form}
        erfassenText="Maßnahme erfassen"
        laeuft={mutation.isPending}
        speicherung={mutation}
        speicherFehlerTitel="Maßnahme nicht erfasst"
        onErfassen={(v) => mutation.mutateAsync(massnahmeEingabe({ ...v, art: v.art! }))}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        <Form.Item
          label="Maßnahme"
          name="art"
          rules={[{ required: true, message: 'Bitte eine Maßnahme wählen' }]}
        >
          <FlaechenWahl<MassnahmeArt> optionen={MASSNAHME_OPTIONEN} aria-label="Maßnahme" />
        </Form.Item>
        <Form.Item label="Durchgeführt (optional)" name="durchgefuehrt">
          <ZeitpunktEingabe art="ereignis" keineZukunftstage />
        </Form.Item>
        <BestaetigtVonFeld einsatzId={einsatzId} />
      </ErfassungsFormular>
      {erfasst.length > 0 && (
        <Flex vertical gap={token.marginXS} style={{ marginTop: token.marginSM }}>
          <Typography.Text type="secondary">Erfasst</Typography.Text>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {erfasst.map((m) => (
              <li key={m.id}>
                <Flex align="center" gap={token.marginSM} wrap>
                  <span>
                    {MASSNAHME_WORT[m.art]} · <ZeitAnzeige wert={m.zeitpunkt_at} format="uhrzeit" />
                    {m.bestaetigt_name && (
                      <Typography.Text type="secondary">
                        {` · bestätigt: ${m.bestaetigt_name}`}
                      </Typography.Text>
                    )}
                  </span>
                  <Button
                    danger
                    aria-label={name(m)}
                    disabled={aufheben.isPending || mutation.isPending}
                    loading={aufheben.isPending && aufheben.variables === m.id}
                    onClick={() => aufheben.mutate(m.id)}
                  >
                    Aufheben
                  </Button>
                </Flex>
              </li>
            ))}
          </ul>
          {aufheben.error != null && (
            <SpeicherFehler fehler={aufheben.error} titel="Maßnahme nicht aufgehoben" />
          )}
        </Flex>
      )}
    </section>
  );
}
