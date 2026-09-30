import { Collapse, Form, Input, InputNumber, type TableColumnsType } from 'antd';
import { monoStil } from '../components/instrument';
import { Select } from '../components/Select';
import {
  aktualisiereStatus,
  deaktiviereStatus,
  legeStatusAn,
  listeFahrzeugStatus,
} from '../api/fahrzeugStatus';
import type { FahrzeugStatus, StatusKategorie, ZeitachseMarke } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import StatusTag from '../components/StatusTag';
import { statusKategorie } from '../theme/statusFarben';
import KatalogVerwaltung from './KatalogVerwaltung';
import { markeFeld, markeHinweis, markeSpalte } from './zeitachseMarke';

interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  fms_anker?: number;
  sortier: number;
  zeitachse_marke?: ZeitachseMarke;
}

const kategorien = Object.keys(statusKategorie) as StatusKategorie[];

const spalten: TableColumnsType<FahrzeugStatus> = [
  {
    title: 'Label',
    dataIndex: 'label',
    key: 'label',
    /**
     * Leitspalte: am Label wird ein Status gesucht, nicht an der DB-Kennung.
     *
     * KEIN `defaultSortOrder`: `sortier` IST die fachliche Reihenfolge dieses Katalogs und
     * bestimmt die Anordnung in jeder Statusauswahl; das Backend liefert `ORDER BY sortier, id`.
     * Die alphabetische Sortierung ist ein Angebot zum Auffinden und wird vom dritten Kopfklick
     * zurückgenommen.
     */
    sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
  },
  {
    title: 'Kategorie',
    dataIndex: 'kategorie',
    key: 'kategorie',
    /**
     * Die geschlossene Achse dieses Katalogs. Die Filterliste kommt aus
     * {@link statusKategorie} statt aus einer eigenen Aufzählung — derselbe Griff wie
     * beim `Select` im Formular unten. Eine neue Enum-Variante taucht damit von selbst
     * im Filter auf, statt still zu fehlen.
     *
     * `String(wert)`, weil antd das Filterargument als `React.Key | boolean` typisiert.
     */
    filters: kategorien.map((k) => ({ text: statusKategorie[k].label, value: k })),
    onFilter: (wert, s) => s.kategorie === String(wert),
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
    title: 'FMS-Anker',
    dataIndex: 'fms_anker',
    key: 'fms_anker',
    // `== null`, nicht Wahrheitswert: 0 ist ein gültiger Anker.
    render: (f: number | null) => (f == null ? '—' : <span style={monoStil(12)}>{f}</span>),
  },
  markeSpalte,
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    render: (n: number) => <span style={monoStil(12)}>{n}</span>,
  },
];

const vorbelegung = (s: FahrzeugStatus): FormWerte => ({
  label: s.label,
  kategorie: s.kategorie,
  farbe: s.farbe ?? undefined,
  fms_anker: s.fms_anker ?? undefined,
  sortier: s.sortier,
  zeitachse_marke: s.zeitachse_marke ?? undefined,
});

/**
 * Schnellerfassung: Pflicht ist allein das Label. `kategorie: 'gebunden'`, `sortier: 0`
 * und die leeren Farbe/FMS-Anker sind byte-genau die Vorbelegung des früheren
 * Anlege-Dialogs.
 */
const legeAn = (label: string) =>
  legeStatusAn({ label, kategorie: 'gebunden', farbe: null, fms_anker: null, sortier: 0 });

// Die Werte kommen aus dem ganzen Formularspeicher (`KatalogVerwaltung`): die drei Felder
// hinter dem Collapse sind ohne Aufklappen nie montiert und fehlten sonst im Vollersatz.
const aktualisiere = (id: number, werte: FormWerte) =>
  aktualisiereStatus(id, {
    label: werte.label.trim(),
    kategorie: werte.kategorie,
    farbe: leerZuNull(werte.farbe),
    fms_anker: werte.fms_anker ?? null,
    sortier: werte.sortier ?? 0,
    // Vollersatz: leer entfernt die Marke (LFH-552).
    zeitachse_marke: werte.zeitachse_marke ?? null,
  });

/**
 * FELDBUDGET: zwei sichtbare Felder (die Pflichtwerte), drei eingeklappt. Bewusst OHNE
 * `forceRender`: nur wenn die eingeklappten Felder nicht im DOM stehen, ist „im
 * Ausgangszustand zwei Felder" prüfbar.
 */
const felder = (
  <>
    <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input />
    </Form.Item>
    <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
      <Select options={kategorien.map((k) => ({ value: k, label: statusKategorie[k].label }))} />
    </Form.Item>
    <Collapse
      ghost
      style={{ marginInline: -8 }}
      items={[
        {
          key: 'weitere',
          label: 'Weitere Angaben',
          children: (
            <>
              <Form.Item label="Farbe (Hex, optional)" name="farbe">
                <Input placeholder="#22aa55" />
              </Form.Item>
              <Form.Item label="FMS-Anker (0–9, optional)" name="fms_anker">
                <InputNumber min={0} max={9} style={{ width: '100%', maxWidth: 120 }} />
              </Form.Item>
              <Form.Item label="Sortierung" name="sortier">
                <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
              </Form.Item>
              {markeFeld}
            </>
          ),
        },
      ]}
    />
  </>
);

export default function StatusKatalogTab() {
  return (
    <KatalogVerwaltung<FahrzeugStatus, FormWerte>
      titel="Fahrzeug-Status"
      queryKey={globalKeys.fahrzeugStatus()}
      liste={listeFahrzeugStatus}
      legeAn={legeAn}
      aktualisiere={aktualisiere}
      deaktiviere={deaktiviereStatus}
      vorbelegung={vorbelegung}
      spalten={spalten}
      schnell={{
        beschriftung: 'Neuer Fahrzeug-Status',
        platzhalter: 'z. B. einsatzbereit',
        knopfText: 'Status anlegen',
      }}
      ladefehlerText="Statuskatalog konnte nicht geladen werden"
      leerText="Kein Status"
      bearbeitenTitel="Status bearbeiten"
      deaktivierenFrage="Status deaktivieren?"
      felder={felder}
      vorTabelle={markeHinweis}
    />
  );
}
