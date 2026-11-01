/**
 * Vorschauen des Design Systems aus den ECHTEN Bausteinen (design.md D4): jede Vorschau wird mit
 * `react-dom/server` im antd-Theme der App gerendert (`antdThema`, dieselbe Quelle wie der
 * `ConfigProvider` in `theme/ThemeModeProvider.tsx`), Nacht über Tag, Dichte `kompakt`. Das CSS
 * kommt aus antds CSS-in-JS (`extractStyle`) und den Stilen der App (`theme/rollen.css`,
 * `theme/sprache.css`, `index.css`); die Rollen schalten per `data-theme` am Abschnitt, wie in
 * der App am `<html>`.
 *
 * Ein Zustand, den nur eine Bedienung erreicht (die offene `InlineAngabe`), wird im jsdom des
 * Vitest-Laufs mit `react-dom/client` gerendert und angeklickt. Das CSS kommt auch dann aus dem
 * Cache (`mock="server"` hängt nichts ins Dokument), aber nur, solange der Baum hängt: cssinjs
 * räumt einen Eintrag ab, sobald sein letzter Nutzer aushängt (`useGlobalCache`). Deshalb liest
 * `renderPreview` das CSS vor dem Aushängen. Die Variablenklasse ist je Thema fest
 * (`css-var-nacht`, `css-var-tag`; antd setzt den Schlüssel selbst als Klasse) statt antds
 * `css-var-<useId>`, dessen Wert im Client-Render an einem Zähler des Prozesses hängt.
 *
 * Nachbauten in HTML gibt es nicht: sie drifteten. Kombinationen aus Text und Grund sind die der
 * Bausteine, also von deren Kontrast-Tests gedeckt.
 */
import { act, useId, useState, type ReactElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { createCache, extractStyle, StyleProvider } from '@ant-design/cssinjs';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Button, ConfigProvider, Form, Input, Segmented } from 'antd';
import deDE from 'antd/locale/de_DE';
import {
  antdKaestchen,
  antdKlappkopf,
  antdKnopf,
  antdOptionsknopf,
  antdThema,
  rahmenFarben,
  type Dichte,
} from '../../src/theme/tokens';
import { rollenFarbe, statusKategorie, warnstufeBalkenFarbe } from '../../src/theme/statusFarben';
import type { Sichtungskategorie, Verletzung } from '../../src/api/types';
import { createMemoryRouter, Link, MemoryRouter, RouterProvider } from 'react-router';
import {
  Augenbraue,
  BearbeitbaresPaneel,
  DashboardFlaeche,
  DashboardPaneel,
  Datenfeld,
  DatenfeldEingabe,
  Datenraster,
  FeldFehler,
  GliederungsPaneel,
  Kennzahl,
  Kennzahlenband,
  ListenAbschnitt,
  listenZeileStil,
  MatrixPaneel,
  Paneel,
  PaneelZeile,
  Sammelbanner,
  Segmentleiste,
  StatusChip,
  StatusZelle,
  StromPaneel,
  VerteilungsPaneel,
  Zeitachseneintrag,
  useRollen,
} from '../../src/components/instrument';
import StatusTag from '../../src/components/StatusTag';
import SichtungsTag from '../../src/components/SichtungsTag';
import { InlineAngabe } from '../../src/components/InlineAngabe';
import FunkUndTelefon from '../../src/components/FunkUndTelefon';
import { VerbindungenAngabe } from '../../src/components/VerbindungenFeld';
import type { KommunikationsVerbindung } from '../../src/api/types';
import { OffeneBearbeitungProvider } from '../../src/components/offeneBearbeitung';
import { useSpeicherLeiste } from '../../src/components/speicherLeiste';
import DokumentEntwurf from '../../src/entwurf/DokumentEntwurf';
import { VORLAGEN } from '../../src/befehle/vorlagen';
import StammdatenFeld, { type Vorschlagsquelle } from '../../src/components/StammdatenFeld';
import KatalogTabelle from '../../src/components/KatalogTabelle';
import type { ListenGedaechtnis } from '../../src/components/listenGedaechtnis';
import { AnzeigeKonventionenProvider } from '../../src/anzeige/AnzeigeKonventionenContext';
import ZeitAnzeige from '../../src/anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../../src/anzeige/ZeitpunktEingabe';
import { Ortsfeld } from '../../src/anzeige/Ortsfeld';
import type { OrtSucheAntwort } from '../../src/api/karteOrtSuche';
import type { OrtVorschau } from '../../src/api/ortVorschau';
import { einsatzKeys } from '../../src/api/queryKeys';
import EingaengeKnopf from '../../src/alarm/EingaengeKnopf';
import Eingangsband from '../../src/alarm/Eingangsband';
import SichtungsWahl from '../../src/personen/SichtungsWahl';
import Koerperschema from '../../src/personen/koerperschema/Koerperschema';
import EinsatzZeichen from '../../src/zeichen/EinsatzZeichen';
import { useZeichenTheme } from '../../src/zeichen/useZeichenTheme';
import EinheitZeichen, { FahrzeugZeichen } from '../../src/kraefte/EinheitZeichen';
import { baueTzProps, schadenTz, type TzProps } from '../../src/pages/lagekarte/taktischesZeichen';

/** Die Vorschauen zeigen die Stufe des Fükw, des primären Kontexts. */
const DICHTE: Dichte = 'kompakt';

export interface PreviewSpec {
  /** Ordner unter `components/` und Titel der Karte. */
  name: string;
  title: string;
  group: string;
  /**
   * Höhe der Karte in px (Nacht und Tag untereinander): gemessene Inhaltshöhe bei 720 px Breite mit
   * den Schriften plus etwa 16 px (19.10.2026, Chromium). Die Karte scrollt nicht; wächst der
   * Inhalt, neu messen.
   */
  height: number;
  /** Quelldatei relativ zu `frontend/src/`, aus deren JSDoc die README entsteht. */
  source: string;
  /** Zeile, vor der der JSDoc-Block steht; ohne Anker der erste Block der Datei. */
  docAnchor?: string;
  /** Statt JSDoc: die Regel aus `frontend/AGENTS.md` (Spiegelstrich mit diesem fetten Kopf). */
  ruleHead?: string;
  /** Weitere Quelle (relativ zu `frontend/src/`), deren erster JSDoc-Absatz die README ergänzt. */
  moreDoc?: string;
  /**
   * Stile, die der Baustein selbst importiert (relativ zu `frontend/src/`): der Rahmen trägt sonst
   * nur `theme/rollen.css`, `theme/sprache.css` und `index.css` (`generate.tsx`, `appCss`).
   */
  styles?: readonly string[];
  content: () => ReactNode;
  /** Bedienung nach dem Render; macht die Vorschau zu einem Client-Render im jsdom. */
  interact?: (container: HTMLElement) => Promise<void>;
  /**
   * Client-Render im jsdom ohne Bedienung: für Bausteine, die den Viewport lesen
   * (`useViewport` hat keinen Server-Stand, `renderToString` bräche ab) oder ein Portal öffnen.
   */
  client?: true;
}

const nichts = () => undefined;

