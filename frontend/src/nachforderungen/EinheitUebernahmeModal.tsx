import { Checkbox, Form, Typography } from 'antd';
import type { Rule } from 'antd/es/form';
import { useEffect, useMemo, useRef } from 'react';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import type { Einheit, EinheitTyp, Nachforderung } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { Select } from '../components/Select';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import {
  bereinigeZeilen,
  bestehendeEinheit,
  einheitenVorbelegung,
  einheitVorschlaege,
  isWeitereEinheit,
  restAnzahl,
  typVorbelegung,
  type EinheitUebernahmeWerte,
} from './einheitUebernahme';

type NachforderungImDialog = Pick<
  Nachforderung,
  | 'id'
  | 'art'
  | 'anzahl'
  | 'bezeichnung'
  | 'status'
  | 'einheit_ids'
  | 'material_ids'
  | 'zusage_rufnamen'
  | 'ziel_br_id'
>;
type EinheitImDialog = Pick<
  Einheit,
  'id' | 'name' | 'funkrufname' | 'nachforderung_id' | 'aufgeloest_at'
>;

export interface EinheitUebernahmeModalProps {
  /** Die Nachforderung im aktuellen Stand; `null` = zu. */
  nachforderung: NachforderungImDialog | null;
  /** Die aktiven Einheiten des Einsatzes: Vorschläge und „wird verknüpft“ (D3). */
  einheiten: readonly EinheitImDialog[];
  /** Der Katalog der Einheitstypen; leer, solange er lädt. */
  typen: readonly Pick<EinheitTyp, 'id' | 'label'>[];
  /** Name des Bereitstellungsraums der Nachforderung, soweit bekannt. */
  raumName?: string | null;
  /** Modul Bereitstellungsräume nicht bedienbar: der Haken steht gesperrt. */
  raumGesperrt?: boolean;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); der Dialog bleibt dann mit dem Grund offen. */
  onUebernehmen: (werte: EinheitUebernahmeWerte) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Je Eintrag eine Einheit; höchstens der Rest der Anzahl, jeder Name in der Grenze (D4). */
function einheitenRegeln(rest: number): Rule[] {
  return [
    {
      validator: (_r, wert: string[] | undefined) => {
        const zeilen = bereinigeZeilen(wert);
        if (zeilen.length === 0) return Promise.reject(new Error('Mindestens eine Einheit'));
        if (zeilen.some((z) => z.length > EINHEIT_NAME_MAX)) {
          return Promise.reject(new Error(`Höchstens ${EINHEIT_NAME_MAX} Zeichen je Eintrag`));
        }
        if (zeilen.length > rest) {
          return Promise.reject(
            new Error(
              rest === 1 ? 'Höchstens eine weitere Einheit' : `Höchstens ${rest} Einheiten`,
            ),
          );
        }
        return Promise.resolve();
      },
    },
  ];
}

/**
 * „Als Einheit übernehmen“ an einer eingetroffenen Nachforderung (LLH-1383, design.md D9) auf der
 * Erfassungs-Hülle. Drei Felder (Feldbudget Modal): Einheiten, Typ und, wenn das Ziel ein
 * Bereitstellungsraum ist, der Haken für die Buchung dort. Ein Eintrag, der einer Einheit im
 * Einsatz gleicht, verknüpft sie; der Dialog nennt sie, bevor abgeschickt wird (D3).
 *
 * Vorbelegt wird beim Öffnen, nie bei einem Live-Abgleich: der überschriebe mitten im Tippen.
 */
