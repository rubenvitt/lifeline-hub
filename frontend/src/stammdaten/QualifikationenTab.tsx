import { Form, Input, InputNumber, type TableColumnsType } from 'antd';
import { Select } from '../components/Select';
import { useQuery } from '@tanstack/react-query';
import { monoStil } from '../components/instrument';
import { nachZahl } from '../components/katalogVergleich';
import {
  aktualisiereQualifikation,
  deaktiviereQualifikation,
  legeQualifikationAn,
  listeQualifikationen,
} from '../api/qualifikationen';
import type { Qualifikation } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import KatalogVerwaltung from './KatalogVerwaltung';
import { einschlussKandidaten, einschluesseAus } from '../kraefte/qualiDeckung';

interface FormWerte {
  label: string;
  sortier: number;
  schliesst_ein_id: number | null;
}

/** Datenspalten; „Schließt ein“ liest das Label der eingeschlossenen Qualifikation (LLH-1553). */
const spaltenMit = (katalog: readonly Qualifikation[]): TableColumnsType<Qualifikation> => [
  {
    title: 'Label',
    dataIndex: 'label',
    key: 'label',
    /**
     * Leitspalte: an ihr sucht ein Mensch die Qualifikation. Kein `defaultSortOrder` — die
     * fachliche Reihenfolge ist `sortier` (`ORDER BY sortier, id`); sie bleibt der Einstieg, das
     * Alphabet ist ein Angebot. Antds dritter Kopfklick stellt sie wieder her.
     */
    sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
  },
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    sorter: nachZahl((q: Qualifikation) => q.sortier),
    render: (n: number) => <span style={monoStil(12)}>{n}</span>,
  },
  {
    title: 'Schließt ein',
    key: 'schliesst_ein',
    render: (_, q) =>
      katalog.find((k) => k.id === q.schliesst_ein_id)?.label ?? (q.schliesst_ein_id ? '…' : ''),
  },
];

const vorbelegung = (q: Qualifikation): FormWerte => ({
  label: q.label,
  sortier: q.sortier,
  schliesst_ein_id: q.schliesst_ein_id ?? null,
});

/** Schnellerfassung: Pflicht ist allein das Label, `sortier: 0` die Vorbelegung. */
const legeAn = (label: string) => legeQualifikationAn({ label, sortier: 0 });

const aktualisiere = (id: number, werte: FormWerte) =>
  aktualisiereQualifikation(id, {
    label: werte.label.trim(),
    sortier: werte.sortier ?? 0,
    schliesst_ein_id: werte.schliesst_ein_id ?? null,
  });

/** Die Auswahl „Schließt ein“ lässt den Eintrag selbst und jeden Kreis weg. */
const felder = (bearbeite: Qualifikation | null, katalog: readonly Qualifikation[]) => (
  <>
    <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input />
    </Form.Item>
    <Form.Item label="Sortierung" name="sortier">
      <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
    </Form.Item>
    <Form.Item label="Schließt ein" name="schliesst_ein_id">
      <Select<number | null>
        allowClear
        options={einschlussKandidaten(einschluesseAus(katalog), katalog, bearbeite?.id ?? null).map(
          (q) => ({ value: q.id, label: q.label }),
        )}
      />
    </Form.Item>
  </>
);

export default function QualifikationenTab() {
  // Derselbe Schlüssel wie die Verwaltung: kein zweiter Abruf.
  const katalog = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const spalten = spaltenMit(katalog.data ?? []);
  return (
    <KatalogVerwaltung<Qualifikation, FormWerte>
      herkunftArt="qualifikation"
      titel="Qualifikationen"
      listenSeite="stammdaten-qualifikationen"
      mehrzahl="Qualifikationen"
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
      deaktivierenKnopf="Qualifikation deaktivieren"
      felder={felder}
    />
  );
}
