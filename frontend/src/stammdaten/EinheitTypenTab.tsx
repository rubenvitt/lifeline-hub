import { StaerkeSchreibweise } from '../anzeige/KuerzelErklaerung';
import { Input, type TableColumnsType } from 'antd';
import { Feld, monoStil } from '../components/instrument';
import { nachZahl } from '../components/katalogVergleich';
import { staerkeSumme } from '../anzeige/staerke';
import { aktualisiereTyp, deaktiviereTyp, legeTypAn, listeEinheitTypen } from '../api/einheitTypen';
import type { EinheitTyp, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { globalKeys } from '../api/queryKeys';
import KatalogVerwaltung from './KatalogVerwaltung';
import QualiSollFeld, { vollstaendig, type QualiSollZeile } from '../kraefte/QualiSollFeld';
import { qualiSollEingabe, qualiSollText } from '../kraefte/qualiSoll';
import { ZahlFeld } from '../components/ZahlFeld';

interface FormWerte {
  label: string;
  soll?: Staerke | null;
  sortier: number;
  quali_soll?: QualiSollZeile[];
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
    title: (
      <>
        Soll-Stärke (<StaerkeSchreibweise />)
      </>
    ),
    key: 'soll',
    // Nach der Gesamtstärke (Σ); ohne Soll hinten (LLH-1096).
    sorter: nachZahl((t: EinheitTyp) => staerkeSumme(t.soll)),
    // Mono an der AUFRUFSTELLE, nicht im Primitiv: `StaerkeAnzeige` rendert ein schlichtes `span`
    // ohne Stil (nur die Beschreibung), damit zusammengesetzte Zeilen wie Text fließen.
    // Das Qualifikationssoll folgt in Satzschrift (LLH-1553).
    render: (_, t) => (
      <>
        <span style={monoStil('monoKlein')}>
          <StaerkeAnzeige wert={t.soll ?? null} />
        </span>
        {t.quali_soll?.length ? ` · ${qualiSollText(t.quali_soll)}` : null}
      </>
    ),
  },
  {
    title: 'Sortierung',
    dataIndex: 'sortier',
    key: 'sortier',
    render: (n: number) => <span style={monoStil('monoKlein')}>{n}</span>,
    // Numerisch vergleichen, nicht über die Zeichenkette: nur so steht 5 vor 40.
    sorter: (a, b) => a.sortier - b.sortier,
  },
];

const vorbelegung = (t: EinheitTyp): FormWerte => ({
  label: t.label,
  soll: t.soll,
  sortier: t.sortier,
  quali_soll: qualiSollEingabe(t.quali_soll),
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
    quali_soll: vollstaendig(werte.quali_soll),
  });

const felder = (bearbeite: EinheitTyp | null) => (
  <>
    <Feld label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
      <Input placeholder="z. B. Zug" />
    </Feld>
    {/* „Alle drei oder keiner“ setzt `StaerkeEingabe` selbst durch (leere Felder zählen als 0). */}
    <Feld label="Soll-Stärke" name="soll">
      <StaerkeEingabe />
    </Feld>
    <Feld label="Qualifikationssoll" name="quali_soll">
      <QualiSollFeld bekannt={bearbeite?.quali_soll} />
    </Feld>
    <Feld label="Sortierung" name="sortier" breite="kurz">
      <ZahlFeld min={0} />
    </Feld>
  </>
);

export default function EinheitTypenTab() {
  return (
    <KatalogVerwaltung<EinheitTyp, FormWerte>
      herkunftArt="einheit_typ"
      titel="Einheitstypen"
      listenSeite="stammdaten-einheit-typen"
      mehrzahl="Typen"
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
      deaktivierenKnopf="Typ deaktivieren"
      felder={felder}
    />
  );
}
