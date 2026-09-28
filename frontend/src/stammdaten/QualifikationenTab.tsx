import { Form, Input, InputNumber, type TableColumnsType } from 'antd';
import { monoStil } from '../components/instrument';
import {
  aktualisiereQualifikation,
  deaktiviereQualifikation,
  legeQualifikationAn,
  listeQualifikationen,
} from '../api/qualifikationen';
import type { Qualifikation } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import KatalogVerwaltung from './KatalogVerwaltung';

interface FormWerte {
  label: string;
  sortier: number;
}

const spalten: TableColumnsType<Qualifikation> = [
  {
    title: 'Label',
    dataIndex: 'label',
    key: 'label',
    /**
     * Leitspalte: an ihr sucht ein Mensch die Qualifikation. Kein `defaultSortOrder` —
     * die fachliche Reihenfolge ist `sortier` und kommt vom Server
     * (`src/personal/qualifikation_repo.rs:55` — `ORDER BY sortier, id`); sie bleibt der
     * Einstieg, das Alphabet ist ein Angebot. Antds dritter Klick auf den Kopf schaltet
     * die Sortierung wieder ab und stellt damit genau diese Reihenfolge her.
     */
    sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
  },
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    render: (n: number) => <span style={monoStil(12)}>{n}</span>,
  },
];

const vorbelegung = (q: Qualifikation): FormWerte => ({ label: q.label, sortier: q.sortier });

/** Schnellerfassung: Pflicht ist allein das Label, `sortier: 0` die Vorbelegung. */
const legeAn = (label: string) => legeQualifikationAn({ label, sortier: 0 });

const aktualisiere = (id: number, werte: FormWerte) =>
  aktualisiereQualifikation(id, { label: werte.label.trim(), sortier: werte.sortier ?? 0 });

const felder = (
  <>
    <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input />
    </Form.Item>
    <Form.Item label="Sortierung" name="sortier">
      <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
    </Form.Item>
  </>
);

export default function QualifikationenTab() {
  return (
    <KatalogVerwaltung<Qualifikation, FormWerte>
      titel="Qualifikationen"
      queryKey={globalKeys.qualifikationen()}
      liste={listeQualifikationen}
      legeAn={legeAn}
      aktualisiere={aktualisiere}
      deaktiviere={deaktiviereQualifikation}
      vorbelegung={vorbelegung}
      spalten={spalten}
      schnell={{
        beschriftung: 'Neue Qualifikation',
        platzhalter: 'z. B. Sanitäter',
        knopfText: 'Qualifikation anlegen',
      }}
      ladefehlerText="Qualifikationen konnten nicht geladen werden"
      leerText="Keine Qualifikationen"
      bearbeitenTitel="Qualifikation bearbeiten"
      deaktivierenFrage="Qualifikation deaktivieren?"
      felder={felder}
    />
  );
}
