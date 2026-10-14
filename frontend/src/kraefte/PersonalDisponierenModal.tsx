import { App, Form } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SAMMEL_MAX } from '../api/eingabegrenzen';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import {
  disponierePersonalSammel,
  listeEinsatzPersonal,
  listEntlassenesPersonal,
  type SammelPersonalEingabe,
} from '../api/einsatzPersonal';
import { listePersonal } from '../api/personal';
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
  fahrzeugeDerEinheit,
  fahrzeugPasstZurEinheit,
  gruendeJeKraft,
  personalLabel,
  personalSuchtext,
} from './sammelDisposition';

interface PersonalDisponierenModalProps {
  offen: boolean;
  einsatzId: number;
  /** Serienmodus wie in der Personal-Liste: eine Gruppe nach der anderen. */
  serie?: boolean;
  onSchliessen: () => void;
}

type Werte = { personal_ids: number[]; einheit_id?: number; fahrzeug_id?: number };

/**
 * Personal disponieren (LLH-1100, Spec `kraefte-disposition`, Change
 * `iw7x9980-sammel-disposition`): mehrere Stamm-Personen in einem Absenden, optional in eine
 * Einheit und auf ein Fahrzeug. Feldbudget drei (Auswahl, Einheit, Fahrzeug); ein Zielfeld nur
 * bei Freigabe seines Moduls (D4), das Fahrzeug aus der gewählten Einheit (D5). „Werte behalten“
 * hält die Einheit, nicht das Fahrzeug (D8). Aktiv disponierte und entlassene Personen fehlen in
 * der Auswahl — eine Entlassene kommt über „Erneut disponieren“ im Block „Entlassen“ zurück; die
 * Ablehnung „entlassen“ des Servers bleibt die Wache.
 */
export default function PersonalDisponierenModal({
  offen,
  einsatzId,
  serie = false,
  onSchliessen,
}: PersonalDisponierenModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<Werte>();
  const freigaben = useModulFreigaben(einsatzId);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const fahrzeugeFrei = istKeyFreigegeben('fahrzeuge', freigaben);
  /** Namen der zuletzt abgesendeten Auswahl: die Gründe nennen sie, auch wenn die Liste wechselt. */
  const [namen, setNamen] = useState<ReadonlyMap<number, string>>(new Map());

  const poolQuery = useQuery({
    queryKey: globalKeys.personalListe('im-dienst'),
    queryFn: () => listePersonal(true),
    enabled: offen,
  });
  const aktivQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: offen,
  });
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.personalEntlassene(einsatzId),
    queryFn: () => listEntlassenesPersonal(einsatzId),
    enabled: offen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: offen && einheitenFrei,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: offen && fahrzeugeFrei,
  });

  const mutation = useMutation({
    mutationFn: (eingabe: SammelPersonalEingabe) => disponierePersonalSammel(einsatzId, eingabe),
    onSuccess: (angelegt) => {
      message.success(erfolgText(angelegt.length, 'personal'));
      for (const key of [
        einsatzKeys.personal(einsatzId),
        einsatzKeys.etb(einsatzId),
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.kraefteZeitachsePersonal(einsatzId),
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });

  const vergeben = new Set(
    [...(aktivQuery.data ?? []), ...(entlasseneQuery.data ?? [])]
      .map((e) => e.personal_id)
      .filter((x): x is number => x != null),
  );
  const pool = (poolQuery.data ?? []).filter((p) => !vergeben.has(p.id));
  const optionen = demoGroupedOptions(pool, personalLabel, personalSuchtext);
  // Ein leeres Feld nennt den Ausfall, wenn die Liste nicht ankam — sonst behauptete es „Keine
  // freien Personen“. Kein `kein403`: die Stamm-Routen sind org-lesbar ohne Admin-Schranke.
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, { allgemein: 'Personalliste konnte nicht geladen werden' }) ??
    'Keine freien Personen';

  const einheitId = Form.useWatch('einheit_id', form);
  const gewaehlt = Form.useWatch('personal_ids', form);
  const fahrzeuge = fahrzeugeQuery.data ?? [];
  const einheitOptionen = aktiveEinheiten(einheitenQuery.data ?? []).map((e) => ({
    value: e.id,
    label: e.name,
  }));
  const fahrzeugOptionen = fahrzeugeDerEinheit(fahrzeuge, einheitId).map((f) => ({
    value: f.id,
    label: `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}`,
  }));

  const alleGruende = gruendeJeKraft(mutation.error, 'personal');
  const gewaehlteIds = new Set(gewaehlt ?? []);
  const gruende = new Map([...alleGruende].filter(([id]) => gewaehlteIds.has(id)));
  const name = (id: number) => namen.get(id) ?? `Person ${id}`;

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel="Personal disponieren"
      form={form}
      erfassenText="Disponieren"
      serie={serie}
      uebernahme={['einheit_id']}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht disponiert"
      speicherFehlerFallback="Disponieren fehlgeschlagen"
      onErfassen={(w) => {
        const labels = new Map(pool.map((p) => [p.id, personalLabel(p)] as const));
        setNamen(new Map(w.personal_ids.map((id) => [id, labels.get(id) ?? `Person ${id}`])));
        return mutation.mutateAsync({
          personal_ids: w.personal_ids,
          einheit_id: w.einheit_id,
          fahrzeug_id: w.fahrzeug_id,
        });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Personen"
        name="personal_ids"
        rules={[
          { required: true, message: 'Mindestens eine Person wählen' },
          {
            type: 'array',
            max: SAMMEL_MAX,
            message: `Höchstens ${SAMMEL_MAX} Personen je Absenden`,
          },
        ]}
        extra={
          <GruendeListe
            gruende={gruende}
            name={name}
            onAbwaehlen={() =>
              form.setFieldValue(
                'personal_ids',
                (gewaehlt ?? []).filter((id) => !alleGruende.has(id)),
              )
            }
          />
        }
      >
        <Select<number[]>
          mode="multiple"
          maxTagCount="responsive"
          showSearch={SUCHTEXT_SUCHE}
          options={optionen}
          notFoundContent={poolInhalt}
          tagRender={gruendeTagRender(gruende, name)}
          placeholder="Name, Personalnummer, Träger oder Qualifikation"
        />
      </Form.Item>
      {einheitenFrei && (
        <Form.Item label="In Einheit" name="einheit_id">
          <Select<number>
            allowClear
            placeholder="optional"
            options={einheitOptionen}
            notFoundContent="Keine Einheit im Einsatz"
            onChange={(id) => {
              if (!fahrzeugPasstZurEinheit(fahrzeuge, form.getFieldValue('fahrzeug_id'), id))
                form.setFieldValue('fahrzeug_id', undefined);
            }}
          />
        </Form.Item>
      )}
      {fahrzeugeFrei && (
        <Form.Item label="Auf Fahrzeug" name="fahrzeug_id">
          <Select<number>
            allowClear
            placeholder="optional"
            options={fahrzeugOptionen}
            notFoundContent={
              einheitId != null ? 'Kein Fahrzeug in dieser Einheit' : 'Kein Fahrzeug im Einsatz'
            }
          />
        </Form.Item>
      )}
    </ErfassungsModal>
  );
}
