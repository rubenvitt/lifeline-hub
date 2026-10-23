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
import { Button, ConfigProvider, Form, Input, Segmented } from 'antd';
import deDE from 'antd/locale/de_DE';
import {
  antdKaestchen,
  antdKlappkopf,
  antdKnopf,
  antdOptionsknopf,
  antdThema,
  type Dichte,
} from '../../src/theme/tokens';
import { rollenFarbe, statusKategorie, warnstufeBalkenFarbe } from '../../src/theme/statusFarben';
import type { Sichtungskategorie } from '../../src/api/types';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  Augenbraue,
  BearbeitbaresPaneel,
  DashboardFlaeche,
  Datenfeld,
  DatenfeldEingabe,
  Datenraster,
  FeldFehler,
  Kennzahl,
  Kennzahlenband,
  MatrixPaneel,
  Paneel,
  PaneelZeile,
  Sammelbanner,
  Segmentleiste,
  StatusChip,
  StatusZelle,
  VerteilungsPaneel,
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
    height: 190,
    source: 'components/instrument/Segmentleiste.tsx',
    content: () => (
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
  if (!spec.interact) {
    const html = renderToString(tree(spec, cache));
    return { html, css: extractStyle(cache, { plain: true }) };
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(tree(spec, cache)));
  await spec.interact(container);
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
