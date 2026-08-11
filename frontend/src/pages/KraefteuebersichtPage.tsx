import { App as AntApp, Breadcrumb, Button, Card, Col, Input, Row, Space, Statistic, Tag, theme } from 'antd';
import { taktischeDtgVoll } from '../anzeige/format';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams } from 'react-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  staerkeText,
  verdichte,
  type FilterWerte,
  type MeldebildZeile,
  type Rohdaten,
} from '../kraefte/kraeftebild';
import AmpelZelle from '../kraefte/AmpelZelle';
import { KATEGORIE_WERTE } from '../kraefte/statusAchse';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { MaterialStatus, StatusKategorie } from '../api/types';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { rollenFarbe, statusKategorie, type Statusrolle } from '../theme/statusFarben';
import { abstand, flaeche } from '../theme/tokens';
import './kraefteuebersichtPrint.css';

/**
 * Materialstatus als Kopfzeilen-Kennzahl.
 *
 * Die Map bleibt LOKAL, und das ist eine Entscheidung, keine Auslassung: `MaterialStatus`
 * ist kein Vertrags-Enum (Spec §1.3 listet die acht, §5 zieht die Grenze), und die Labels
 * hier tragen das seitenspezifische Präfix „Mtl." — beides gehört nicht in
 * `theme/statusFarben.ts`. Was aus dem Vertrag kommt, ist die WÄHRUNG: eine `Statusrolle`
 * statt der drei rohen Hex, die hier standen. Die waren antd-v5-Defaults und damit für
 * Gate 5 unsichtbar — es kennt nur die A0-Palette; hier hilft nur ein Blick in die Datei.
 *
 * `verbraucht` hat weiterhin KEINE Rolle. Das ist der Bestand und bleibt es: verbrauchtes
 * Material meldet nichts, und ihm `neutral` zu geben würde die Zahl auf
 * `colorTextTertiary` dämpfen — eine visuelle Änderung im Gewand einer Aufräumarbeit.
 * Fehlende Rolle heißt hier „kein Signal", nicht „noch nicht zugeordnet".
 */
const MAT_STATUS_ANZEIGE: Array<{ key: MaterialStatus; label: string; rolle?: Statusrolle }> = [
  { key: 'einsatzbereit', label: 'Mtl. einsatzbereit', rolle: 'normal' },
  { key: 'im_einsatz', label: 'Mtl. im Einsatz', rolle: 'achtung' },
  { key: 'defekt', label: 'Mtl. defekt', rolle: 'alarm' },
  { key: 'verbraucht', label: 'Mtl. verbraucht' },
  { key: 'desinfektion_noetig', label: 'Mtl. Desinfektion', rolle: 'achtung' },
];

// Der frühere `achsenTrenner` ist mit LFH-338 entfallen: er war ein Flex-Kind fester Höhe
// zwischen drei nicht umbrechenden Achsen. Im Raster trennen die Spalten selbst — eine
// 48-px-Linie zwischen zwei UNTEREINANDER liegenden Achsen wäre ein Strich ins Nichts.

