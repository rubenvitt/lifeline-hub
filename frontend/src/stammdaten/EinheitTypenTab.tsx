import { Form, Input, InputNumber, type TableColumnsType } from 'antd';
import { monoStil } from '../components/instrument';
import { aktualisiereTyp, deaktiviereTyp, legeTypAn, listeEinheitTypen } from '../api/einheitTypen';
import type { EinheitTyp, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { globalKeys } from '../api/queryKeys';
import KatalogVerwaltung from './KatalogVerwaltung';

interface FormWerte {
  label: string;
  soll?: Staerke | null;
  sortier: number;
}

// Keine Filterspalte in diesem Katalog: `EinheitTyp` trägt weder Status noch Kategorie, und
// `einheit/typ_repo.rs` liefert ohnehin nur `WHERE aktiv = 1`.
const spalten: TableColumnsType<EinheitTyp> = [
  {
    title: 'Label',
    dataIndex: 'label',
    key: 'label',
    // Leitspalte: am Label sucht ein Mensch den Typ. Die Sortierung ist ein ANGEBOT ohne
    // `defaultSortOrder` — voreingestellt bleibt die fachliche Reihenfolge des Backends
    // (`ORDER BY sortier, id`), die die Zug-vor-Gruppe-Ordnung hält.
    sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
  },
  {
    title: 'Soll-Stärke (F/UF/M//Σ)',
    key: 'soll',
    // Mono an der AUFRUFSTELLE, nicht im Primitiv: `StaerkeAnzeige` rendert bewusst ein
    // Fragment, damit zusammengesetzte Textzeilen nicht in mehrere Textknoten zerfallen.
    render: (_, t) => (
      <span style={monoStil(12)}>
        <StaerkeAnzeige wert={t.soll ?? null} />
      </span>
    ),
  },
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    render: (n: number) => <span style={monoStil(12)}>{n}</span>,
    // Numerisch vergleichen, nicht über die Zeichenkette: nur so steht 5 vor 40.
    sorter: (a, b) => a.sortier - b.sortier,
  },
];

const vorbelegung = (t: EinheitTyp): FormWerte => ({
  label: t.label,
  soll: t.soll,
  sortier: t.sortier,
});

/** Schnellerfassung: Pflicht ist allein das Label; die Soll-Stärke bleibt leer. */
const legeAn = (label: string) =>
  legeTypAn({
    label,
    soll_fuehrer: null,
    soll_unterfuehrer: null,
    soll_mannschaft: null,
    sortier: 0,
  });

const aktualisiere = (id: number, werte: FormWerte) =>
  aktualisiereTyp(id, {
    label: werte.label.trim(),
    soll_fuehrer: werte.soll?.fuehrer ?? null,
    soll_unterfuehrer: werte.soll?.unterfuehrer ?? null,
    soll_mannschaft: werte.soll?.mannschaft ?? null,
    sortier: werte.sortier ?? 0,
  });

const felder = (
  <>
    <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input placeholder="z. B. Zug" />
    </Form.Item>
    <Form.Item label="Soll-Stärke (vollständig oder leer lassen)" name="soll">
      <StaerkeEingabe />
    </Form.Item>
    <Form.Item label="Sortierung" name="sortier">
      <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
    </Form.Item>
  </>
);

export default function EinheitTypenTab() {
  return (
    <KatalogVerwaltung<EinheitTyp, FormWerte>
      titel="Einheitstypen"
      queryKey={globalKeys.einheitTypen()}
      liste={listeEinheitTypen}
      legeAn={legeAn}
      aktualisiere={aktualisiere}
      deaktiviere={deaktiviereTyp}
      vorbelegung={vorbelegung}
      spalten={spalten}
      // Der Platzhalter nennt NICHT „Label" — diesen Wortlaut trägt bereits das Suchfeld der
      // Tabelle, ein zweiter Knoten mit demselben Platzhalter machte den Griff mehrdeutig.
      schnell={{
        beschriftung: 'Neuer Einheitstyp',
        platzhalter: 'z. B. Zug',
        knopfText: 'Typ anlegen',
      }}
      ladefehlerText="Einheitstypen konnten nicht geladen werden"
      leerText="Kein Einheitstyp"
      bearbeitenTitel="Typ bearbeiten"
      deaktivierenFrage="Typ deaktivieren?"
      felder={felder}
    />
  );
}
