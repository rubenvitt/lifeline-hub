import { Collapse, Input, type TableColumnsType } from 'antd';
import { Feld, monoStil } from '../components/instrument';
import { nachZahl } from '../components/katalogVergleich';
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
import { statusKategorie } from '../theme/statusFarben';
import KatalogVerwaltung from './KatalogVerwaltung';
import { markeFeld, markeHinweis, markeSpalte } from './zeitachseMarke';
import { Status } from '../components/instrument/Status';
import { ZahlFeld } from '../components/ZahlFeld';

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
    // In der Folge der Kategorien, nicht nach dem Wort (LLH-1096).
    sorter: nachZahl((s: FahrzeugStatus) => kategorien.indexOf(s.kategorie)),
    render: (k: StatusKategorie) => <Status darstellung={statusKategorie[k]} />,
  },
  {
    title: 'Farbe',
    dataIndex: 'farbe',
    key: 'farbe',
    // Der gepflegte Code als Wert (Mono), keine Farbfläche: `status_farbe` ist ungeprüfter
    // Freitext, sein Kontrast ist nicht zugesichert (siehe `Status`, Mandantenfarbe).
    render: (f: string | null) => (f ? <span style={monoStil('monoKlein')}>{f}</span> : '—'),
  },
  {
    title: 'FMS-Anker',
    dataIndex: 'fms_anker',
    key: 'fms_anker',
    sorter: nachZahl((s: FahrzeugStatus) => s.fms_anker),
    // `== null`, nicht Wahrheitswert: 0 ist ein gültiger Anker.
    render: (f: number | null) =>
      f == null ? '—' : <span style={monoStil('monoKlein')}>{f}</span>,
  },
  markeSpalte,
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    sorter: nachZahl((s: FahrzeugStatus) => s.sortier),
    render: (n: number) => <span style={monoStil('monoKlein')}>{n}</span>,
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
    <Feld label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input />
    </Feld>
    <Feld label="Kategorie" name="kategorie" rules={[{ required: true }]}>
      <Select options={kategorien.map((k) => ({ value: k, label: statusKategorie[k].label }))} />
    </Feld>
    <Collapse
      ghost
      style={{ marginInline: 'calc(-1 * var(--lfh-luft-2))' }}
      items={[
        {
          key: 'weitere',
          label: 'Weitere Angaben',
          children: (
            <>
              <Feld label="Farbe (Hex, optional)" name="farbe">
                <Input placeholder="#22aa55" />
              </Feld>
              <Feld label="FMS-Anker (0–9, optional)" name="fms_anker" breite="kurz">
                <ZahlFeld min={0} max={9} />
              </Feld>
              <Feld label="Sortierung" name="sortier" breite="kurz">
                <ZahlFeld min={0} />
              </Feld>
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
      herkunftArt="fahrzeug_status"
      listenSeite="stammdaten-status"
      mehrzahl="Status"
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
      deaktivierenKnopf="Status deaktivieren"
      felder={felder}
      vorTabelle={markeHinweis}
    />
  );
}
