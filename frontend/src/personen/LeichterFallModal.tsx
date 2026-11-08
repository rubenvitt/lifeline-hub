import { Form, Input, InputNumber } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ladeVersorgendeEinheiten, type PersonAnlegenEingabe } from '../api/einsatzPerson';
import { PERSON_ANGABE_MAX, PERSON_NAME_MAX } from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import type { MassnahmeArt, PersonAnlass, Uhs, VersorgendeEinheitAuswahl } from '../api/types';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../anzeige/Ortsfeld';
import { ortFelder, ortRegeln } from '../anzeige/ortsfeldFormular';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import FormularEingehaengt from '../components/FormularEingehaengt';
import { Select } from '../components/Select';
import { useRollen } from '../components/instrument';
import { useFormularEingehaengt } from '../components/useFormularEingehaengt';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import AnlassWahl from './AnlassWahl';
import { FlaechenMehrfachWahl } from './FlaechenWahl';
import { fundortAusText } from './AufnahmeFelder';
import { LEICHTE_MASSNAHMEN, LEICHTE_MASSNAHMEN_MAX, MASSNAHME_WORT } from './personMeta';
import { einheitText } from './VersorgtVon';

/** Titel und Primärknopf des Dialogs (LLH-1572, design.md D2). */
export const LEICHTER_FALL_TITEL = 'Versorgt und entlassen';

const MASSNAHMEN_OPTIONEN = LEICHTE_MASSNAHMEN.map((m) => ({ wert: m, label: MASSNAHME_WORT[m] }));

/** „Versorgt von“ als ein Schlüssel: `uhs:3` oder `einheit:7`. */
type VersorgtVonSchluessel = `uhs:${number}` | `einheit:${number}`;

export interface LeichterFallWerte {
  anlass?: PersonAnlass | null;
  massnahmen?: MassnahmeArt[];
  versorgt_von?: VersorgtVonSchluessel | null;
  antreff_ort?: OrtsfeldWert;
  name?: string;
  alter_geschaetzt?: number | null;
}

/** Die feste Stelle eines Geräts (design.md D2/D4): die eigene UHS, die Wahl entfällt. */
export type LeichterFallStelle = {
  art: 'uhs';
  uhs: Pick<Uhs, 'id' | 'bezeichnung' | 'lat' | 'lon'>;
};

/** Fundort aus der UHS: ihre Bezeichnung, ihre Koordinate, wenn sie eine hat (design.md D4). */
export function fundortAusUhs(uhs: Pick<Uhs, 'bezeichnung' | 'lat' | 'lon'>): OrtsfeldWert {
  return {
    text: uhs.bezeichnung,
    koordinate: uhs.lat != null && uhs.lon != null ? { lat: uhs.lat, lon: uhs.lon } : null,
  };
}

/** Fundort aus der Einheit: ihr Abschnitt, ohne Abschnitt ihr Name (design.md D4). */
export function fundortAusEinheit(
  einheit: Pick<VersorgendeEinheitAuswahl, 'name' | 'abschnitt_name'>,
): OrtsfeldWert {
  return fundortAusText(einheit.abschnitt_name ?? einheit.name);
}

function liesSchluessel(
  roh: string | null | undefined,
): { art: 'uhs' | 'einheit'; id: number } | null {
  const m = /^(uhs|einheit):(\d+)$/.exec(roh ?? '');
  return m ? { art: m[1] as 'uhs' | 'einheit', id: Number(m[2]) } : null;
}

/**
 * Formularwerte → Anlage des leichten Falls (design.md D1/D5): Status `betroffen`, ohne Sichtung,
 * mit `entlassen`; „Versorgt von“ wird zu `uhs_id` oder `versorgende_einheit_id`. Rein.
 */
