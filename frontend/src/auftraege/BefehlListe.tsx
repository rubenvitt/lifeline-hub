import { IconPlus } from '../icons';
import { Button, Form, Input, Modal } from 'antd';
import { Select } from '../components/Select';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { legeBefehlAn, listeBefehle, type NeuerBefehl } from '../api/befehle';
import { einsatzKeys } from '../api/queryKeys';
import type { BefehlAnzeige, BefehlVorlageKey } from '../api/types';
import { VORLAGEN } from '../befehle/vorlagen';
import { befehlDetailPfad } from '../routing/deeplinks';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import Bereichskopf from '../kommunikation/Bereichskopf';
import { BEFEHL_STATUS, StatusBadge } from '../kommunikation';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useFehlerMeldung } from '../components/useFehlerMeldung';

/**
 * Befehlsliste des Aufträge/Befehle-Tabs.
 *
 * `form="karte"` in JEDER Breite: ein Befehl wird als Einheit gelesen (Schema, Fassung,
 * Freigabestand), nicht verglichen; die Nachbarflächen des Tabs sind ebenfalls Karten. Das
 * Spaltenregister bleibt die einzige Wahrheit für Etikett, Sortierung, Suche und Filter.
 *
 * DIE V-NUMMER IST KEIN ZIERRAT: die Fortschreibung legt eine neue Zeile mit gleichem Titel
 * an, der Vorgänger bleibt freigegeben liegen. Die v-Nummer unterscheidet sie und erscheint
 * immer, nicht erst ab `version > 1`. Die Gruppierung Entwürfe/Freigegeben zerschneidet die
 * Kette bewusst: nur der Entwurf ist bearbeitbar.
 *
 * Das Schema (`vorlage`) ist über die Fortschreibung unveränderlich und als geschlossene Menge
 * ein Filter, kein Freitext.
 */

function schemaLabel(schluessel: BefehlVorlageKey | string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? String(schluessel);
}

/**
 * Modulkonstante IN dieser Datei (der Guard verlangt `spaltenFuer` je Konsumentendatei). Nie
 * annotieren — eine Typangabe weitete `K` auf `string`, und der Kartenplan nähme Tippfehler an.
 */
const befehlSpalten = spaltenFuer<BefehlAnzeige>()([
  {
    key: 'titel',
    title: 'Titel',
    immerSichtbar: true,
    sortWert: (b) => b.titel,
    suchText: (b) => b.titel,
    // KEIN Anker hier: den Link setzt `karte.titel.ziel`, sonst verschachtelte Links.
    render: (_t, b) => b.titel,
  },
  {
    key: 'status',
    title: 'Status',
    // Sekundärslot statt `karte.status`: der Befehl bleibt auf der Kommunikations-Phasenachse
    // (außerhalb des Statusfarb-Vertrags) und sieht damit aus wie der Auftrag im Nachbar-Tab.
    render: (_t, b) => (
      <StatusBadge phase={BEFEHL_STATUS[b.status].phase} label={BEFEHL_STATUS[b.status].label} />
    ),
  },
  {
    key: 'schema',
    title: 'Schema',
    suchText: (b) => schemaLabel(b.vorlage),
    filter: {
      werte: VORLAGEN.map((v) => ({ text: v.label, value: v.schluessel })),
      trifft: (b, w) => b.vorlage === w,
    },
    render: (_t, b) => schemaLabel(b.vorlage),
  },
  {
    key: 'fassung',
    title: 'Fassung',
    sortWert: (b) => b.zeitstand,
    // v-Nummer, Zeitstand und Ersteller in EINER Zeile — drei Slots sind das Maximum. `zeitstand`
    // läuft durch `ZeitAnzeige`; `sortWert` bleibt der rohe UTC-Wirestring, der lexikografisch
    // korrekt sortiert (die DTG nicht).
    render: (_t, b) => (
      <>
        {`v${b.version} · `}
        <ZeitAnzeige wert={b.zeitstand} />
        {` · ${b.ersteller_name}`}
      </>
    ),
  },
]);

export default function BefehlListe({
  einsatzId,
  darfSchreiben,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
}) {
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerBefehl>();

  const befehleQuery = useQuery({
    queryKey: einsatzKeys.befehle(einsatzId),
    queryFn: () => listeBefehle(einsatzId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  const fehler = useFehlerMeldung();

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerBefehl) => legeBefehlAn(einsatzId, daten),
    onSuccess: () => {
      invalidate();
      setAnlegenOffen(false);
      form.resetFields();
    },
    onError: fehler,
  });

  const befehle = befehleQuery.data ?? [];
  const entwuerfe = befehle.filter((b) => b.status === 'entwurf').length;

  return (
    <div>
      {/* Die Mengen zählen den BESTAND, die Gruppenköpfe das ANGEZEIGTE — bei aktiver Suche laufen sie
         bewusst auseinander. */}
      <Bereichskopf
        titel="Befehle"
        // Ausdrücklich statt Vorgabe: die Gruppenköpfe der Datensicht rechnen mit dieser Ebene.
        ueberschrift="h3"
        meta={`${befehle.length} Befehle · ${entwuerfe} im Entwurf`}
        dataUpdatedAt={befehleQuery.dataUpdatedAt}
        aktion={
          darfSchreiben && (
            // `aria-label` ist PFLICHT: antds Icon schiebt `aria-label="plus"` in den berechneten Namen,
            // sonst hieße der Knopf „plus Befehl erteilen".
            <Button
              type="primary"
              icon={<IconPlus />}
              aria-label="Befehl erteilen"
              onClick={() => setAnlegenOffen(true)}
            >
              Befehl erteilen
            </Button>
          )
        }
      />

      <Datensicht
        bezeichnung="Befehle"
        form="karte"
        spalten={befehlSpalten}
        daten={befehle}
        zeilenSchluessel="id"
        ladend={befehleQuery.isLoading}
        leerText="Noch keine Befehle"
        suche={{ platzhalter: 'Titel oder Schema' }}
        standardSortierung={{ spalte: 'fassung', richtung: 'ab' }}
        gruppen={{
          schluessel: (b) => b.status,
          etikett: (w) => (w === 'entwurf' ? 'Entwürfe' : 'Freigegeben'),
          reihenfolge: ['entwurf', 'freigegeben'],
          // Die Gruppenköpfe stehen unter dem `Bereichskopf` (`ueberschrift="h3"` oben).
          unterEbene: 3,
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'titel', ziel: (b) => befehlDetailPfad(einsatzId, b.id) },
          // Keine `aktion`: Freigeben/Fortschreiben/Drucken liegen auf der Detailseite.
          sekundaer: ['status', 'schema', 'fassung'],
        }}
      />

      <Modal
        open={anlegenOffen}
        title="Neuen Befehl anlegen"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerBefehl>
          form={form}
          layout="vertical"
          initialValues={{ vorlage: 'befehl_lad' }}
          onFinish={(w) => anlegenMutation.mutate(w)}
        >
          <Form.Item label="Schema" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item
            label="Titel"
            name="titel"
            rules={[{ required: true, message: 'Titel erforderlich' }]}
          >
            <Input placeholder="z. B. Befehl an 2. Zug 10:30" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