/**
 * Das Spaltenregister des Meldebilds (LFH-330 · B2, Teil 2 + 3).
 *
 * Bleibt Modul-Konstante: keine Spalte braucht `token` oder einen Hook — `AmpelZelle`
 * holt ihre Farbe über CSS-Klassen. Ein `useMemo` im Rumpf wäre nur eine weitere
 * Abhängigkeitsliste unter `--max-warnings 0`, ohne Gegenwert.
 *
 * Durch `spaltenFuer<MeldebildZeile>()` geführt, NICHT annotiert: eine Annotation weitet
 * die Schlüsselliterale auf `string`, und der Kartenplan nähme danach jeden Tippfehler an.
 *
 * ── DIE AMPELZEILE HAT ZWEI EIGENE SPALTEN ──────────────────────────────────────
 *
 * Vorher trug die Statusspalte drei Rollen gleichzeitig: den Einzelstatus der Mittel, die
 * Personalverteilung und die Fahrzeugverteilung — bis zu acht `Tag` in einem `Space` ohne
 * `wrap` bei `width: 220`, unterschieden allein durch zwei Zierzeichen. Und Werte gleich 0
 * fielen weg, wodurch zwei übereinanderliegende Zeilen einer VERGLEICHSTABELLE nicht mehr
 * fluchteten (Prüflisten-Kriterium 14).
 *
 * Die Zierde ist keine Prop: `AmpelZelle` leitet ihr Piktogramm aus `bezeichnung` ab. Hier
 * standen bis dahin zwei Emoji als Zeichenketten — Begründung im Kopf von `AmpelZelle`.
 *
 * Jetzt: „Personal" und „Fahrzeuge" als Spalten mit Textkopf, je eine kompakte Zählzeile
 * mit vier Feldern in fester Folge. Der Volltext hängt als `title` daran, der Kurztext ist
 * sichtbar — Farbe allein trägt keine Bedeutung (Kriterium 6).
 *
 * „Status" bleibt und wandert nach HINTEN: sie betrifft nur noch Blätter (`mittel`).
 */
const meldebildSpalten = spaltenFuer<MeldebildZeile>()([
  {
    title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bez', immerSichtbar: true,
    render: (_t, z) => <span style={{ fontWeight: z.art === 'abschnitt' ? 600 : 400 }}>{z.bezeichnung}</span>,
  },
  // `abBreite` statt antds Breiten-Prop: nur so fließt das Verbergen in DENSELBEN Zähler
  // wie die Handauswahl des Spaltenschalters — ein Zähler, der lügen kann, verfehlt sein Ziel.
  { title: 'Typ / Rolle', dataIndex: 'detail', key: 'detail', abBreite: 'md' },
  {
    title: 'Stärke', key: 'staerke', width: 130,
    render: (_t, z) => (z.art === 'mittel' && z.mittelArt !== 'person') ? null : staerkeText(z.staerke),
  },
  {
    title: 'Personal', key: 'personal', width: 190,
    render: (_t, z) => <AmpelZelle bezeichnung="Personal" verteilung={z.personalVerteilung} />,
  },
  {
    title: 'Fahrzeuge', key: 'fahrzeuge', width: 190,
    render: (_t, z) => <AmpelZelle bezeichnung="Fahrzeuge" verteilung={z.fahrzeugVerteilung} />,
  },
  {
    title: 'Status', key: 'status', width: 220,
    render: (_t, z) => {
      // Nur noch Blätter: die Aggregate der Abschnitts- und Einheitszeilen stehen in den
      // zwei Spalten links davon.
      if (z.art !== 'mittel') return null;
      if (z.mittelArt === 'material') {
        const text = [z.statusLabel, z.menge != null ? `×${z.menge}` : null].filter(Boolean).join(' · ');
        return text ? <Tag>{text}</Tag> : null;
      }
      // Ohne Kategorie gibt es keine Rolle — dann bleibt es beim farblosen Tag.
      if (!z.statusKategorie) return <Tag>{z.statusLabel ?? '—'}</Tag>;
      // Der mandantengepflegte `statusLabel` schlägt das Vertragslabel; vorher stand
      // hier ersatzweise der ROHE Enum-String (`nicht_verfuegbar`).
      const meta = statusKategorie[z.statusKategorie];
      return <StatusTag darstellung={{ ...meta, label: z.statusLabel ?? meta.label }} />;
    },
  },
]);

function alleKeys(zeilen: MeldebildZeile[]): string[] {
  return zeilen.flatMap((z) => [z.key, ...(z.children ? alleKeys(z.children) : [])]);
}