export function leichterFallZuEingabe(
  werte: LeichterFallWerte,
  stelle: LeichterFallStelle | null,
): PersonAnlegenEingabe {
  const ort = ortFelder(werte.antreff_ort);
  const name = werte.name?.trim();
  const bezug = stelle
    ? { art: 'uhs' as const, id: stelle.uhs.id }
    : liesSchluessel(werte.versorgt_von);
  return {
    status: 'betroffen',
    entlassen: true,
    ...(werte.anlass ? { anlass: werte.anlass } : {}),
    ...(werte.massnahmen && werte.massnahmen.length > 0 ? { massnahmen: werte.massnahmen } : {}),
    ...(name ? { name } : {}),
    ...(werte.alter_geschaetzt != null ? { alter_geschaetzt: werte.alter_geschaetzt } : {}),
    ...(ort.text != null ? { antreff_ort: ort.text } : {}),
    ...(ort.lat != null && ort.lon != null ? { antreff_lat: ort.lat, antreff_lon: ort.lon } : {}),
    ...(bezug?.art === 'uhs' ? { uhs_id: bezug.id } : {}),
    ...(bezug?.art === 'einheit' ? { versorgende_einheit_id: bezug.id } : {}),
  };
}

const MASKE = 'leichter-fall';

interface Props {
  einsatzId: number;
  offen: boolean;
  /** Feste Stelle des Geräts; ohne sie wählt man „Versorgt von“ aus UHS und Einheiten. */
  stelle?: LeichterFallStelle | null;
  /** Die UHS des Einsatzes für „Versorgt von“; nur aktive stehen zur Wahl. */
  uhsListe?: readonly Uhs[];
  laeuft: boolean;
  /** Anlegen. **Muss bei Ablehnung ablehnen** (`mutateAsync`). */
  onErfassen: (daten: PersonAnlegenEingabe) => Promise<unknown>;
  onFertig: () => void;
  onAbbrechen: () => void;
  speicherung?: Speicherung;
}

/**
 * Dialog „Versorgt und entlassen“ (LLH-1572, Change `o1igsr0s-leichte-faelle`, design.md D2–D5):
 * ein leichter Fall in höchstens drei Griffen — öffnen, Anlass, „Entlassen“. Anlass ist Pflicht,
 * bis zu drei Maßnahmen als Flächen, Name und Alter optional. „Versorgt von“ belegt den Fundort
 * vor und bleibt für den nächsten Fall stehen (Sitzungswert je Einsatz, Serie mit „Werte
 * behalten“); am UHS-Gerät steht die eigene UHS fest. Gesendet wird über die offlinefähige
 * Anlage des Aufrufers: ein POST mit `entlassen`, ohne Netz vorgemerkt.
 */
