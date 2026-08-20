import { useState } from 'react';
import { Button, Space, Form, App } from 'antd';
import { Select } from '../../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeEinsatzMaterial, aktualisiereDisposition } from '../../api/einsatzMaterial';
import type { EinsatzMaterial, MaterialStatus, UhsDetail } from '../../api/types';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import KatalogTabelle from '../../components/KatalogTabelle';
import { ErfassungsModal } from '../../components/Erfassung';
import Datenstand from '../../components/Datenstand';
import StatusTag from '../../components/StatusTag';
import { materialStatus } from '../../theme/statusFarben';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}

/** Die eine Angabe der Erfassungsmaske. Eigener Typ, damit die Hülle generisch bleibt. */
interface ZuordnenWerte {
  em_id: number;
}

export default function MaterialTab({ einsatzId, uhs, schreibgeschuetzt }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [zuordnenOffen, setZuordnenOffen] = useState(false);
  const [form] = Form.useForm<ZuordnenWerte>();

  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });

  const material = materialQuery.data ?? [];
  const verortet = material.filter((em) => em.uhs_id === uhs.id);
  const freiVerortbar = material.filter((em) => em.uhs_id == null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
  }

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const loesenMut = useMutation({
    mutationFn: (emId: number) =>
      aktualisiereDisposition(einsatzId, emId, { uhs_id: null }),
    onSuccess: () => { message.success('Material gelöst'); invalidate(); },
    onError: fehler,
  });

  const zuordnenMut = useMutation({
    mutationFn: (emId: number) =>
      aktualisiereDisposition(einsatzId, emId, { uhs_id: uhs.id }),
    onSuccess: () => { message.success('Material zugeordnet'); invalidate(); },
    onError: fehler,
  });

  const columns = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bezeichnung' },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie',
      render: (v: string | null) => v ?? '—' },
    { title: 'Menge', dataIndex: 'menge', key: 'menge' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      // Der Wire-Wert ist kein Bildschirmtext (LFH-341 · M54). Farbe und Beschriftung
      // kommen aus `theme/statusFarben.ts` — dieselbe Quelle, aus der `MaterialPage`
      // liest, damit dasselbe Enum nicht zwei Farbbehandlungen bekommt.
      render: (status: MaterialStatus) => (
        <span data-testid="material-status-zelle">
          <StatusTag darstellung={materialStatus[status]} />
        </span>
      ),
    },
    {
      title: 'Aktion', key: 'aktion',
      render: (_: unknown, em: EinsatzMaterial) =>
        // KEINE Rückfrage — entschieden in LFH-378/B5l nach der Trennlinie aus LFH-363:
        // umkehrbar bekommt `danger` und Abstand, aber KEINE zusätzliche Reibung; die
        // Rückfrage ist dem Unumkehrbaren vorbehalten. Diese Aktion setzt `uhs_id: null`
        // und ist über „Material zuordnen" direkt darüber wiederherstellbar — es geht
        // kein Datensatz und kein Feld verloren, das Material wandert zurück in die
        // Auswahlliste. CLAUDE.md nennt „eine gelöste Zuordnung" wörtlich als Beispiel.
        // LFH-367/B5g hatte das Popconfirm nur gehärtet (`okButtonProps={{ danger }}`),
        // weil das Entfernen einer bestehenden Rückfrage eine Bedienentscheidung ist und
        // nicht in sein Akzeptanzkriterium gehörte; hier ist sie getroffen.
        !schreibgeschuetzt ? (
          // Ohne Größen-Prop: die Fläche erbt die Dichtestufe. Anders als die vier
          // Knöpfe der Platzkarte hängt diese Zelle an keiner Backend-Konstante —
          // die Tabelle wächst mit.
          //
          // `loading` je ZEILE, nicht je Mutation: `loesenMut` bedient alle Zeilen, ein
          // pauschales `isPending` legte die ganze Spalte lahm. Es ersetzt den Riegel, den
          // die entfernte Rückfrage nebenbei mitbrachte — ohne ihn setzt jeder weitere
          // Klick einen weiteren PATCH ab, samt Invalidierung, Live-Ereignis und einer
          // zweiten Erfolgsmeldung für eine Aktion, die einmal stattgefunden hat.
          <Button
            danger
            loading={loesenMut.isPending && loesenMut.variables === em.id}
            onClick={() => loesenMut.mutate(em.id)}
          >
            Lösen
          </Button>
        ) : null,
    },
  ];

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Datenstand dataUpdatedAt={materialQuery.dataUpdatedAt} />
      {!schreibgeschuetzt && (
        <Button
          onClick={() => setZuordnenOffen(true)}
          disabled={freiVerortbar.length === 0}
        >
          Material zuordnen
        </Button>
      )}
      <KatalogTabelle<EinsatzMaterial>
        rowKey="id"
        dataSource={verortet}
        columns={columns}
        size="small"
        pagination={false}
        locale={{ emptyText: 'Kein Material dieser UHS zugeordnet' }}
        loading={materialQuery.isLoading}
      />
      {/* Erfassungs-Norm LFH-332/B4 statt handgebautem `<Modal onOk>`: der Absende-Knopf
          liegt im `<form>` statt in der Modal-Fusszeile, der Fokus steht beim Öffnen im
          Auswahlfeld, und zurückgesetzt wird auf jedem Weg hinaus.

          ENTER SENDET HIER TROTZDEM NICHT AB, und das ist keine Lücke des Umbaus:
          `@rc-component/select` ruft in `BaseSelect/index.js:246` bei jedem Enter
          `event.preventDefault()`, solange der Modus nicht `combobox` ist („Do not submit
          form when type in the input"), und öffnet stattdessen die Liste. Ein `Select` ist
          damit von der Enter-Zusicherung ausgenommen wie eine `Input.TextArea` — die greift
          für `Input`/`InputNumber`/`DatePicker`. Gemessen 31.07.2026, LFH-378/B5l; belegt
          wird deshalb die Struktur, nicht die Taste (s. `MaterialTab.test.tsx`).

          Kein `serie`: Material wird je UHS in Einzelstücken zugeordnet, nicht im
          Minutentakt erfasst. Ein Feld — weit im Budget von ≤ ~3. */}
      <ErfassungsModal<ZuordnenWerte>
        offen={zuordnenOffen}
        titel="Material zuordnen"
        form={form}
        erfassenText="Zuordnen"
        laeuft={zuordnenMut.isPending}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der
        // Datensatz angekommen ist. Ein abgelehnter PATCH lässt die Auswahl stehen.
        onErfassen={(werte) => zuordnenMut.mutateAsync(werte.em_id)}
        onFertig={() => setZuordnenOffen(false)}
        onAbbrechen={() => setZuordnenOffen(false)}
      >
        <Form.Item<ZuordnenWerte>
          name="em_id"
          label="Material"
          // Pflicht statt eines deaktivierten Absende-Knopfes: ein Knopf, der nicht sagt,
          // warum er nicht geht, war die zweite Hälfte des alten `okButtonProps.disabled`.
          rules={[{ required: true, message: 'Bitte Material auswählen' }]}
        >
          <Select
            style={{ width: '100%' }}
            placeholder="Material auswählen…"
            options={freiVerortbar.map((em) => ({
              value: em.id,
              label: `${em.bezeichnung}${em.kategorie ? ` (${em.kategorie})` : ''} — ${em.menge}×`,
            }))}
          />
        </Form.Item>
      </ErfassungsModal>
    </Space>
  );
}
