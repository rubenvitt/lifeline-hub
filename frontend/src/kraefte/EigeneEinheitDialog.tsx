import { useEffect } from 'react';
import { App, Form, Input, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeEinheitTypen } from '../api/einheitTypen';
import { bildeEinheit } from '../api/einheiten';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einsatzabschnitt, EinsatzFahrzeug, EinsatzPersonal } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { nichtGefundenInhalt } from '../components/SeitenZustand';
import { zeichenRegel } from '../components/zeichenGrenze';
import { besatzungZeile, mitkommendeBesatzung, typVorgabe } from './eigeneEinheit';
import { gruendeJeKraft } from './sammelDisposition';

type Werte = { name: string; typ_id?: number; abschnitt_id?: number };

export interface EigeneEinheitDialogProps {
  einsatzId: number;
  /** Das Fahrzeug ohne Einheit, das als eigene Einheit geführt wird; `null` = Dialog zu. */
  fahrzeug: EinsatzFahrzeug | null;
  /** Personal des Einsatzes, für die Zeile „Besatzung: …“ (die Seite lädt es schon). */
  personal: readonly EinsatzPersonal[];
  /** Abschnitte zur Wahl; `null` ohne Freigabe des Moduls Einsatzabschnitte (Feld entfällt). */
  abschnitte: readonly Einsatzabschnitt[] | null;
  onSchliessen: () => void;
}

/**
 * Dialog „Als eigene Einheit führen“ (LLH-1073, design.md D9, Spec `fahrzeug-bearbeitung`): bildet
 * aus einem Fahrzeug ohne Einheit in einem Schritt eine Einheit mit diesem Fahrzeug. Drei Felder
 * (Feldbudget LFH-19): Name, vorbelegt mit dem Funkrufnamen; Typ, vorbelegt nur bei genau einem
 * Katalogtyp mit dem Soll des Fahrzeugs; Abschnitt nur mit Freigabe. Das Soll der Einheit ist das
 * des Fahrzeugs. Darunter die Besatzung, die mitkommt, als Datenzeile. Ein schon zugeordnetes oder
 * beendetes Fahrzeug lehnt der Server ab; der Grund steht im Dialog. Nach dem Bilden bleibt die
 * Seite, ein Toast nennt die Einheit.
 */
export default function EigeneEinheitDialog({
  einsatzId,
  fahrzeug,
  personal,
  abschnitte,
  onSchliessen,
}: EigeneEinheitDialogProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<Werte>();
  const offen = fahrzeug !== null;
  const typenQuery = useQuery({
    queryKey: globalKeys.einheitTypen(),
    queryFn: listeEinheitTypen,
    enabled: offen,
  });
  const vorgabeTyp = fahrzeug
    ? typVorgabe(typenQuery.data ?? [], fahrzeug.soll_besatzung ?? null)
    : undefined;

  // Vorbelegen ist kein Reset (das Leeren besitzt die Erfassungshülle). Der Typ kommt nach, wenn
  // der Katalog erst nach dem Öffnen ankommt, aber nie über eine Wahl hinweg.
  useEffect(() => {
    if (!fahrzeug) return;
    form.setFieldsValue({ name: fahrzeug.funkrufname });
  }, [fahrzeug, form]);
  useEffect(() => {
    if (!fahrzeug || form.isFieldTouched('typ_id')) return;
    form.setFieldsValue({ typ_id: vorgabeTyp });
  }, [fahrzeug, vorgabeTyp, form]);

  const mutation = useMutation({
    mutationFn: (v: { ef: EinsatzFahrzeug; werte: Werte }) =>
      bildeEinheit(einsatzId, {
        name: v.werte.name.trim(),
        typ_id: v.werte.typ_id ?? null,
        abschnitt_id: v.werte.abschnitt_id ?? null,
        soll_fuehrer: v.ef.soll_besatzung?.fuehrer ?? null,
        soll_unterfuehrer: v.ef.soll_besatzung?.unterfuehrer ?? null,
        soll_mannschaft: v.ef.soll_besatzung?.mannschaft ?? null,
        fahrzeug_ids: [v.ef.id],
      }),
    onSuccess: (einheit) => {
      message.success(`Einheit «${einheit.name}» gebildet`);
      for (const key of [
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.personal(einsatzId),
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.etb(einsatzId),
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });

  const grund = fahrzeug ? gruendeJeKraft(mutation.error, 'fahrzeug').get(fahrzeug.id) : undefined;
  const zeile = fahrzeug ? besatzungZeile(mitkommendeBesatzung(personal, fahrzeug.id)) : null;

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel={fahrzeug ? `${fahrzeug.funkrufname} als eigene Einheit führen` : 'Als Einheit führen'}
      form={form}
      erfassenText="Einheit bilden"
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Einheit nicht gebildet"
      speicherFehlerFallback="Bilden fehlgeschlagen"
      onErfassen={async (werte) => {
        if (!fahrzeug) return;
        await mutation.mutateAsync({ ef: fahrzeug, werte });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {/* Ein vorbelegter Stamm-Funkrufname über der Grenze wird nie gekürzt, er sperrt das Senden
          (`frontend/AGENTS.md`, Erfassungs-Norm). */}
      <Form.Item
        label="Name"
        name="name"
        rules={[{ required: true, whitespace: true }, zeichenRegel(EINHEIT_NAME_MAX, 'Name')]}
      >
        <Input maxLength={EINHEIT_NAME_MAX} />
      </Form.Item>
      <Form.Item label="Typ" name="typ_id">
        <Select<number>
          allowClear
          placeholder="ohne Typ"
          notFoundContent={nichtGefundenInhalt(typenQuery, {
            allgemein: 'Einheitentypen konnten nicht geladen werden',
          })}
          options={(typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }))}
        />
      </Form.Item>
      {abschnitte && (
        <Form.Item label="Abschnitt" name="abschnitt_id">
          <Select<number>
            allowClear
            placeholder="ohne Abschnitt"
            notFoundContent="Kein Abschnitt im Einsatz"
            options={abschnitte.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
      )}
      {grund && fahrzeug && (
        <Typography.Paragraph type="danger" data-lfh="eigene-einheit-grund">
          {fahrzeug.funkrufname} – {grund}
        </Typography.Paragraph>
      )}
      {zeile && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {zeile}
        </Typography.Paragraph>
      )}
    </ErfassungsModal>
  );
}