export default function LeichterFallModal({
  einsatzId,
  offen,
  stelle = null,
  uhsListe = [],
  laeuft,
  onErfassen,
  onFertig,
  onAbbrechen,
  speicherung,
}: Props) {
  const [form] = Form.useForm<LeichterFallWerte>();
  const { token } = useRollen();
  const formular = useFormularEingehaengt();
  const geladen = useRef<string | null>(null);
  const mitWahl = stelle == null;

  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.personenEinheiten(einsatzId),
    queryFn: () => ladeVersorgendeEinheiten(einsatzId),
    enabled: offen && mitWahl,
  });
  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const aktiveUhs = useMemo(() => uhsListe.filter((u) => u.status === 'aktiv'), [uhsListe]);
  const versorgtVonOptionen = useMemo(
    () =>
      [
        aktiveUhs.length > 0 && {
          label: 'Unfallhilfsstellen',
          options: aktiveUhs.map((u) => ({ value: `uhs:${u.id}`, label: u.bezeichnung })),
        },
        einheiten.length > 0 && {
          label: 'Einheiten',
          options: einheiten.map((e) => ({
            value: `einheit:${e.id}`,
            label: einheitText(e.name, e.abschnitt_name) ?? e.name,
          })),
        },
      ].filter(Boolean) as { label: string; options: { value: string; label: string }[] }[],
    [aktiveUhs, einheiten],
  );

  const fundortVon = useCallback(
    (schluessel: string | null | undefined): OrtsfeldWert | undefined => {
      const bezug = liesSchluessel(schluessel);
      if (bezug?.art === 'uhs') {
        const uhs = aktiveUhs.find((u) => u.id === bezug.id);
        return uhs ? fundortAusUhs(uhs) : undefined;
      }
      if (bezug?.art === 'einheit') {
        const einheit = einheiten.find((e) => e.id === bezug.id);
        return einheit ? fundortAusEinheit(einheit) : undefined;
      }
      return undefined;
    },
    [aktiveUhs, einheiten],
  );

  // Beim Öffnen: die feste UHS bzw. die letzte Wahl „Versorgt von“ und ihr Fundort.
  useEffect(() => {
    if (!offen) {
      geladen.current = null;
      return;
    }
    if (!formular.da) return;
    const schluessel = stelle
      ? null
      : (liesErfassungsSitzungswert(einsatzId, MASKE, 'versorgt_von') ?? null);
    const kennung = `${einsatzId}:${schluessel ?? '-'}:${einheiten.length}:${aktiveUhs.length}`;
    if (geladen.current === kennung) return;
    if (stelle) {
      geladen.current = kennung;
      if (!form.getFieldValue('antreff_ort'))
        form.setFieldValue('antreff_ort', fundortAusUhs(stelle.uhs));
      return;
    }
    if (schluessel == null || form.getFieldValue('versorgt_von') != null) {
      geladen.current = kennung;
      return;
    }
    const ort = fundortVon(schluessel);
    // Erst setzen, wenn die Wahl geladen ist: eine aufgelöste Einheit oder geschlossene UHS
    // bleibt draußen.
    if (ort === undefined) return;
    geladen.current = kennung;
    form.setFieldsValue({ versorgt_von: schluessel as VersorgtVonSchluessel, antreff_ort: ort });
  }, [offen, formular.da, einsatzId, stelle, einheiten.length, aktiveUhs.length, fundortVon, form]);

  return (
    <ErfassungsModal<LeichterFallWerte>
      offen={offen}
      titel={LEICHTER_FALL_TITEL}
      form={form}
      erfassenText="Entlassen"
      onErfassen={(werte) => onErfassen(leichterFallZuEingabe(werte, stelle))}
      onErfasst={(werte) => {
        if (mitWahl && werte.versorgt_von) {
          schreibeErfassungsSitzungswert(einsatzId, MASKE, 'versorgt_von', werte.versorgt_von);
        }
      }}
      onFertig={onFertig}
      onAbbrechen={onAbbrechen}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Person nicht erfasst"
      serie
      uebernahme={mitWahl ? ['versorgt_von', 'antreff_ort'] : ['antreff_ort']}
    >
      <FormularEingehaengt onWechsel={formular.melde} />
      <Form.Item label="Anlass" name="anlass" rules={[{ required: true, message: 'Anlass fehlt' }]}>
        <AnlassWahl />
      </Form.Item>
      <Form.Item label="Maßnahmen" name="massnahmen">
        <FlaechenMehrfachWahl<MassnahmeArt>
          aria-label="Maßnahmen"
          optionen={MASSNAHMEN_OPTIONEN}
          max={LEICHTE_MASSNAHMEN_MAX}
        />
      </Form.Item>
      {mitWahl && (
        <Form.Item label="Versorgt von" name="versorgt_von">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={einheitenQuery.isLoading}
            options={versorgtVonOptionen}
            onChange={(wert: string | undefined) => {
              const ort = fundortVon(wert);
              if (ort) form.setFieldValue('antreff_ort', ort);
            }}
          />
        </Form.Item>
      )}
      {mitWahl ? (
        <Form.Item
          label="Fundort"
          name="antreff_ort"
          rules={ortRegeln(PERSON_ANGABE_MAX, 'Fundort')}
        >
          <EinsatzOrtsfeld
            einsatzId={einsatzId}
            etikett="Fundort"
            count={zeichenGrenze(PERSON_ANGABE_MAX)}
          />
        </Form.Item>
      ) : (
        <Form.Item
          label="Fundort"
          name="antreff_ort"
          rules={ortRegeln(PERSON_ANGABE_MAX, 'Fundort')}
          getValueProps={(w?: OrtsfeldWert) => ({ value: w?.text ?? '' })}
          normalize={(text: string) => fundortAusText(text)}
        >
          <Input count={zeichenGrenze(PERSON_ANGABE_MAX)} />
        </Form.Item>
      )}
      <div style={{ display: 'flex', gap: token.margin, flexWrap: 'wrap' }}>
        <Form.Item
          label="Name"
          name="name"
          rules={[zeichenRegel(PERSON_NAME_MAX, 'Name')]}
          style={{ flex: '1 1 200px' }}
        >
          <Input count={zeichenGrenze(PERSON_NAME_MAX)} />
        </Form.Item>
        <Form.Item label="Alter" name="alter_geschaetzt">
          <InputNumber min={0} max={120} style={{ width: 120 }} />
        </Form.Item>
      </div>
    </ErfassungsModal>
  );
}