function InlineAngabeBeispiel({ etikett, wert }: { etikett: string; wert: string }) {
  const [gespeichert, setGespeichert] = useState(wert);
  return (
    <InlineAngabe<string>
      etikett={etikett}
      wert={gespeichert}
      anzeige={gespeichert}
      leer={(w) => w.trim() === ''}
      darfSchreiben
      eingabe={({ feld, value, onChange }) => (
        <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      onSpeichern={async (neu) => setGespeichert(neu)}
    />
  );
}

const BEISPIEL_VERBINDUNGEN: KommunikationsVerbindung[] = [
  { id: 1, mittel: 'mobil', wert: '0170 1234567', hinweis: 'Zugführer' },
  { id: 2, mittel: 'festnetz', wert: '05141 9930' },
  { id: 3, mittel: 'email', wert: 'ea-nord@example.org' },
];

function VerbindungenBeispiel() {
  const [liste, setListe] = useState<KommunikationsVerbindung[]>(BEISPIEL_VERBINDUNGEN);
  return (
    <VerbindungenAngabe
      etikett="Telefon und weitere Verbindungen"
      verbindungen={liste}
      darfSchreiben
      onSpeichern={async (neu) => setListe(neu.map((v, i) => ({ id: i + 1, ...v })))}
    />
  );
}

/**
 * Zwei Paneele einer Ansicht unter EINEM Merker; „Funk“ wird in `interact` geöffnet, „Telefon“
 * steht dann gesperrt mit Grund. Der Merker hängt die Rückfrage vor dem Verlassen ein, und die
 * braucht einen Data Router (`useBlocker`).
 */
function BearbeitbaresPaneelBeispiel() {
  const [router] = useState(() =>
    createMemoryRouter([
      {
        path: '*',
        element: (
          <OffeneBearbeitungProvider>
            <div className="ds-stapel">
              <BearbeitbaresPaneel<{ rufname: string; kanal: string }>
                titel="Funk"
                ueberschrift="h3"
                datensatz={{ geaendert_at: '2026-10-22 10:00:00' }}
                werte={{ rufname: 'Florian Celle 1-46-1', kanal: '41' }}
                felder={[
                  {
                    name: 'rufname',
                    label: 'Rufname',
                    anzeige: 'Florian Celle 1-46-1',
                    eingabe: <Input />,
                  },
                  { name: 'kanal', label: 'Sprechgruppe', anzeige: '41', eingabe: <Input /> },
                ]}
                spalten={2}
                onSpeichern={async () => undefined}
                darfSchreiben
              />
              <BearbeitbaresPaneel<{ nummer: string }>
                titel="Telefon"
                ueberschrift="h3"
                datensatz={{ geaendert_at: '2026-10-22 10:00:00' }}
                werte={{ nummer: '05141 2026' }}
                felder={[
                  {
                    name: 'nummer',
                    label: 'Verbindung',
                    anzeige: '05141 2026',
                    eingabe: <Input />,
                  },
                ]}
                spalten={2}
                onSpeichern={async () => undefined}
                darfSchreiben
              />
            </div>
          </OffeneBearbeitungProvider>
        ),
      },
    ]),
  );
  return <RouterProvider router={router} />;
}

function SpeicherleisteBeispiel() {
  const leiste = useSpeicherLeiste({ hasAbbrechen: true });
  return (
    <Form layout="vertical" initialValues={{ bezeichnung: 'Bereitstellungsraum Nord' }}>
      <Form.Item label="Bezeichnung" name="bezeichnung">
        <Input />
      </Form.Item>
      <div {...leiste}>
        <Button type="primary" htmlType="submit">
          Speichern
        </Button>
        <Button>Abbrechen</Button>
      </div>
    </Form>
  );
}

/** antds `Segmented` mit einem gesperrten Eintrag; eigener Gruppenname je Thema. */
function SegmentedBeispiel() {
  const name = useId();
  return (
    <Segmented
      name={name}
      aria-label="Ansicht"
      options={[
        { label: 'Liste', value: 'liste' },
        { label: 'Karte', value: 'karte' },
        { label: 'Archiv', value: 'archiv', disabled: true },
      ]}
      defaultValue="liste"
    />
  );
}

/** Gliederung der echten Vorlage „Befehl LAD (vereinfacht)“: Lage, Auftrag, Durchführung. */
const BEFEHL_LAD = VORLAGEN.find((v) => v.schluessel === 'befehl_lad')!.abschnitte;

/** Lage und Durchführung gefüllt, Auftrag leer: Füllstand, Leer-Marke und Haken in einem Bild. */
const BEFEHL_WERTE = {
  lage:
    'Brand eines landwirtschaftlichen Anwesens, Scheune im Vollbrand. ' +
    'Wohnhaus **nicht** betroffen, Wasserversorgung über Hydrant und offenes Gewässer.',
  auftrag: '',
  durchfuehrung:
    '- EA 1: Brandbekämpfung Scheune, Riegelstellung zum Wohnhaus\n' +
    '- EA 2: Wasserversorgung vom Löschteich',
};

/** Eigener Formularname je Instanz: die Feld-IDs (`<name>_lage`) stehen sonst viermal im Dokument. */
function DokumentEntwurfBeispiel() {
  const [form] = Form.useForm();
  const name = useId();
  return (
    <Form form={form} name={name} layout="vertical" initialValues={BEFEHL_WERTE}>
      <DokumentEntwurf form={form} abschnitte={BEFEHL_LAD} einstieg={undefined} />
    </Form>
  );
}

/**
 * Zwei Paneeltypen des Dashboard-Baukastens in ihrer Fläche: eine Verteilung (Einheiten nach
 * Status, eine Kategorie mit Ausfall „—“) und eine Stufenmatrix. Farben aus dem Vertrag, aufgelöst
 * im Thema der Karte.
 */
function DashboardBeispiel() {
  const { token, rollen } = useRollen();
  const verteilung = [
    { schluessel: 'frei', wort: 'frei', rolle: 'normal', wert: 12 },
    { schluessel: 'unterwegs', wort: 'unterwegs', rolle: 'bedien', wert: 9 },
    { schluessel: 'am-ort', wort: 'am Einsatzort', rolle: 'bedien', wert: 8 },
    { schluessel: 'ausser-dienst', wort: 'außer Dienst', rolle: 'alarm', wert: null },
  ] as const;
  return (
    <DashboardFlaeche>
      <VerteilungsPaneel
        titel="Einheiten nach FMS-Status"
        ueberschrift="h3"
        kennung="fms"
        zustand="daten"
        meta="29 Einheiten"
        sprung={{ label: 'Meldebild', onKlick: nichts }}
        leerText="Keine Einheiten im Einsatz."
        gesperrtText="Modul Einheiten nicht freigegeben."
        onNeuladen={nichts}
        zeilen={verteilung.map((z) => ({
          schluessel: z.schluessel,
          wort: z.wort,
          wert: z.wert,
          anteil: (z.wert ?? 0) / 29,
          balkenFarbe: rollenFarbe(z.rolle, token),
        }))}
      />
      <MatrixPaneel
        titel="Gefahrenmatrix"
        ueberschrift="h3"
        kennung="gefahren"
        zustand="daten"
        meta="2 Gebiete"
        sprung={{ label: 'Gefahren', onKlick: nichts }}
        leerText="Keine Gefahr über Stufe „keine“."
        gesperrtText="Modul Gefahren nicht freigegeben."
        onNeuladen={nichts}
        stufen={['niedrig', 'mittel', 'hoch', 'akut']}
        zeilen={(
          [
            ['Brand', 'hoch', 3, 'alarm'],
            ['Einsturz', 'mittel', 2, 'achtung'],
            ['Gas', 'niedrig', 1, 'neutral'],
          ] as const
        ).map(([name, stufe, rang, ton]) => ({
          schluessel: name,
          name,
          beschriftung: `${name}: ${stufe}`,
          rang,
          farbe: warnstufeBalkenFarbe(stufe, token) ?? rollen.gedaempft,
          stufenwort: stufe,
          ton,
        }))}
      />
    </DashboardFlaeche>
  );
}

/** Eine Quelle „Im Einsatz“ und ein Katalog mit Anlage, ohne Recht (LLH-1144). */
const STAMMDATEN_QUELLEN: readonly Vorschlagsquelle[] = [
  {
    id: 'funkrufnamenEinsatz',
    gruppe: 'einsatz',
    eintraege: [{ label: 'Florian Musterstadt 1/10-1', wert: 'Florian Musterstadt 1/10-1' }],
  },
  {
    id: 'externeStellen',
    gruppe: 'stammdaten',
    eintraege: [],
    uebernahme: {
      ziel: 'Externe Stellen',
      anlegen: async () => ({ id: 0 }),
      gesperrt: 'nur System-Admin',
    },
  },
];

/** Eigener Formularname je Instanz: die Feld-IDs stehen sonst viermal im Dokument. */
function StammdatenFeldBeispiel() {
  const name = useId();
  return (
    <Form
      name={name}
      layout="vertical"
      initialValues={{ absender: 'Florian Musterstadt 1/10-1', empfaenger: 'Polizei vor Ort' }}
    >
      <Form.Item label="Absender (Funkrufname/Stelle)" name="absender">
        <StammdatenFeld nurText quellen={STAMMDATEN_QUELLEN} />
      </Form.Item>
      <Form.Item label="Empfänger / Adressat" name="empfaenger">
        <StammdatenFeld nurText quellen={STAMMDATEN_QUELLEN} />
      </Form.Item>
    </Form>
  );
}

const SICHTUNGEN: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'];

/**
 * Konventionen der Vorschauen mit Zeiten: feste Zone, damit die Ausgabe nicht an der Zone des
 * Rechners hängt; Darstellung je Aufruf.
 */
const KONVENTIONEN_TAKTISCH = { zeitzone: 'Europe/Berlin', zeitdarstellung: 'taktisch' } as const;
const KONVENTIONEN_DATUM = { zeitzone: 'Europe/Berlin', zeitdarstellung: 'datum_uhrzeit' } as const;

/**
 * Ein QueryClient ohne Abruf: jede Abfrage ohne eigenes `enabled` steht still, eine mit eigenem
 * `enabled` findet ihre Daten frisch im Cache. Die Vorschau fragt so nie einen Server.
 */
function stillerQueryClient(daten: readonly (readonly [QueryKey, unknown])[] = []): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } },
  });
  for (const [key, wert] of daten) client.setQueryData(key, wert);
  return client;
}