export default function EinheitUebernahmeModal({
  nachforderung,
  einheiten,
  typen,
  raumName,
  raumGesperrt = false,
  laeuft,
  speicherung,
  onUebernehmen,
  onSchliessen,
}: EinheitUebernahmeModalProps) {
  const [form] = Form.useForm<EinheitUebernahmeWerte>();
  // Stand in einer Ref: der Vorbeleg-Effekt hängt nur am Öffnen (Muster `MaterialUebernahmeModal`).
  const stand = useRef({ nachforderung, einheiten, typen, raumGesperrt });
  useEffect(() => {
    stand.current = { nachforderung, einheiten, typen, raumGesperrt };
  }, [nachforderung, einheiten, typen, raumGesperrt]);
  const offenId = nachforderung?.id ?? null;
  useEffect(() => {
    const s = stand.current;
    const n = s.nachforderung;
    if (offenId == null || !n) return;
    form.setFieldsValue({
      einheiten: einheitenVorbelegung(n, s.einheiten),
      typ_id: typVorbelegung(n, s.typen),
      in_bereitstellungsraum: n.ziel_br_id != null && !s.raumGesperrt,
    });
  }, [offenId, form]);
  // Der Typenkatalog kommt evtl. erst nach dem Öffnen: dann einmal nachtragen, solange leer.
  useEffect(() => {
    const n = stand.current.nachforderung;
    if (offenId == null || !n || typen.length === 0) return;
    if (form.getFieldValue('typ_id') == null && !form.isFieldTouched('typ_id')) {
      form.setFieldValue('typ_id', typVorbelegung(n, typen));
    }
  }, [offenId, typen, form]);

  const zeilen = Form.useWatch('einheiten', form);
  const verknuepft = useMemo(
    () =>
      bereinigeZeilen(zeilen).flatMap((z) => {
        const e = bestehendeEinheit(z, einheiten);
        return e ? [z] : [];
      }),
    [zeilen, einheiten],
  );
  const vorschlaege = useMemo(
    () => einheitVorschlaege(einheiten).map((v) => ({ value: v, label: v })),
    [einheiten],
  );
  const typOptionen = useMemo(() => typen.map((t) => ({ value: t.id, label: t.label })), [typen]);

  const weitere = nachforderung ? isWeitereEinheit(nachforderung) : false;
  const rest = nachforderung ? restAnzahl(nachforderung) : 0;
  const art = nachforderung?.art.trim() ?? '';
  // „In BR Nord eintragen“; ein Raum, der schon „BR …“ heißt, bekommt das Kürzel nicht doppelt.
  const raum = raumName?.trim();
  const raumEtikett = raum
    ? `In ${/^br\b/i.test(raum) ? raum : `BR ${raum}`} eintragen`
    : 'Im Bereitstellungsraum eintragen';
  return (
    <ErfassungsModal<EinheitUebernahmeWerte>
      offen={nachforderung != null}
      titel={
        nachforderung
          ? weitere
            ? `Weitere Einheit „${art}“ übernehmen`
            : `„${art}“ als Einheit übernehmen`
          : undefined
      }
      form={form}
      erfassenText="Übernehmen"
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht übernommen"
      speicherFehlerFallback="Übernehmen fehlgeschlagen"
      onErfassen={(w) => onUebernehmen(w)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {nachforderung?.bezeichnung && (
        <Typography.Paragraph type="secondary">{nachforderung.bezeichnung}</Typography.Paragraph>
      )}
      <Form.Item
        label="Einheiten"
        name="einheiten"
        rules={einheitenRegeln(rest)}
        extra={
          verknuepft.length > 0
            ? `Schon im Einsatz, wird verknüpft: ${verknuepft.join(', ')}`
            : undefined
        }
      >
        <Select<string[]>
          aria-label="Einheiten"
          mode="tags"
          tokenSeparators={[',']}
          options={vorschlaege}
          maxCount={rest > 0 ? rest : undefined}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item
        label="Typ"
        name="typ_id"
        style={nachforderung?.ziel_br_id == null ? { marginBottom: 0 } : undefined}
      >
        <Select<number | null> aria-label="Typ" allowClear options={typOptionen} />
      </Form.Item>
      {nachforderung?.ziel_br_id != null && (
        <Form.Item
          name="in_bereitstellungsraum"
          valuePropName="checked"
          extra={raumGesperrt ? KEINE_BERECHTIGUNG : undefined}
          style={{ marginBottom: 0 }}
        >
          <Checkbox disabled={raumGesperrt}>{raumEtikett}</Checkbox>
        </Form.Item>
      )}
    </ErfassungsModal>
  );
}