/**
 * Der leere Filterzustand — EINE Quelle für Startwert, Zurücksetzen und das Zurücknehmen
 * einer einzelnen Marke. Vorher stand das Objektliteral nur im `useState`, und ein
 * Zurücksetzen hätte es ein zweites Mal hinschreiben müssen.
 */
export const LEERER_FILTER: FilterWerte = { abschnittId: null, traeger: null, kategorie: null, suche: '' };

export interface FilterChip {
  schluessel: keyof FilterWerte;
  label: string;
}

/**
 * Die gesetzten Filter als Beschriftungen (LFH-338 · C3, Befund H3).
 *
 * REIN und exportiert, nach dem Muster von `bedienzielStil`: nur so ist die Reihenfolge über
 * mehrere Kombinationen prüfbar, ohne zu rendern.
 *
 * Die Reihenfolge ist FEST (Abschnitt · Träger · Status · Suche) und nicht die Setzreihenfolge:
 * eine Marken-Leiste, deren Einträge je nach Bedienweg springen, ist beim Ablesen unter
 * Zeitdruck schlechter als keine.
 *
 * `suche` wird GETRIMMT geprüft — genauso wie `filtereKraefte` es tut (`f.suche.trim()`).
 * Eine Marke für eine Suche aus lauter Leerzeichen behauptete eine Einschränkung, die keine
 * einzige Zeile entfernt.
 */