/** Zwei Zeitpunkte aus der Vergangenheit: „heute“ träfe je nach Lauf eine andere Form. */
const ZEIT_ALARM = '2026-10-10T12:30:00Z';
const ZEIT_LAGE = '2026-10-09T07:05:00Z';

/**
 * Die drei Rollen der Zeitdarstellung in beiden Darstellungen, je Zeile eine Rolle. Die Form
 * „heute“ von `kurz` fehlt: sie hinge am Tag des Laufs.
 */
function ZeitdarstellungBeispiel() {
  const rollen = [
    ['Zeitpunkt', 'zeitpunkt'],
    ['Kurz (nicht heute)', 'kurz'],
    ['Uhrzeit', 'uhrzeit'],
  ] as const;
  return (
    <Datenraster spalten={3} beschriftung="Zeitdarstellung">
      {(
        [
          ['taktisch', KONVENTIONEN_TAKTISCH],
          ['Datum und Uhrzeit', KONVENTIONEN_DATUM],
        ] as const
      ).flatMap(([darstellung, konventionen]) =>
        rollen.map(([etikett, rolle]) => (
          <AnzeigeKonventionenProvider key={`${darstellung}-${rolle}`} konventionen={konventionen}>
            <Datenfeld label={`${etikett} · ${darstellung}`} mono>
              <ZeitAnzeige wert={ZEIT_ALARM} rolle={rolle} />
            </Datenfeld>
          </AnzeigeKonventionenProvider>
        )),
      )}
    </Datenraster>
  );
}

/**
 * Drei Zeitfelder: eine Ereigniszeit mit Wert und Schnellwahl, eine leere Frist und eine
 * unlesbare Eingabe nach dem Verlassen (in `interact` getippt): der geltende Wert steht wieder da,
 * daneben der Grund. Die Deutung beim Tippen zeigt nur das fokussierte Feld, also je Seite eines.
 */
function ZeiteingabeBeispiel() {
  const name = useId();
  return (
    <AnzeigeKonventionenProvider konventionen={KONVENTIONEN_TAKTISCH}>
      <Form
        name={name}
        layout="vertical"
        initialValues={{ alarmiert: dayjs(ZEIT_ALARM), frist: null, lage: dayjs(ZEIT_LAGE) }}
      >
        <Form.Item label="Alarmiert" name="alarmiert">
          <ZeitpunktEingabe art="ereignis" schnellwahl />
        </Form.Item>
        <Form.Item label="Frist" name="frist">
          <ZeitpunktEingabe art="frist" />
        </Form.Item>
        <Form.Item label="Lage gemeldet" name="lage">
          <ZeitpunktEingabe art="ereignis" data-ds-tippen="14:3x" />
        </Form.Item>
      </Form>
    </AnzeigeKonventionenProvider>
  );
}

/** Tippt in jedes Zeitfeld mit `data-ds-tippen` dessen Text und verlässt es wieder. */
async function tippeInZeitfelder(container: HTMLElement): Promise<void> {
  const felder = container.querySelectorAll<HTMLInputElement>('input[data-ds-tippen]');
  if (felder.length !== 2) throw new Error('Design System: Zeitfelder zum Tippen nicht gefunden');
  const setzeWert = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const feld of felder) {
    await act(async () => {
      feld.focus();
      setzeWert.call(feld, feld.dataset.dsTippen);
      feld.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => feld.blur());
  }
}

/** Ein Ort mit Ortsname und Peilung aus dem Cache; auf 3 Stellen, wie der Schlüssel der Vorschau rundet. */
const ORT_PUNKT = { lat: 52.625, lon: 10.082 };
const ORT_VORSCHAU: OrtVorschau = {
  ortsname: 'Celle, Altstadt',
  peilung: { bezug_label: 'Einsatzort', distanz_m: 420, richtung: 'NO' },
};

/**
 * Drei Ortsfelder: leer mit Suche und „Auf Karte wählen“, auf der Karte gesetzt (Rahmen der
 * Kartenvorschau, Ort-Zeile, „Als Adresse übernehmen“) und eine personenbezogene Adresse als reiner
 * Text. Das Kartenbild selbst zeichnet MapLibre erst im Browser; die Vorschau zeigt seinen Rahmen.
 */
