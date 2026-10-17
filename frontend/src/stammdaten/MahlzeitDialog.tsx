import { Flex, Form, Input, type InputProps } from 'antd';
import type { RuleObject } from 'antd/es/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseUhrzeit, taktischeUhrzeitAus } from '../anzeige/uhrzeit';
import { VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import { globalKeys } from '../api/queryKeys';
import type {
  Verpflegungsart,
  VerpflegungVorlage,
  VerpflegungVorlageEingabe,
  VerpflegungVorlagePatch,
} from '../api/types';
import { createVerpflegungVorlage, updateVerpflegungVorlage } from '../api/verpflegungVorlagen';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { VERPFLEGUNGSART_LABEL } from '../verpflegung/verpflegungText';

/**
 * Mahlzeit des Verpflegungsplans anlegen oder bearbeiten (LLH-1058, Spec `kraefte-verpflegung`,
 * „Verpflegungsplan in der Verwaltung“). Drei Zeilen: Bezeichnung, Beginn und Ende nebeneinander
 * (EIN Zeitraum, wie `ZeitraumEingabe` im Zeitfensterdialog), Art.
 *
 * Uhrzeiten über die Maske `anzeige/uhrzeit.ts:parseUhrzeit` („0630“, „06:30“, „630“, „6:30“);
 * gesendet wird `HH:MM`. Ende gleich Beginn ist kein Zeitraum und steht am Feld, bevor der Server
 * 422 sagt; ein Ende vor dem Beginn ist der Folgetag und steht als Zustand unter dem Feld.
 *
 * PATCH nur mit geänderten Schlüsseln; Art leeren schickt `null`. Ein leerer PATCH geht nicht hinaus.
 */

interface FormWerte {
  bezeichnung: string;
  beginn: string;
  ende: string;
  verpflegungsart?: Verpflegungsart | null;
}

const ART_OPTIONEN = (Object.keys(VERPFLEGUNGSART_LABEL) as Verpflegungsart[]).map((a) => ({
  value: a,
  label: VERPFLEGUNGSART_LABEL[a],
}));

/** Der Prüftext einer unlesbaren Uhrzeit nennt das Muster, nicht die Regel. */
export const UHRZEIT_UNLESBAR = 'Uhrzeit wie 0630';
export const ENDE_GLEICH_BEGINN = 'Ende gleich Beginn';

const uhrzeitRegel: RuleObject = {
  validator: (_, wert: unknown) =>
    typeof wert === 'string' && wert.trim() !== '' && parseUhrzeit(wert) == null
      ? Promise.reject(new Error(UHRZEIT_UNLESBAR))
      : Promise.resolve(),
};

/** Body „Mahlzeit anlegen“ aus den Formularwerten (Uhrzeiten über die Maske). */
export function mahlzeitEingabe(w: FormWerte): VerpflegungVorlageEingabe {
  return {
    bezeichnung: w.bezeichnung.trim(),
    beginn: parseUhrzeit(w.beginn) ?? w.beginn,
    ende: parseUhrzeit(w.ende) ?? w.ende,
    ...(w.verpflegungsart ? { verpflegungsart: w.verpflegungsart } : {}),
  };
}

/** PATCH mit den geänderten Schlüsseln; `{}`, wenn nichts geändert ist. */
export function mahlzeitPatch(vorher: VerpflegungVorlage, w: FormWerte): VerpflegungVorlagePatch {
  const neu = mahlzeitEingabe(w);
  const patch: VerpflegungVorlagePatch = {};
  if (neu.bezeichnung !== vorher.bezeichnung) patch.bezeichnung = neu.bezeichnung;
  if (neu.beginn !== vorher.beginn) patch.beginn = neu.beginn;
  if (neu.ende !== vorher.ende) patch.ende = neu.ende;
  const art = w.verpflegungsart ?? null;
  if (art !== (vorher.verpflegungsart ?? null)) patch.verpflegungsart = art;
  return patch;
}

/** Endet die Mahlzeit nach den Feldwerten am Folgetag? Nur bei zwei lesbaren Uhrzeiten. */
function isFolgetag(beginn: unknown, ende: unknown): boolean {
  const b = typeof beginn === 'string' ? parseUhrzeit(beginn) : null;
  const e = typeof ende === 'string' ? parseUhrzeit(ende) : null;
  return b != null && e != null && e < b;
}

/** Ein Uhrzeitfeld: Ziffernblock am Touchgerät, kurz, ohne Zähler (`maxLength` genügt). */
function UhrzeitFeld(props: InputProps) {
  return (
    <Input
      {...props}
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="0630"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    />
  );
}

export default function MahlzeitDialog({
  mahlzeit,
  onSchliessen,
}: {
  /** `null` = neu anlegen. */
  mahlzeit: VerpflegungVorlage | null;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const beginn = Form.useWatch('beginn', form);
  const ende = Form.useWatch('ende', form);

  const mutation = useMutation({
    mutationFn: (w: FormWerte) => {
      if (!mahlzeit) return createVerpflegungVorlage(mahlzeitEingabe(w));
      const patch = mahlzeitPatch(mahlzeit, w);
      return Object.keys(patch).length === 0
        ? Promise.resolve(mahlzeit)
        : updateVerpflegungVorlage(mahlzeit.id, patch);
    },
    // Das Schließen macht `onFertig`, das Leeren die Hülle; den Grund einer Ablehnung nennt die
    // Hülle im Dialog (`speicherung`, LFH-1077).
    onSuccess: () => void qc.invalidateQueries({ queryKey: globalKeys.verpflegungVorlagen() }),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen
      titel={mahlzeit ? `Mahlzeit bearbeiten: ${mahlzeit.bezeichnung}` : 'Mahlzeit anlegen'}
      form={form}
      erfassenText={mahlzeit ? 'Speichern' : 'Anlegen'}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel={mahlzeit ? 'Nicht gespeichert' : 'Nicht angelegt'}
      initialValues={
        mahlzeit
          ? {
              bezeichnung: mahlzeit.bezeichnung,
              beginn: taktischeUhrzeitAus(mahlzeit.beginn),
              ende: taktischeUhrzeitAus(mahlzeit.ende),
              verpflegungsart: mahlzeit.verpflegungsart ?? undefined,
            }
          : undefined
      }
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<FormWerte>
        name="bezeichnung"
        label="Bezeichnung"
        rules={[
          { required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' },
          zeichenRegel(VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX, 'Bezeichnung'),
        ]}
      >
        <Input
          placeholder="z. B. Frühstück"
          count={zeichenGrenze(VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX)}
        />
      </Form.Item>
      <Flex gap="middle" wrap>
        <Form.Item<FormWerte>
          name="beginn"
          label="Beginn"
          style={{ flex: '1 1 120px' }}
          rules={[
            { required: true, whitespace: true, message: 'Bitte Beginn angeben' },
            uhrzeitRegel,
          ]}
        >
          <UhrzeitFeld />
        </Form.Item>
        <Form.Item<FormWerte>
          name="ende"
          label="Ende"
          style={{ flex: '1 1 120px' }}
          dependencies={['beginn']}
          extra={isFolgetag(beginn, ende) ? 'Ende am Folgetag' : undefined}
          rules={[
            { required: true, whitespace: true, message: 'Bitte Ende angeben' },
            uhrzeitRegel,
            ({ getFieldValue }) => ({
              validator: (_, wert: unknown) => {
                const b = parseUhrzeit(String(getFieldValue('beginn') ?? ''));
                const e = typeof wert === 'string' ? parseUhrzeit(wert) : null;
                return b != null && b === e
                  ? Promise.reject(new Error(ENDE_GLEICH_BEGINN))
                  : Promise.resolve();
              },
            }),
          ]}
        >
          <UhrzeitFeld />
        </Form.Item>
      </Flex>
      <Form.Item<FormWerte> name="verpflegungsart" label="Art" style={{ marginBottom: 0 }}>
        <Select allowClear placeholder="ohne Angabe" options={ART_OPTIONEN} />
      </Form.Item>
    </ErfassungsModal>
  );
}
