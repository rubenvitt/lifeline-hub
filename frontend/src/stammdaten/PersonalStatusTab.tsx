import { Form, Input, InputNumber, type TableColumnsType } from 'antd';
import { monoStil } from '../components/instrument';
import { Select } from '../components/Select';
import {
  aktualisiereStatus,
  deaktiviereStatus,
  legeStatusAn,
  listePersonalStatus,
} from '../api/personalStatus';
import type { PersonalStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import StatusTag from '../components/StatusTag';
import { statusKategorie } from '../theme/statusFarben';
import KatalogVerwaltung from './KatalogVerwaltung';

interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  sortier: number;
}

const kategorien = Object.keys(statusKategorie) as StatusKategorie[];

const spalten: TableColumnsType<PersonalStatus> = [
  {
    title: 'Label',
    dataIndex: 'label',
    key: 'label',
    /**
     * Leitspalte: an ihr sucht ein Mensch den Status. Kein `defaultSortOrder` — die fachliche
     * Reihenfolge ist `sortier` und kommt vom Server (`ORDER BY sortier, id`); sie bleibt der
     * Einstieg, das Alphabet ist ein Angebot.
     */
    sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
  },
  {
    title: 'Kategorie',
    dataIndex: 'kategorie',
    key: 'kategorie',
    /**
     * Die Filterwerte kommen aus derselben Quelle wie die Anzeige (`theme/statusFarben`). Der
     * gefilterte Wert ist der DRAHTWERT (`nicht_verfuegbar`), der angezeigte sein Label — deshalb
     * ist die Kategorie ein Filter und steht nicht im Suchplatzhalter: die Freitextsuche liest
     * Rohwerte, „nicht verfügbar" fände dort nichts.
     */
    filters: kategorien.map((k) => ({ text: statusKategorie[k].label, value: k })),
    onFilter: (wert, s) => s.kategorie === wert,
    render: (k: StatusKategorie) => <StatusTag darstellung={statusKategorie[k]} />,
  },
  {
    title: 'Farbe',
    dataIndex: 'farbe',
    key: 'farbe',
    // Der gepflegte Code als Wert (Mono), keine Farbfläche: `status_farbe` ist ungeprüfter
    // Freitext, sein Kontrast ist nicht zugesichert (siehe `StatusTag`, Mandantenfarbe).
    render: (f: string | null) => (f ? <span style={monoStil(12)}>{f}</span> : '—'),
  },
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    render: (n: number) => <span style={monoStil(12)}>{n}</span>,
  },
];

const vorbelegung = (s: PersonalStatus): FormWerte => ({
  label: s.label,
  kategorie: s.kategorie,
  farbe: s.farbe ?? undefined,
  sortier: s.sortier,
});

/**
 * Schnellerfassung: Pflicht ist allein das Label. `kategorie: 'gebunden'`, `farbe: null`
 * und `sortier: 0` sind byte-genau die Vorbelegung des früheren Anlege-Dialogs.
 */
const legeAn = (label: string) =>
  legeStatusAn({ label, kategorie: 'gebunden', farbe: null, sortier: 0 });

const aktualisiere = (id: number, werte: FormWerte) =>
  aktualisiereStatus(id, {
    label: werte.label.trim(),
    kategorie: werte.kategorie,
    farbe: leerZuNull(werte.farbe),
    sortier: werte.sortier ?? 0,
  });

const felder = (
  <>
    <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input />
    </Form.Item>
    <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
      <Select options={kategorien.map((k) => ({ value: k, label: statusKategorie[k].label }))} />
    </Form.Item>
    <Form.Item label="Farbe (Hex, optional)" name="farbe">
      <Input placeholder="#22aa55" />
    </Form.Item>
    <Form.Item label="Sortierung" name="sortier">
      <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
    </Form.Item>
  </>
);

export default function PersonalStatusTab() {
  return (
    <KatalogVerwaltung<PersonalStatus, FormWerte>
      titel="Personal-Status"
      queryKey={globalKeys.personalStatus()}
      liste={listePersonalStatus}
      legeAn={legeAn}
      aktualisiere={aktualisiere}
      deaktiviere={deaktiviereStatus}
      vorbelegung={vorbelegung}
      spalten={spalten}
      schnell={{
        beschriftung: 'Neuer Personal-Status',
        platzhalter: 'z. B. dienstbereit',
        knopfText: 'Status anlegen',
      }}
      ladefehlerText="Personal-Status konnte nicht geladen werden"
      leerText="Kein Status"
      bearbeitenTitel="Status bearbeiten"
      deaktivierenFrage="Status deaktivieren?"
      felder={felder}
    />
  );
}