function OrtsfeldBeispiel() {
  const [client] = useState(() =>
    stillerQueryClient([
      [einsatzKeys.ortVorschau(1, ORT_PUNKT.lat, ORT_PUNKT.lon, 'schaden:7'), ORT_VORSCHAU],
    ]),
  );
  const name = useId();
  const suche = {
    suchen: async (): Promise<OrtSucheAntwort> => ({ zustand: 'ok', treffer: [] }),
    suchSchluessel: (begriff: string) => einsatzKeys.einsatzortSuche(1, begriff),
  };
  return (
    <QueryClientProvider client={client}>
      <AnzeigeKonventionenProvider konventionen={KONVENTIONEN_TAKTISCH}>
        <Form
          name={name}
          layout="vertical"
          initialValues={{
            leer: { text: '', koordinate: null },
            gesetzt: { text: 'Hinter der Scheune', koordinate: ORT_PUNKT, quelle: 'karte' },
            herkunft: { text: 'Musterweg 3, 29221 Celle', koordinate: null },
          }}
        >
          <Form.Item label="Standort" name="leer">
            <Ortsfeld {...suche} karte={{ etikett: 'Standort', einsatzId: 1 }} />
          </Form.Item>
          <Form.Item label="Schadenort" name="gesetzt">
            <Ortsfeld
              {...suche}
              karte={{ etikett: 'Schadenort', einsatzId: 1, exclude: 'schaden:7' }}
            />
          </Form.Item>
          <Form.Item label="Herkunft / Adresse" name="herkunft">
            <Ortsfeld ohneSuche="personenbezogen" />
          </Form.Item>
        </Form>
      </AnzeigeKonventionenProvider>
    </QueryClientProvider>
  );
}

/** Wartet die Entprellung der Ort-Vorschau ab (`useOrtVorschau`, 700 ms). */
async function warteAufOrtVorschau(container: HTMLElement): Promise<void> {
  await act(() => new Promise((fertig) => setTimeout(fertig, 800)));
  const vorschlaege = [...container.querySelectorAll('button')].filter(
    (knopf) => knopf.textContent === 'Als Adresse übernehmen',
  );
  if (vorschlaege.length !== 2) {
    throw new Error('Design System: Vorschlag „Als Adresse übernehmen“ fehlt');
  }
}

