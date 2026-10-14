import { App, Form } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SAMMEL_MAX } from '../api/eingabegrenzen';
import { listeEinheiten } from '../api/einheiten';
import {
  disponiereFahrzeugeSammel,
  listeEinsatzFahrzeuge,
  type SammelFahrzeugEingabe,
} from '../api/einsatzFahrzeuge';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { nichtGefundenInhalt } from '../components/SeitenZustand';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import { demoGroupedOptions, SUCHTEXT_SUCHE } from '../stammdaten/demoAuswahl';
import { GruendeListe, gruendeTagRender } from './SammelGruende';
import {
  aktiveEinheiten,
  erfolgText,
  fahrzeugLabel,
  fahrzeugSuchtext,
  gruendeJeKraft,
} from './sammelDisposition';

interface FahrzeugeDisponierenModalProps {
  offen: boolean;
  einsatzId: number;
  /** Serienmodus wie in der Fahrzeug-Liste: eine Einheit nach der anderen. */
  serie?: boolean;
  onSchliessen: () => void;
}

type Werte = { fahrzeug_ids: number[]; einheit_id?: number };

/**
 * Fahrzeuge disponieren (LLH-1100, Spec `kraefte-disposition`, Change
 * `iw7x9980-sammel-disposition`): mehrere Stamm-Fahrzeuge in einem Absenden, optional in eine
 * Einheit — das Feld nur bei Freigabe des Moduls Einheiten (D4). Keine Zeitachse für Fahrzeuge
 * (D6). „Werte behalten“ hält die Einheit (D8). Gründe je Fahrzeug wie im Personal-Dialog.
 */
export default function FahrzeugeDisponierenModal({
  offen,
  einsatzId,
  serie = false,
  onSchliessen,
}: FahrzeugeDisponierenModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<Werte>();
  const freigaben = useModulFreigaben(einsatzId);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  /** Namen der zuletzt abgesendeten Auswahl: die Gründe nennen sie, auch wenn die Liste wechselt. */
  const [namen, setNamen] = useState<ReadonlyMap<number, string>>(new Map());

  const poolQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('im-dienst'),
    queryFn: () => listeFahrzeuge(true),
    enabled: offen,
  });
  const aktivQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: offen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: offen && einheitenFrei,
  });

  const mutation = useMutation({
    mutationFn: (eingabe: SammelFahrzeugEingabe) => disponiereFahrzeugeSammel(einsatzId, eingabe),
    onSuccess: (angelegt) => {
      message.success(erfolgText(angelegt.length, 'fahrzeug'));
      for (const key of [
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.etb(einsatzId),
        einsatzKeys.einheiten(einsatzId),
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });

  const vergeben = new Set(
    (aktivQuery.data ?? []).map((e) => e.fahrzeug_id).filter((x): x is number => x != null),
  );
  const pool = (poolQuery.data ?? []).filter((f) => !vergeben.has(f.id));
  const optionen = demoGroupedOptions(pool, fahrzeugLabel, fahrzeugSuchtext);
  // Ein leeres Feld nennt den Ausfall, wenn die Liste nicht ankam — sonst behauptete es „Keine
  // freien Fahrzeuge“. Kein `kein403`: die Stamm-Routen sind org-lesbar ohne Admin-Schranke.
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, { allgemein: 'Fahrzeugliste konnte nicht geladen werden' }) ??
    'Keine freien Fahrzeuge';
  const einheitOptionen = aktiveEinheiten(einheitenQuery.data ?? []).map((e) => ({
    value: e.id,
    label: e.name,
  }));

  const gewaehlt = Form.useWatch('fahrzeug_ids', form);
  const alleGruende = gruendeJeKraft(mutation.error, 'fahrzeug');
  const gewaehlteIds = new Set(gewaehlt ?? []);
  const gruende = new Map([...alleGruende].filter(([id]) => gewaehlteIds.has(id)));
  const name = (id: number) => namen.get(id) ?? `Fahrzeug ${id}`;

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel="Fahrzeuge disponieren"
      form={form}
      erfassenText="Disponieren"
      serie={serie}
      // „Werte behalten“ nur, wenn es etwas zu behalten gibt: das Feld Einheit steht.
      uebernahme={einheitenFrei ? ['einheit_id'] : undefined}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht disponiert"
      speicherFehlerFallback="Disponieren fehlgeschlagen"
      onErfassen={(w) => {
        const labels = new Map(pool.map((f) => [f.id, fahrzeugLabel(f)] as const));
        setNamen(new Map(w.fahrzeug_ids.map((id) => [id, labels.get(id) ?? `Fahrzeug ${id}`])));
        return mutation.mutateAsync({ fahrzeug_ids: w.fahrzeug_ids, einheit_id: w.einheit_id });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Fahrzeuge"
        name="fahrzeug_ids"
        rules={[
          { required: true, message: 'Mindestens ein Fahrzeug wählen' },
          {
            type: 'array',
            max: SAMMEL_MAX,
            message: `Höchstens ${SAMMEL_MAX} Fahrzeuge je Absenden`,
          },
        ]}
        // Ohne Gründe kein `extra`: antd hielte sonst eine leere Zeile unter dem Feld frei.
        extra={
          gruende.size > 0 ? (
            <GruendeListe
              gruende={gruende}
              name={name}
              onAbwaehlen={() =>
                form.setFieldValue(
                  'fahrzeug_ids',
                  (gewaehlt ?? []).filter((id) => !alleGruende.has(id)),
                )
              }
            />
          ) : undefined
        }
      >
        <Select<number[]>
          mode="multiple"
          maxTagCount="responsive"
          showSearch={SUCHTEXT_SUCHE}
          options={optionen}
          notFoundContent={poolInhalt}
          tagRender={gruendeTagRender(gruende, name)}
          placeholder="Funkrufname, Typ, Kennzeichen oder Träger"
        />
      </Form.Item>
      {einheitenFrei && (
        <Form.Item label="In Einheit" name="einheit_id">
          <Select<number>
            allowClear
            placeholder="optional"
            options={einheitOptionen}
            notFoundContent="Keine Einheit im Einsatz"
          />
        </Form.Item>
      )}
    </ErfassungsModal>
  );
}