export function aktiveFilterChips(
  filter: FilterWerte,
  abschnittName: (id: number) => string,
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.abschnittId != null) {
    chips.push({ schluessel: 'abschnittId', label: `Abschnitt: ${abschnittName(filter.abschnittId)}` });
  }
  if (filter.traeger) chips.push({ schluessel: 'traeger', label: `Träger: ${filter.traeger}` });
  if (filter.kategorie) {
    // Das Etikett kommt aus derselben Statusachse wie die Optionen des Auswahlfeldes — sonst
    // hieße derselbe Wert im Feld anders als in der Marke daneben.
    const wert = KATEGORIE_WERTE.find((w) => w.value === filter.kategorie);
    chips.push({ schluessel: 'kategorie', label: `Status: ${wert?.text ?? filter.kategorie}` });
  }
  if (filter.suche.trim()) chips.push({ schluessel: 'suche', label: `Suche: „${filter.suche.trim()}"` });
  return chips;
}

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();

  const [filter, setFilter] = useState<FilterWerte>(LEERER_FILTER);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [printPending, setPrintPending] = useState(false);

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys IDENTISCH zu den vom Live-Hook invalidierten Keys (Task 5 erweitert den Hook).
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: einsatzKeys.personal(einsatzId), queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: einsatzKeys.fahrzeuge(einsatzId), queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: einsatzKeys.material(einsatzId), queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });

  const traeger = useMemo(() => [...new Set([
    ...(personalQuery.data ?? []).map((x) => x.traegerorganisation),
    ...(fahrzeugeQuery.data ?? []).map((x) => x.traegerorganisation),
  ].filter((t): t is string => !!t))].sort(), [personalQuery.data, fahrzeugeQuery.data]);

  const bild = useMemo(() => {
    const roh: Rohdaten = {
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
    };
    const gefiltert = filtereKraefte(roh, filter);
    return baueKraeftebild(
      gefiltert.abschnitte, gefiltert.einheiten, gefiltert.personal,
      gefiltert.fahrzeuge, gefiltert.material,
    );
  }, [abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data, filter]);

  /**
   * DER BEZUGSWERT — dieselbe Rechnung über die UNGEFILTERTEN Listen.
   *
   * Ohne ihn verschwindet die Gesamtstärke des Einsatzes in dem Moment, in dem jemand einen
   * Abschnitt anwählt. Genau dann wird sie an die übergeordnete Führungsstelle gemeldet
   * (Befund H3): der Kopf rechnete schon immer gefiltert, war aber unverändert mit
   * „Gesamtstärke" beschriftet.
   *
   * Kein zweiter `baueKraeftebild`-Lauf: der Bezugswert braucht keinen Baum, und ein voller
   * Aufbau je Tastendruck im Suchfeld wäre Arbeit für ein Ergebnis, das niemand ansieht.
   */
  const gesamt = useMemo(
    () => verdichte(personalQuery.data ?? [], fahrzeugeQuery.data ?? [], materialQuery.data ?? []),
    [personalQuery.data, fahrzeugeQuery.data, materialQuery.data],
  );

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const stand = taktischeDtgVoll(new Date().toISOString());
      const md = rendereMeldebildMarkdown(bild, stand);
      const lb = await legeLageberichtAn(einsatzId, { vorlage: 'freitext', titel: `Kräftemeldebild ${stand}` });
      // Hinweis: Schlägt der PATCH fehl, bleibt ein leerer Entwurf zurück (vom EL löschbar).
      // Atomar wäre nur mit eigenem Backend-Endpoint — bewusst v1-Kompromiss.
      await aktualisiereLagebericht(einsatzId, lb.id, { abschnitte: [{ schluessel: 'text', text: md }] });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
    onError: () => message.error('Übernahme fehlgeschlagen'),
  });

  // Erst nach committetem Aufklappen drucken (sonst kollabierte Zeilen bei großen Bäumen).
  useEffect(() => {
    if (printPending) {
      window.print();
      setPrintPending(false);
    }
  }, [printPending]);

  // Tabelle bleibt nach dem Druck bewusst voll aufgeklappt (kein Restore in v1).
  const handleDrucken = () => {
    setExpandedKeys(alleKeys(bild.baum));
    setPrintPending(true);
  };

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const v = bild.verdichtung;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const abschnittName = (id: number) =>
    (abschnitteQuery.data ?? []).find((a) => a.id === id)?.name ?? `Abschnitt ${id}`;
  const chips = aktiveFilterChips(filter, abschnittName);
  const gefiltert = chips.length > 0;
  /**
   * „Kräfte" zählt Personal UND Fahrzeuge, aber KEIN Material — Material ist Mittel, keine
   * Kraft. Dazu kommt ein gemessener Grund: `filtereKraefte` unterwirft Material bewusst
   * nicht dem Kategorie-Filter (es hat eine eigene Statusachse). Ein Zähler, der Material
   * mitzählte, spränge bei gesetztem Statusfilter also aus einem Grund, den die Zeile
   * daneben nicht nennt.
   */
  const sichtbareKraefte = v.anzahlPersonal + v.anzahlFahrzeuge;
  const alleKraefte = gesamt.anzahlPersonal + gesamt.anzahlFahrzeuge;

  return (
    // `kraefte-print-root` bleibt die ÄUSSERE Hülle: `kraefteuebersichtPrint.css` hängt
    // daran (`visibility` + absolute Positionierung im `@media print`), und `EinsatzSeite`
    // nimmt kein `className` entgegen. Dass die Seite dadurch die Lesebreite aus `flaeche`
    // bekommt, ändert am Druck nichts (die Druckseite ist ohnehin schmaler als 960 px).
    <div className="kraefte-print-root">
      <EinsatzSeite
        breite={flaeche.seiteBreit}
        titel="Kräfteübersicht"
        dataUpdatedAt={gemeinsamerDatenstand(
          einheitenQuery.dataUpdatedAt,
          personalQuery.dataUpdatedAt,
          fahrzeugeQuery.dataUpdatedAt,
          materialQuery.dataUpdatedAt,
          abschnitteQuery.dataUpdatedAt,
        )}
        breadcrumb={
          <Breadcrumb className="kraefte-no-print"
            items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Kräfteübersicht' }]} />
        }
        aktionen={
          <Space className="kraefte-no-print">
            {darfSchreiben && (
              <Button loading={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>In Lagebericht übernehmen</Button>
            )}
            <Button onClick={handleDrucken}>Drucken / als PDF</Button>
          </Space>
        }
      >
      {/* ── NUR IM DRUCK (LFH-338 · C3, Befund H4) ────────────────────────────────────
          Das Blatt, das an die übergeordnete Führungsstelle geht, trug weder
          Einsatzbezeichnung noch Zeitstand noch die Angabe, dass es nur einen Ausschnitt
          zeigt: die Bezeichnung stand ausschließlich in der Breadcrumb, und die trägt
          `.kraefte-no-print`. Ein Meldebild ohne diese vier Angaben ist nicht zuordenbar.

          `data-testid`, weil der Knoten am Schirm per CSS verborgen ist und jsdom kein CSS
          auswertet — eine Sichtbarkeitsabfrage könnte hier Schirm- und Druckzweig gar nicht
          unterscheiden. Dass er am Schirm weg ist, prüft die CSS-Textzusicherung im Test. */}
      <div className="kraefte-nur-print" data-testid="kraefte-druckkopf">
        <div style={{ fontWeight: 600 }}>
          Kräfteübersicht — {einsatz.bezeichnung}
          {einsatz.einsatznummer_intern ? ` (${einsatz.einsatznummer_intern})` : ''}
        </div>
        <div>Stand: {taktischeDtgVoll(new Date().toISOString())}</div>
        <div>Erstellt von: {benutzer?.anzeigename ?? '—'}</div>
        {gefiltert && <div>Auswahl: {chips.map((c) => c.label).join(' · ')}</div>}
      </div>
      <Card style={{ marginBottom: abstand.lg }}>
        {/* ── WAS DIESE ZAHLEN BEDEUTEN (LFH-338 · C3, Befund H3) ──────────────────────
            Die Kopfzahlen kommen aus den GEFILTERTEN Daten. Solange darüber unverändert
            „Gesamtstärke" stand, meldete jemand, der kurz weg war und dann abliest, die
            Teilstärke eines Abschnitts als Gesamtstärke des Einsatzes. Die Zeile hier sagt
            deshalb IMMER, wie viel von wie viel gezeigt wird — auch ungefiltert, sonst wäre
            ihr Erscheinen selbst das Signal und ihr Fehlen keine Aussage. */}
        <Space wrap align="center" style={{ marginBottom: abstand.md }}>
          <span style={{ color: token.colorTextSecondary }}>
            {sichtbareKraefte} von {alleKraefte} Kräften
          </span>
          {gefiltert && (
            <span style={{ color: token.colorTextTertiary }}>
              (ungefiltert {staerkeText(gesamt.staerke)})
            </span>
          )}
          {chips.map((chip) => (
            <Tag
              key={chip.schluessel}
              closable
              onClose={() =>
                setFilter((f) => ({ ...f, [chip.schluessel]: LEERER_FILTER[chip.schluessel] }))
              }
            >
              {chip.label}
            </Tag>
          ))}
          {gefiltert && (
            <Button type="link" onClick={() => setFilter(LEERER_FILTER)}>
              Filter zurücksetzen
            </Button>
          )}
        </Space>

        {/* ── DER MONITORING-KOPF BRICHT UM (LFH-338 · C3, Befund H6) ──────────────────
            Vorher: bis zu 12 gleich große `Statistic` in EINER nicht umbrechenden Reihe,
            dahinter ein waagerechter Bildlauf im Karteninneren. Auf einem 13"-Fükw-Schirm
            (~950 px nutzbar) lag die komplette Materialachse rechts außerhalb — ohne
            Bildlaufleiste, ohne abgeschnittene Kachel, ohne jede Andeutung. Wer nicht
            wusste, dass dort etwas liegt, sah es nie.

            Die zwei verantwortlichen Angaben sind hier bewusst NICHT ausgeschrieben: das
            Gate ist ein Grep über diese Datei, und ein Kommentar, der das verbotene
            Konstrukt zitiert, füllt es selbst (gemessen — der Test war grün geschrieben und
            wurde durch diesen Absatz wieder rot).

            Jetzt eine Achse je Spalte (`xs`/`md`/`xl`), und INNERHALB einer Achse kompakt:
            die Verteilungen stehen als eine Zeile statt als vier gleichrangige Kacheln —
            eine Zahl mit Wort ist kürzer als eine Kachel mit Überschrift, und die Rangfolge
            stimmt danach (die Gesamtzahl ist die Kachel, die Aufteilung ihre Fußzeile).

            Die Farbe ist der ZWEITE Kanal, nicht der einzige: jede Zahl trägt ihr Wort
            daneben (Prüflisten-Kriterium 6 / WCAG 1.4.1). Rollen wie in der Statusspalte
            der Tabelle — Kopfzahl und Tag darunter dürfen nicht in verschiedenen Rottönen
            sprechen. */}
        <Row gutter={[abstand.lg, abstand.md]}>
          {/* Achse 1: Personalstärke */}
          <Col xs={24} md={12} xl={8}>
            <Statistic
              title={gefiltert ? 'Stärke (gefiltert, F/UF/M//Ges)' : 'Gesamtstärke (F/UF/M//Ges)'}
              value={staerkeText(v.staerke)}
            />
            <div style={{ color: token.colorTextSecondary, marginBlockStart: token.marginXXS }}>
              {v.anzahlPersonal} Personen
            </div>
          </Col>

          {/* Achse 2: Fahrzeug-Verfügbarkeit */}
          <Col xs={24} md={12} xl={8}>
            <Statistic title="Fahrzeuge" value={v.anzahlFahrzeuge} />
            <Space size="small" wrap style={{ marginBlockStart: token.marginXXS }}>
              <span style={{ color: rollenFarbe(statusKategorie.verfuegbar.rolle, token) }}>
                {v.fahrzeugStatus.verfuegbar} frei
              </span>
              <span aria-hidden>·</span>
              <span style={{ color: rollenFarbe(statusKategorie.gebunden.rolle, token) }}>
                {v.fahrzeugStatus.gebunden} gebunden
              </span>
              <span aria-hidden>·</span>
              <span style={{ color: rollenFarbe(statusKategorie.nicht_verfuegbar.rolle, token) }}>
                {v.fahrzeugStatus.nicht_verfuegbar} n. einsatzbereit
              </span>
            </Space>
          </Col>

          {/* Achse 3: Material */}
          <Col xs={24} md={12} xl={8}>
            <Statistic title="Material (Pos.)" value={v.anzahlMaterialPositionen} />
            <Space size="small" wrap style={{ marginBlockStart: token.marginXXS }}>
              {MAT_STATUS_ANZEIGE.filter(({ key }) => v.materialStatus[key] > 0).map(
                ({ key, label, rolle }) => (
                  <span key={key} style={rolle ? { color: rollenFarbe(rolle, token) } : undefined}>
                    {v.materialStatus[key]} {label.replace('Mtl. ', '')}
                  </span>
                ),
              )}
            </Space>
          </Col>
        </Row>
      </Card>
      <Card className="kraefte-no-print" style={{ marginBottom: abstand.md }}>
        <Space wrap>
          <Select
            placeholder="Abschnitt"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.abschnittId ?? undefined}
            options={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v) => setFilter((f) => ({ ...f, abschnittId: v ?? null }))}
          />
          <Select
            placeholder="Trägerorganisation"
            allowClear
            style={{ minWidth: 180 }}
            value={filter.traeger ?? undefined}
            options={traeger.map((t) => ({ value: t, label: t }))}
            onChange={(v) => setFilter((f) => ({ ...f, traeger: v ?? null }))}
          />
          {/* Die drei Optionen standen hier als Literale — dritte Kopie derselben Labels.
              Sie kommen jetzt aus der einen Statusachse.

              DER VIERTE EIMER BLEIBT DRAUSSEN, und das ist eine Entscheidung, keine
              Auslassung: `FilterWerte.kategorie` ist `StatusKategorie | null`, und
              `filtereKraefte` vergleicht `kat === f.kategorie`. Ein Filterwert `'ohne'`
              träfe damit NIE eine Zeile — eine tote Option, die wie ein Filter aussieht.
              Gruppieren nach vier Eimern (Fahrzeuge/Personal) und Filtern nach drei ist
              hier kein Widerspruch, sondern die Grenze der Datenschicht. */}
          <Select
            placeholder="Status"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.kategorie ?? undefined}
            options={KATEGORIE_WERTE.filter((w) => w.value !== 'ohne').map((w) => ({
              value: w.value as StatusKategorie,
              label: w.text,
            }))}
            onChange={(v) => setFilter((f) => ({ ...f, kategorie: v ?? null }))}
          />
          {/* Fluide statt `width: 220`: die Regel aus `feldbreiten.guard.test.ts` gilt auch
              außerhalb seiner vier gescannten Bereiche (Grenze 3 desselben Guards). */}
          <Input.Search
            placeholder="Suche..."
            allowClear
            style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320 }}
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          />
        </Space>
      </Card>
      {/* Das Meldebild läuft mit `form="tabelle"` — in JEDER Breite Tabelle, kein
          Kartenzweig. Die Bedien-Leitlinie führt diese Seite als kanonisches „wird
          verglichen: ja", und Prüflisten-Kriterium 14 verbietet dort die Auflösung in
          Karten ausdrücklich. Das ist kein Ermessen, und es gibt kein `ohneFixierung`:
          die fixierte menschenlesbare Kennung (Spalte 0) gehört zum selben Kriterium.

          KEIN `suche`, KEIN Spaltenfilter, KEINE `gruppen`, KEINE `standardSortierung`.
          Die Aggregate der Elternzeilen werden stromaufwärts über die VOLLMENGE kumuliert
          (`addKategorie`), während `filtereKraefte` die Rohlisten filtert und den Baum neu
          baut. Fiele im Primitiv eine Zeile weg, behielten die Eltern Zahlen über nicht
          mehr sichtbare Kinder — die Ampelzahlen lügen still, und kein Test sähe es. Also
          filtert das Modul (Filter-Card oben, außerhalb), `Datensicht` rendert.

          `zufluss="sofort"` folgt der API-Spec §6 gegen den Plan-Entwurf. Begründung: die
          Schleuse führt nur die WURZEL-Schlüsselfolge. Eine neue Disposition schiebt aber
          eine Mittel-Zeile TIEF in den Baum — deren Position kennt die Schleuse nicht, der
          erhoffte Schutz tritt also gar nicht ein, und ein Sammelbanner erschiene für einen
          Zufluss, der oben nie ankommt. Diese Fläche trägt zudem keine Bedienelemente in
          der Zeile; das Kriterium-12-Risiko liegt bei Fahrzeugen und Personal.

          `handleDrucken` bleibt in `aktionen` und wandert NICHT in `werkzeuge` (Abweichung
          von Spec §6): `kraefteuebersichtPrint.css` markiert über `.kraefte-no-print`, und
          ein Knoten innerhalb von `Datensicht` ist nicht markierbar — `DatensichtProps`
          nimmt kein `className`. */}
      <Datensicht
        bezeichnung="Meldebild"
        form="tabelle"
        spalten={meldebildSpalten}
        daten={bild.baum}
        zeilenSchluessel="key"
        leerText="Keine Kräfte im Einsatz disponiert"
        baum={{ kinder: 'children', aufgeklappt: expandedKeys, onAufgeklappt: setExpandedKeys }}
        zufluss="sofort"
        karte={{ art: 'plan', titel: { spalte: 'bez' }, sekundaer: ['detail', 'staerke', 'status'] }}
      />
      </EinsatzSeite>
    </div>
  );
}