/** Der Knopf „Eingänge“ ohne und mit ungelesenen Eingängen, auf dem dauerdunklen Rahmengrund. */
function EingaengeKnopfBeispiel({ ungelesen }: { ungelesen: number }) {
  const [client] = useState(() =>
    stillerQueryClient([
      [einsatzKeys.benachrichtigungVerlauf(ungelesen), { eintraege: [], ungelesen }],
    ]),
  );
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EingaengeKnopf einsatzId={ungelesen} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Knopf und Eingangsband. Das Band hängt in der App als Portal fest am unteren Rand; `interact`
 * setzt eine Kopie an seinen Platz unter dem Kopf (`data-ds-band`) und löst sie aus der festen
 * Lage, sonst stünde es außerhalb der Karte.
 */
function EingaengeBeispiel() {
  return (
    <div className="ds-stapel">
      <div className="ds-reihe" style={{ background: rahmenFarben.grund, padding: 8 }}>
        <EingaengeKnopfBeispiel ungelesen={0} />
        <EingaengeKnopfBeispiel ungelesen={3} />
      </div>
      <div data-ds-band="" />
      <Eingangsband
        titel="3 neue Eingänge"
        aktion={{ text: 'Ansehen', beiKlick: nichts }}
        beiSchliessen={nichts}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBlockStart: 4 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong>Meldung von Florian Celle 1-46-1</strong>: Wasserversorgung steht · 1430
          </span>
          <Button>Sichten</Button>
        </div>
        <div style={{ marginBlockStart: 4 }}>
          <strong>Lagemeldung EA 2</strong>: Lage unverändert · 1426
        </div>
        <div style={{ marginBlockStart: 4 }}>+ 1 weitere</div>
      </Eingangsband>
    </div>
  );
}

async function holeEingangsband(container: HTMLElement): Promise<void> {
  const baender = [...document.body.querySelectorAll<HTMLElement>('[data-lfh="eingangsband"]')];
  const plaetze = container.querySelectorAll('[data-ds-band]');
  if (baender.length !== 2 || plaetze.length !== 2) {
    throw new Error('Design System: Eingangsband nicht gefunden');
  }
  // Eine Kopie: das Original gehört React und hängt beim Aushängen aus `document.body` aus.
  baender.forEach((band, i) => {
    const kopie = band.cloneNode(true) as HTMLElement;
    kopie.style.position = 'static';
    kopie.style.width = 'auto';
    plaetze[i].replaceWith(kopie);
  });
}

/** Die Sichtungswahl ohne Wahl und mit gewählter SK II. */
function SichtungsWahlBeispiel() {
  const [wahl, setWahl] = useState<Sichtungskategorie | null>('sk2');
  return (
    <div className="ds-stapel">
      <SichtungsWahl aria-label="Sichtung (ohne Wahl)" value={null} onChange={nichts} />
      <SichtungsWahl aria-label="Sichtung" value={wahl} onChange={setWahl} />
    </div>
  );
}

/** Drei Verletzungen, vorn und hinten, eine ohne Schwere; ohne Lage, also mittig in der Region. */
const VERLETZUNGEN: Verletzung[] = (
  [
    [1, 'vorn', 'unterarm_l', 'fraktur_verdacht', 'schwer'],
    [2, 'vorn', 'kopf', 'wunde_blutung', null],
    [3, 'hinten', 'ruecken', 'schmerz', 'mittel'],
  ] as const
).map(([id, ansicht, region, art, schwere]) => ({
  id,
  einsatz_id: 1,
  person_id: 1,
  ansicht,
  region,
  art,
  schwere,
  erfasst_at: ZEIT_LAGE,
  erfasst_von: 1,
  zeitpunkt_at: ZEIT_LAGE,
}));

function KoerperschemaBeispiel() {
  return (
    <AnzeigeKonventionenProvider konventionen={KONVENTIONEN_TAKTISCH}>
      <Koerperschema
        einsatzId={1}
        verletzungen={VERLETZUNGEN}
        geschlecht="maennlich"
        modus="lesen"
      />
    </AnzeigeKonventionenProvider>
  );
}

interface Quelle {
  kennung: string;
  ort: string;
  ausmass: 'gross' | 'mittel' | 'klein';
}

const AUSMASS = [
  { text: 'Groß', value: 'gross' },
  { text: 'Mittel', value: 'mittel' },
  { text: 'Klein', value: 'klein' },
] as const;

const SCHAEDEN: Quelle[] = [
  { kennung: 'S-01', ort: 'Scheune Hof Meyer', ausmass: 'gross' },
  { kennung: 'S-02', ort: 'Wohnhaus Nord', ausmass: 'klein' },
  { kennung: 'S-03', ort: 'Stallung', ausmass: 'mittel' },
  { kennung: 'S-04', ort: 'Lagerhalle', ausmass: 'gross' },
  { kennung: 'S-05', ort: 'Garage', ausmass: 'klein' },
];

/** Ein gemerkter Stand: nach Ort sortiert, Ausmaß „Groß“ gefiltert. */
const SCHAEDEN_GEDAECHTNIS: ListenGedaechtnis = {
  start: {
    sortierung: { spalte: 'ort', richtung: 'auf' },
    filter: { ausmass: ['gross'] },
    suche: '',
  },
  spaltenStart: null,
  melde: nichts,
  meldeSpalten: nichts,
};

/**
 * Eine Vergleichstabelle mit Sortieren und Filtern im Kopf: sortiert nach Ort, gefiltert nach
 * Ausmaß, darüber Chip und Filterhinweis.
 */
function TabelleBeispiel() {
  return (
    <KatalogTabelle<Quelle>
      rowKey="kennung"
      dataSource={SCHAEDEN}
      gedaechtnis={SCHAEDEN_GEDAECHTNIS}
      mehrzahl="Schäden"
      pagination={false}
      columns={[
        {
          title: 'Kennung',
          dataIndex: 'kennung',
          key: 'kennung',
          zahl: true,
          sorter: (a, b) => a.kennung.localeCompare(b.kennung),
        },
        {
          title: 'Ort',
          dataIndex: 'ort',
          key: 'ort',
          sorter: (a, b) => a.ort.localeCompare(b.ort),
        },
        {
          title: 'Ausmaß',
          key: 'ausmass',
          render: (_, s) => AUSMASS.find((a) => a.value === s.ausmass)!.text,
          filters: [...AUSMASS],
          onFilter: (wert, s) => s.ausmass === wert,
        },
      ]}
    />
  );
}

/**
 * Die übrigen Paneeltypen des Dashboard-Baukastens: Abschnitte einer Liste („Offene Vorgänge“,
 * einer leer, einer gesperrt), eine Gliederung mit Lagekante und ein Strom mit Sammelbanner.
 */
function DashboardListenBeispiel() {
  const { token, rollen } = useRollen();
  const auftraege = [
    ['A-12', 'Riegelstellung Wohnhaus', 'EA 1'],
    ['A-13', 'Wasserversorgung vom Löschteich', 'EA 2'],
  ] as const;
  return (
    <MemoryRouter>
      <DashboardFlaeche>
        <DashboardPaneel
          titel="Offene Vorgänge"
          ueberschrift="h3"
          zustand="daten"
          leerText="Keine offenen Vorgänge."
          gesperrtText="Nicht freigegeben."
          onNeuladen={nichts}
        >
          <ListenAbschnitt<(typeof auftraege)[number]>
            titel="Aufträge"
            ueberschrift="h4"
            zahl={2}
            zahlWort="offen"
            notiz="davon 1 überfällig"
            zustand="daten"
            eintraege={auftraege}
            schluessel={(a) => a[0]}
            zeile={(a) => (
              <Link to={`/auftraege/${a[0]}`} style={listenZeileStil(rollen, token)}>
                {`${a[0]} ${a[1]} · ${a[2]}`}
              </Link>
            )}
            sprung={{ ziel: '/auftraege', name: 'Aufträge' }}
            gesperrtText="nicht freigegeben"
            onNeuladen={nichts}
          />
          <ListenAbschnitt<string>
            titel="Nachforderungen"
            ueberschrift="h4"
            zahl={0}
            zustand="daten"
            eintraege={[]}
            schluessel={(e) => e}
            zeile={(e) => e}
            gesperrtText="nicht freigegeben"
            onNeuladen={nichts}
          />
          <ListenAbschnitt<string>
            titel="Erinnerungen"
            ueberschrift="h4"
            zahl={null}
            zustand="gesperrt"
            eintraege={[]}
            schluessel={(e) => e}
            zeile={(e) => e}
            gesperrtText="Modul Erinnerungen nicht freigegeben"
            onNeuladen={nichts}
          />
        </DashboardPaneel>
        <GliederungsPaneel
          titel="Einsatzabschnitte"
          ueberschrift="h3"
          zustand="daten"
          meta="2 Abschnitte"
          leerText="Keine Abschnitte."
          gesperrtText="Nicht freigegeben."
          onNeuladen={nichts}
          zeilen={[
            {
              schluessel: 1,
              ziel: '/abschnitte/1',
              kante: { farbe: rollen.alarm, rolle: 'alarm' },
              kopf: 'EA 1 Brandbekämpfung · kritisch',
              inhalt: 'Riegelstellung zum Wohnhaus',
              zahl: '1/4/18',
            },
            {
              schluessel: 2,
              ziel: '/abschnitte/2',
              kante: null,
              kopf: 'EA 2 Wasserversorgung',
              inhalt: 'Löschteich, 2 B-Leitungen',
              zahl: '0/2/9',
            },
          ]}
        />
        <StromPaneel
          titel="Jüngste Einträge"
          ueberschrift="h3"
          zustand="daten"
          leerText="Keine Einträge."
          gesperrtText="Nicht freigegeben."
          onNeuladen={nichts}
          neu={2}
          bannerText="2 neue Einträge"
          onAnzeigen={nichts}
          listeName="Jüngste Einträge"
        >
          <Zeitachseneintrag als="li" zeit="1430" nr="Nr. 42" typ="meldung" typwort="Meldung">
            Wasserversorgung vom Löschteich steht
          </Zeitachseneintrag>
          <Zeitachseneintrag als="li" zeit="1426" nr="Nr. 41" typ="lage" typwort="Lage">
            Lage unverändert, Riegelstellung hält
          </Zeitachseneintrag>
        </StromPaneel>
      </DashboardFlaeche>
    </MemoryRouter>
  );
}

/**
 * Zeichen der Fachobjekte (LLH-1475): Einheit und Fahrzeug mit und ohne Organisation, Gefahr mit
 * und ohne Ausmaß. Ohne Organisation zeichnet die Bibliothek nur einen Umriss, nachts der Fall,
 * den das Render-Theme `dark` trägt.
 */
const ZEICHEN_BEISPIELE: readonly { wort: string; tz: TzProps }[] = [
  { wort: 'Zug', tz: baueTzProps({ objekttyp: 'einheit', einheitTypLabel: 'Zug' }) },
  {
    wort: 'Gruppe Feuerwehr',
    tz: baueTzProps({
      objekttyp: 'einheit',
      einheitTypLabel: 'Gruppe',
      organisation: 'feuerwehr',
      fachaufgabe: 'brandbekaempfung',
    }),
  },
  { wort: 'Fahrzeug', tz: baueTzProps({ objekttyp: 'fahrzeug' }) },
  {
    wort: 'Fahrzeug THW',
    tz: baueTzProps({ objekttyp: 'fahrzeug', traegerorganisation: 'THW', fachaufgabe: 'bergung' }),
  },
  { wort: 'Brand, groß', tz: schadenTz('gross', 'brand') },
  { wort: 'Einsturz, ohne Ausmaß', tz: schadenTz(null, 'einsturz') },
];

function TaktischeZeichenBeispiel() {
  const theme = useZeichenTheme();
  const { rollen } = useRollen();
  return (
    <div className="ds-stapel">
      <div className="ds-reihe" style={{ gap: 16, alignItems: 'flex-start' }}>
        {ZEICHEN_BEISPIELE.map(({ wort, tz }) => (
          <figure
            key={wort}
            style={{
              margin: 0,
              width: 96,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <EinsatzZeichen tz={tz} size={48} theme={theme} />
            <figcaption style={{ color: rollen.text2, fontSize: 12, textAlign: 'center' }}>
              {wort}
            </figcaption>
          </figure>
        ))}
      </div>
      {/* Die Zeilen des Meldebilds: Einheit 26 px, Fahrzeug 22 px, je im Rahmen. */}
      <div className="ds-reihe">
        <EinheitZeichen tz={{ typLabel: 'Gruppe', fachaufgabe: null, organisation: null }} />
        <span>1. Gruppe</span>
        <FahrzeugZeichen
          tz={{
            fahrzeugtyp: 'LF 20',
            traegerorganisation: 'Feuerwehr',
            opta: null,
            fachaufgabe: null,
            organisation: null,
          }}
        />
        <span>Florian Celle 1-46-1</span>
      </div>
    </div>
  );
}

/** Die feste Liste der vorgestellten Bausteine (design.md D4), in Kartenreihenfolge. */
export const PREVIEWS: readonly PreviewSpec[] = [
  {
    name: 'Paneel',
    title: 'Paneel',
    group: 'Flächen',
    height: 420,
    source: 'components/instrument/Paneel.tsx',
    docAnchor: 'export const PANEEL_KOPF_HOEHE',
    content: () => (
      <Paneel titel="Einsatzabschnitte" ueberschrift="h3" meta="3 Abschnitte · 31 Einheiten">
        <PaneelZeile>EA 1 Brandbekämpfung</PaneelZeile>
        <PaneelZeile>EA 2 Wasserversorgung</PaneelZeile>
        <PaneelZeile>EA 3 Bereitstellung</PaneelZeile>
      </Paneel>
    ),
  },
  {
    name: 'Dashboard',
    title: 'Dashboard-Baukasten (Verteilung und Matrix)',
    group: 'Flächen',
    height: 976,
    source: 'components/instrument/DashboardPaneel.tsx',
    ruleHead: 'Dashboard-Baukasten',
    styles: ['components/instrument/matrixPaneel.css'],
    content: () => <DashboardBeispiel />,
  },
  {
    name: 'Datenraster',
    title: 'Datenraster mit DatenfeldEingabe und FeldFehler',
    group: 'Daten',
    height: 550,
    source: 'components/instrument/Datenraster.tsx',
    content: () => (
      <Form layout="vertical" initialValues={{ funkrufname: 'Florian Celle 1-46-1' }}>
        <Datenraster spalten={2} beschriftung="Einsatzdaten">
          <Datenfeld label="Einsatznummer" mono>
            2026-1019-0042
          </Datenfeld>
          <Datenfeld label="Stichwort">THL 2</Datenfeld>
          <Datenfeld label="Alarmiert" mono>
            19.10.2026 14:30
          </Datenfeld>
          <DatenfeldEingabe label="Funkrufname" name="funkrufname">
            <Input />
          </DatenfeldEingabe>
        </Datenraster>
        <div className="ds-feld">
          <label htmlFor="ds-ort">Einsatzort</label>
          <Input id="ds-ort" aria-invalid aria-describedby="ds-ort-fehler" />
          <FeldFehler id="ds-ort-fehler">Ort ist Pflicht</FeldFehler>
        </div>
      </Form>
    ),
  },
  {
    name: 'Status',
    title: 'StatusZelle, StatusChip und StatusTag',
    group: 'Status',
    height: 340,
    source: 'components/instrument/Status.tsx',
    content: () => (
      <div className="ds-stapel">
        <div className="ds-fugenraster" data-fugenraster="">
          <StatusZelle ton="normal" wert={12} wort="bereit" />
          <StatusZelle ton="bedien" wert={4} wort="unterwegs" />
          <StatusZelle ton="achtung" wert={3} wort="gebunden" />
          <StatusZelle ton="alarm" wert={1} wort="ausgefallen" />
          <StatusZelle ton="neutral" wert={0} wort="außer Dienst" />
        </div>
        <div className="ds-reihe">
          <StatusChip ton="normal" code="2" trenner wort="Einsatzbereit Wache" />
          <StatusChip ton="bedien" code="3" trenner wort="Einsatz übernommen" />
          <StatusChip ton="achtung" code="4" trenner wort="Am Einsatzort" />
        </div>
        <div className="ds-reihe">
          {Object.values(statusKategorie).map((darstellung) => (
            <StatusTag key={darstellung.label} darstellung={darstellung} />
          ))}
        </div>
      </div>
    ),
  },
  {
    name: 'Kennzahl',
    title: 'Kennzahl und Kennzahlenband',
    group: 'Daten',
    height: 490,
    source: 'components/instrument/Kennzahl.tsx',
    content: () => (
      <Kennzahlenband spalten={2} beschriftung="Lage in Zahlen">
        <Kennzahl titel="Betroffene" wert={42} notiz="davon 3 SK I" />
        <Kennzahl titel="Einheiten frei" wert={7} ton="normal" notiz="von 31 im Einsatz" />
        <Kennzahl titel="Aufträge überfällig" wert={2} ton="achtung" notiz="älteste 18 min" />
        <Kennzahl titel="Meldungen offen" wert={5} ton="alarm" notiz="Bestätigung überfällig" />
      </Kennzahlenband>
    ),
  },
  {
    name: 'Segmentleiste',
    title: 'Segmentleiste',
    group: 'Bedienung',
    height: 280,
    source: 'components/instrument/Segmentleiste.tsx',
    // Die zweite Leiste zeigt den Zeilenumbruch im Wortlaut (Ablösung im Handschuh-Betrieb).
    // `alignItems` hält beide Leisten so breit wie ihre Segmente, wie in der App.
    content: () => (
      <div className="ds-stapel" style={{ alignItems: 'flex-start' }}>
        <Segmentleiste<string>
          beschriftung="Meldungen filtern"
          wert="offen"
          onWechsel={nichts}
          optionen={[
            { wert: 'alle', label: 'Alle' },
            { wert: 'offen', label: 'Offen' },
            { wert: 'erledigt', label: 'Erledigt' },
            { wert: 'archiv', label: 'Archiv', gesperrt: 'Nur Einsatzleitung' },
          ]}
        />
        <Segmentleiste<string>
          beschriftung="Ansicht"
          wert="laufend"
          onWechsel={nichts}
          optionen={[
            { wert: 'laufend', label: 'Laufend' },
            { wert: 'ohne', label: 'Ohne\nSchicht' },
            { wert: 'vergangen', label: 'Vergangen' },
          ]}
        />
      </div>
    ),
  },
  {
    name: 'Sammelbanner',
    title: 'Sammelbanner',
    group: 'Rückmeldung',
    height: 200,
    source: 'components/instrument/Sammelbanner.tsx',
    content: () => (
      <Sammelbanner aktion={{ label: 'Anzeigen', onKlick: nichts }}>12 neue Meldungen</Sammelbanner>
    ),
  },
  {
    name: 'InlineAngabe',
    title: 'InlineAngabe (geschlossen, leer, offen)',
    group: 'Bedienung',
    height: 570,
    source: 'components/InlineAngabe.tsx',
    content: () => (
      <Datenraster spalten={1} beschriftung="Angaben">
        <Datenfeld label="Leitstellen-Nr." mono>
          <InlineAngabeBeispiel etikett="Leitstellen-Nr." wert="LST-26-08812" />
        </Datenfeld>
        <Datenfeld label="Bemerkung">
          <InlineAngabeBeispiel etikett="Bemerkung" wert="" />
        </Datenfeld>
        <Datenfeld label="Einsatzstichwort">
          <InlineAngabeBeispiel etikett="Einsatzstichwort" wert="THL 2" />
        </Datenfeld>
      </Datenraster>
    ),
    interact: async (container) => {
      const ausloeser = [...container.querySelectorAll('button')].filter(
        (knopf) => knopf.getAttribute('aria-label') === 'Einsatzstichwort bearbeiten',
      );
      if (ausloeser.length !== 2) {
        throw new Error('Design System: Auslöser „Einsatzstichwort bearbeiten“ nicht gefunden');
      }
      for (const knopf of ausloeser) await act(async () => knopf.click());
    },
  },
  {
    name: 'Verbindungen',
    title: 'Verbindungen (Funk und Telefon getrennt; Liste offen)',
    group: 'Bedienung',
    height: 895,
    source: 'components/VerbindungenFeld.tsx',
    moreDoc: 'components/FunkUndTelefon.tsx',
    content: () => (
      <div className="ds-stapel">
        <Datenraster spalten={1} beschriftung="Anzeige">
          <FunkUndTelefon
            rufname="Florian Celle 1-46-1"
            sprechgruppen={[
              {
                id: 1,
                bezeichnung: '412_F_DRK',
                betriebsart: 'TMO',
                aktiv: true,
                einsatz_lokal: false,
                einsatz_id: null,
                sortier: 1,
              },
            ]}
            verbindungen={BEISPIEL_VERBINDUNGEN}
          />
        </Datenraster>
        <Datenraster spalten={1} beschriftung="Bearbeiten">
          <Datenfeld label="Telefon und weitere Verbindungen" breit>
            <VerbindungenBeispiel />
          </Datenfeld>
        </Datenraster>
      </div>
    ),
    interact: async (container) => {
      const ausloeser = [...container.querySelectorAll('button')].filter(
        (knopf) =>
          knopf.getAttribute('aria-label') === 'Telefon und weitere Verbindungen bearbeiten',
      );
      if (ausloeser.length !== 2) {
        throw new Error(
          'Design System: Auslöser „Telefon und weitere Verbindungen bearbeiten“ fehlt',
        );
      }
      for (const knopf of ausloeser) await act(async () => knopf.click());
    },
  },
  {
    name: 'Sichtung',
    title: 'Sichtungsmarke (BBK)',
    group: 'Status',
    height: 240,
    source: 'components/SichtungsTag.tsx',
    docAnchor: 'export default function SichtungsTag',
    content: () => (
      <div className="ds-stapel">
        <div className="ds-reihe">
          {SICHTUNGEN.map((k) => (
            <SichtungsTag key={k} kategorie={k} />
          ))}
        </div>
        <div className="ds-reihe">
          {SICHTUNGEN.map((k) => (
            <SichtungsTag key={k} kategorie={k} form="kompakt" />
          ))}
          <SichtungsTag kategorie={null} form="kompakt" />
        </div>
      </div>
    ),
  },
  {
    name: 'BearbeitbaresPaneel',
    title: 'BearbeitbaresPaneel (offen und gesperrt)',
    group: 'Formular',
    height: 710,
    source: 'components/instrument/BearbeitbaresPaneel.tsx',
    content: () => <BearbeitbaresPaneelBeispiel />,
    interact: async (container) => {
      const ausloeser = [...container.querySelectorAll('button')].filter(
        (knopf) => knopf.getAttribute('aria-label') === 'Funk bearbeiten',
      );
      if (ausloeser.length !== 2) {
        throw new Error('Design System: Auslöser „Funk bearbeiten“ nicht gefunden');
      }
      for (const knopf of ausloeser) await act(async () => knopf.click());
      if (container.querySelectorAll('[data-lfh="paneel-sperrgrund"]').length !== 2) {
        throw new Error('Design System: „Telefon“ steht nicht gesperrt mit Grund');
      }
    },
  },
  {
    name: 'Speicherleiste',
    title: 'Speicherleiste',
    group: 'Formular',
    height: 360,
    source: 'components/speicherLeiste.ts',
    docAnchor: 'export function speicherLeisteStil',
    content: () => <SpeicherleisteBeispiel />,
  },
  {
    name: 'StammdatenFeld',
    title: 'StammdatenFeld (aus Stammdaten oder frei)',
    group: 'Formular',
    height: 420,
    source: 'components/StammdatenFeld.tsx',
    docAnchor: 'export default function StammdatenFeld',
    content: () => <StammdatenFeldBeispiel />,
  },
  {
    name: 'DokumentEntwurf',
    title: 'DokumentEntwurf (Bearbeiten und Lesefassung)',
    group: 'Formular',
    height: 1610,
    source: 'entwurf/DokumentEntwurf.tsx',
    docAnchor: 'export default function DokumentEntwurf',
    styles: [
      'entwurf/dokumentEntwurf.css',
      'components/MarkdownEditor.css',
      'components/Markdown.css',
    ],
    content: () => (
      <div className="ds-stapel">
        <DokumentEntwurfBeispiel />
        <DokumentEntwurfBeispiel />
      </div>
    ),
    // Die Ansicht ist innerer Zustand des Bausteins: die zweite Instanz je Thema in die Lesefassung.
    interact: async (container) => {
      const umschalter = [...container.querySelectorAll('[data-lfh="dokument-entwurf"]')]
        .filter((_, i) => i % 2 === 1)
        .map((entwurf) =>
          [...entwurf.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
            (tab) => tab.textContent === 'Lesefassung',
          ),
        );
      if (umschalter.length !== 2 || umschalter.some((tab) => !tab)) {
        throw new Error('Design System: Umschalter „Lesefassung“ nicht gefunden');
      }
      for (const tab of umschalter) await act(async () => tab!.click());
      const lesen = container.querySelectorAll('[data-lfh="entwurf-lesefassung"]:not([hidden])');
      const bearbeiten = container.querySelectorAll(
        '[data-lfh="entwurf-abschnitte"]:not([hidden])',
      );
      if (lesen.length !== 2 || bearbeiten.length !== 2) {
        throw new Error('Design System: DokumentEntwurf zeigt nicht je Thema beide Ansichten');
      }
      // Das mitwachsende Feld (`autoSize`) misst seine Höhe; jsdom hat kein Layout und setzt
      // `height: 0px`. Statt der Messung wächst das Feld im Browser mit dem Inhalt, wie in der App.
      for (const feld of container.querySelectorAll('textarea')) {
        feld.style.removeProperty('height');
        feld.style.setProperty('field-sizing', 'content');
      }
    },
  },
  {
    name: 'Gesperrt',
    title: 'Frei und gesperrt',
    group: 'Bedienung',
    height: 360,
    source: 'index.css',
    ruleHead: 'Gesperrt trägt die Sperre ohne Farbe',
    moreDoc: 'theme/gesperrtZeichen.guard.test.ts',
    content: () => (
      <div className="ds-stapel">
        <div className="ds-reihe">
          <Button type="primary">Speichern</Button>
          <Button type="primary" disabled>
            Speichern
          </Button>
          <Button>Drucken</Button>
          <Button disabled>Drucken</Button>
        </div>
        <div className="ds-reihe">
          <Input aria-label="Funkrufname (frei)" defaultValue="Florian Celle 1-46-1" />
          <Input aria-label="Funkrufname (gesperrt)" defaultValue="Florian Celle 1-46-1" disabled />
        </div>
        <div className="ds-reihe">
          <SegmentedBeispiel />
        </div>
      </div>
    ),
  },
  {
    name: 'DashboardListen',
    title: 'Dashboard-Baukasten (Abschnitte, Gliederung, Strom)',
    group: 'Flächen',
    height: 1305,
    source: 'components/instrument/ListenPaneel.tsx',
    docAnchor: 'export function ListenAbschnitt',
    moreDoc: 'components/instrument/StromPaneel.tsx',
    styles: ['components/instrument/gliederungsPaneel.css'],
    client: true,
    content: () => <DashboardListenBeispiel />,
  },
  {
    name: 'Tabelle',
    title: 'Tabellenkopf mit Sortieren und Filtern, Filterhinweis',
    group: 'Daten',
    height: 515,
    source: 'components/tabellenFilter.tsx',
    moreDoc: 'components/instrument/Filterhinweis.tsx',
    client: true,
    content: () => <TabelleBeispiel />,
  },
  {
    name: 'Zeitdarstellung',
    title: 'Zeitdarstellung (taktisch und Datum mit Uhrzeit)',
    group: 'Daten',
    height: 355,
    source: 'anzeige/zeitDarstellung.ts',
    ruleHead: 'Zeitdarstellung',
    content: () => <ZeitdarstellungBeispiel />,
  },
  {
    name: 'Zeiteingabe',
    title: 'Zeiteingabe (Wert mit Schnellwahl, leer, unlesbar)',
    group: 'Formular',
    height: 640,
    source: 'anzeige/ZeitpunktEingabe.tsx',
    styles: ['anzeige/ZeitpunktEingabe.css'],
    content: () => <ZeiteingabeBeispiel />,
    interact: tippeInZeitfelder,
  },
  {
    name: 'Ortsfeld',
    title: 'Ortsfeld (leer, verortet, nur Text; Kartenbild nur in der App)',
    group: 'Formular',
    height: 1140,
    source: 'anzeige/Ortsfeld.tsx',
    docAnchor: 'export function Ortsfeld',
    content: () => <OrtsfeldBeispiel />,
    interact: warteAufOrtVorschau,
  },
  {
    name: 'Eingaenge',
    title: 'Eingänge (Knopf im Kopf und Eingangsband)',
    group: 'Rückmeldung',
    height: 590,
    source: 'alarm/EingaengeKnopf.tsx',
    docAnchor: 'export default function EingaengeKnopf',
    moreDoc: 'alarm/Eingangsband.tsx',
    content: () => <EingaengeBeispiel />,
    interact: holeEingangsband,
  },
  {
    name: 'SichtungsWahl',
    title: 'SichtungsWahl (BBK-Flächen, ohne und mit Wahl)',
    group: 'Fach',
    height: 445,
    source: 'personen/SichtungsWahl.tsx',
    docAnchor: 'export interface SichtungsWahlProps',
    client: true,
    content: () => <SichtungsWahlBeispiel />,
  },
  {
    name: 'Koerperschema',
    title: 'Körperschema (Lesen)',
    group: 'Fach',
    height: 870,
    source: 'personen/koerperschema/Koerperschema.tsx',
    docAnchor: 'export interface KoerperschemaProps',
    client: true,
    content: () => <KoerperschemaBeispiel />,
  },
  {
    name: 'TaktischeZeichen',
    title: 'Taktische Zeichen (Einheit, Fahrzeug, Gefahr; Meldebildzeile)',
    group: 'Fach',
    height: 375,
    source: 'zeichen/EinsatzZeichen.tsx',
    moreDoc: 'zeichen/zeichenTheme.ts',
    content: () => <TaktischeZeichenBeispiel />,
  },
];

function ThemaAbschnitt({ dunkel, children }: { dunkel: boolean; children: ReactNode }) {
  return (
    <ConfigProvider
      locale={deDE}
      // Ohne Klassen-Hash: der trennt nur die Stile zweier Themes, die in antd 6 ohnehin über
      // CSS-Variablen laufen. Mit ihm stünde jedes Komponenten-CSS je Thema einmal in der Datei.
      // Fester Schlüssel der Variablenklasse je Thema, gleich in Server- und Client-Render.
      theme={{
        ...antdThema(dunkel, DICHTE),
        hashed: false,
        cssVar: { key: dunkel ? 'css-var-nacht' : 'css-var-tag' },
      }}
      button={antdKnopf(DICHTE)}
      collapse={antdKlappkopf(DICHTE)}
      checkbox={antdKaestchen(DICHTE)}
      radio={antdOptionsknopf(DICHTE)}
    >
      <section className="ds-thema" data-theme={dunkel ? 'dark' : 'light'}>
        <Augenbraue als="h2">{dunkel ? 'Nacht' : 'Tag'}</Augenbraue>
        <div className="ds-inhalt">{children}</div>
      </section>
    </ConfigProvider>
  );
}

function tree(spec: PreviewSpec, cache: ReturnType<typeof createCache>): ReactElement {
  return (
    <StyleProvider cache={cache} mock="server">
      <main className="ds-themen" aria-label={spec.title}>
        <ThemaAbschnitt dunkel>{spec.content()}</ThemaAbschnitt>
        <ThemaAbschnitt dunkel={false}>{spec.content()}</ThemaAbschnitt>
      </main>
    </StyleProvider>
  );
}

/** Markup und antd-CSS einer Vorschau. */
export async function renderPreview(spec: PreviewSpec): Promise<{ html: string; css: string }> {
  const cache = createCache();
  if (!spec.interact && !spec.client) {
    const html = renderToString(tree(spec, cache));
    return { html, css: extractStyle(cache, { plain: true }) };
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(tree(spec, cache)));
  await spec.interact?.(container);
  // Vor dem Aushängen: danach ist der Cache leer (Kopf dieser Datei).
  const result = { html: container.innerHTML, css: extractStyle(cache, { plain: true }) };
  await act(async () => root.unmount());
  container.remove();
  return result;
}

/** Stile des Rahmens um die Bausteine: nur Anordnung, Farben aus den Rollen der App. */
export const LAYOUT_CSS = [
  'html,body{margin:0;padding:0}',
  'body{background:var(--lfh-grund);color:var(--lfh-text);font-family:var(--lfh-schrift-text)}',
  '.ds-themen{display:flex;flex-direction:column}',
  '.ds-thema{background:var(--lfh-grund);color:var(--lfh-text);padding:16px;display:flex;flex-direction:column;gap:12px}',
  '.ds-thema h2{margin:0}',
  '.ds-inhalt{max-width:720px}',
  '.ds-stapel{display:flex;flex-direction:column;gap:12px}',
  '.ds-reihe{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
  // antds Eingabefeld ist 100 % breit; nebeneinander teilen sich zwei die Reihe.
  '.ds-reihe>.ant-input{flex:1 1 200px;width:auto}',
  '.ds-fugenraster{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;background:var(--lfh-linie);border:1px solid var(--lfh-linie)}',
  '.ds-feld{display:flex;flex-direction:column;gap:4px;margin-top:12px;max-width:320px;font-size:13px}',
].join('\n');
