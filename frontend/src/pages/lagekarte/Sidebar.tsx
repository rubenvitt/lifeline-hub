import { Badge, Button, Card, Popconfirm, Radio, Slider, Space, Spin, Switch, theme, Tooltip, Typography, Upload } from 'antd';
import { Select } from '../../components/Select';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenFehler, SeitenLeer } from '../../components/SeitenZustand';
import { AimOutlined, DeleteOutlined, FullscreenOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus, KartenThemeWahl } from './basemapStil';
import type { OnlineStyle } from '../../api/karte';
import type { FreiesZeichenUpdate, ZoneTyp } from '../../api/types';
import type { ZeichenModus } from './zeichnen';
import { ZONE_TYPEN } from './zonenStil';
import FreiesZeichenPicker from './FreiesZeichenPicker';
import { FACHEBENEN, fachebeneKeys } from './fachebenen';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';
import type { Hintergrundbild } from '../../api/kartenbilder';
import type { KartenAnsicht } from '../../api/types';
import AnsichtSwitcher from './AnsichtSwitcher';
import AnsichtZuordnung from './AnsichtZuordnung';

export interface LayerSichtbar {
  einsatzort: boolean;
  uhs: boolean;
  schaden: boolean;
  einheit: boolean;
  fahrzeug: boolean;
  fuehrung: boolean;
  abschnitt: boolean;
  zone: boolean;
  lagemeldung: boolean;
  freies_zeichen: boolean;
}

/** Platzierbare Punkt-Typen (Fläche/Abschnitt läuft über onAbschnittZeichnenStart). */
export type PlatzierenPunktTyp = 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung';

const NICHT_VERORTET_LABEL: Record<NichtVerortet['typ'], string> = {
  uhs: 'UHS',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Personal', // LFH-276: beliebiges disponiertes Personal, nicht nur Führung
  abschnitt: 'Abschnitt',
};

/** Platzierungsziel → exclude-Tag (typ:id) für die Ort-Vorschau (Selbst-Ausschluss).
 *  Einsatzort-Marker trägt die echte einsatzId, nicht die Dummy-0 aus dem Platzierungs-Ziel. */
export function ortVorschauExclude(ziel: SidebarProps['platzierungZiel'], einsatzId: number): string | undefined {
  if (!ziel) return undefined;
  if (ziel.typ === 'einsatzort') return `einsatzort:${einsatzId}`; // Marker-id = echte Einsatz-ID, nicht 0
  // Sidebar-Typen → Backend-Marker-Typ-Tags. 'fuehrung' = Personal-Führung → 'personal'.
  const map: Record<string, string> = {
    uhs: 'uhs', schaden: 'schaden', einheit: 'einheit',
    fahrzeug: 'fahrzeug', fuehrung: 'personal',
  };
  const typ = map[ziel.typ];
  return typ ? `${typ}:${ziel.id}` : undefined;
}

/** Ein Fehler-Slot: was schiefging, woran es lag, und der Weg zurück. */
export interface SektionFehler {
  /** Aus Sicht der Einsatzkraft — kein Statuscode, kein Stacktrace. */
  text: string;
  /** Rohfehler der Query; das Primitiv filtert selbst auf `ApiError`. */
  ursache?: unknown;
  onWiederholen?: () => void;
}

/**
 * Fehler-Slots je Sidebar-Sektion (LFH-331 · B3).
 *
 * Gesetzt = die Sektion sagt, WARUM sie nichts zeigt, statt eine leere Liste zu zeigen.
 * Der Unterschied ist nicht kosmetisch: eine leere Objektliste liest sich als „nichts da",
 * und im Einsatz ist „nichts da" eine Lagebeurteilung.
 *
 * Bewusst KEIN Slot an der Karte „Verortet": sie trifft keine Vollständigkeitsaussage,
 * ihre beiden Zahlen zählen nur — und ein zweiter, gleich begründeter Fehlerkasten 100 px
 * unter dem ersten füllt die 300 px breite Leiste, ohne eine neue Tatsache zu melden. Die
 * namentliche Meldung steht am Seitenkopf.
 */
export interface SidebarSektionFehler {
  /** Die Lagebild-Quellen hinter „Nicht verortet" (und damit hinter „Alles verortet"). */
  nichtVerortet?: SektionFehler;
  /** Eigene Query: `useKartenbilder`. */
  bilder?: SektionFehler;
  /** Eigene Query: `useKartenAnsicht`. Scheitert sie, rendert der Switcher heute NICHTS. */
  ansichten?: SektionFehler;
}

export interface SidebarProps {
  einsatzId: number;
  nichtVerortet: NichtVerortet[];
  verortet: KarteMarker[];
  darfSchreiben: boolean;
  platzierungZiel: { typ: PlatzierenPunktTyp | 'einsatzort'; id: number } | null;
  onPlatzierenStart: (ziel: { typ: PlatzierenPunktTyp; id: number }) => void;
  onPlatzierenAbbrechen: () => void;
  onAbschnittZeichnenStart: (id: number) => void;
  onZoneZeichnenStart: (entwurf: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string }) => void;
  /** Freies taktisches Zeichen (LFH-170): aktive Platzierung + Start/Abbrechen. */
  zeichenPlatzieren: FreiesZeichenUpdate | null;
  onZeichenPlatzierenStart: (spec: FreiesZeichenUpdate) => void;
  onZeichenPlatzierenAbbrechen: () => void;
  onKoordinateEingeben: (lat: number, lon: number) => void;
  einsatzortVerortet: boolean;
  onEinsatzortPlatzieren: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  basemap: BasemapModus;
  onBasemapWechsel: (modus: BasemapModus) => void;
  onMarkerWaehlen: (schluessel: string) => void;
  onlineVerfuegbar: boolean;
  offlineVerfuegbar: boolean;
  onlineStyles: OnlineStyle[];
  onlineStilName: string | null;
  onOnlineStilWechsel: (name: string) => void;
  /** Karten-lokale Theme-Wahl (Offline-Basemap): 'auto' folgt dem App-Theme. */
  kartenTheme: KartenThemeWahl;
  onKartenThemeWechsel: (wahl: KartenThemeWahl) => void;
  /** „In dieser Ansicht speichern" (LFH-319/320): true, wenn der aktuelle Karten-Zustand von
   *  der gespeicherten Ansicht abweicht (Basemap/Ebenen/Fachebenen). */
  ansichtDirty: boolean;
  ansichtSpeichert: boolean;
  onAnsichtSpeichern: () => void;
  fachebenenSichtbar: import('./fachebenenAuswahl').FachebenenSichtbar;
  onFachebeneToggle: (key: import('../../api/fachebenen').FachebeneQuelle, an: boolean) => void;
  /** Status je Fachebene für Ausgrau-/Offline-Hinweis. */
  fachebenenStatus: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, import('../../api/fachebenen').FachebeneStatus>>;
  /** KRITIS ist aktiv, aber die Karte ist zu weit herausgezoomt für eine Abfrage. */
  kritisZoomZuKlein?: boolean;
  /** Lade-Zustand je Fachebene (z. B. KRITIS/Overpass lädt länger → Spinner). */
  fachebenenLaedt?: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, boolean>>;
  /** Bild-Hintergründe */
  bilder: Hintergrundbild[];
  onBildUpload: (datei: File) => void;
  onBildToggle: (id: number, sichtbar: boolean) => void;
  onBildOpazitaet: (id: number, opazitaet: number) => void;
  onBildPlatzieren: (id: number) => void;
  onBildPlatzierenFertig: () => void;
  onBildLoeschen: (id: number) => void;
  /** Bild auf eine andere Ansicht verschieben bzw. auf alle (`null`) — B/LFH-320. */
  onBildVerschieben: (id: number, ansichtId: number | null) => void;
  onBildZentrieren: (id: number) => void;
  onBildUmbenennen: (id: number, name: string) => void;
  /** Mittelpunkt des gerade platzierten Bilds numerisch setzen. */
  onBildMittelpunkt: (lat: number, lon: number) => void;
  bildPlatzierenId: number | null;
  /** Aktueller Mittelpunkt des Platzier-Bilds (für die numerische Eingabe). */
  bildPlatzierZentrum: LatLon | null;
  /** Ansichts-Switcher (B/LFH-320). */
  ansichten: KartenAnsicht[];
  aktiveAnsichtId?: number;
  onAnsichtWaehlen: (id: number) => void;
  onAnsichtNeu: (name: string) => void;
  onAnsichtUmbenennen: (id: number, name: string) => void;
  onAnsichtStandard: (id: number) => void;
  onAnsichtLoeschen: (id: number, objekte: 'freigeben' | 'loeschen') => void;
  ansichtBusy: boolean;
  /** Fehler-Slots je Sektion (LFH-331 · B3) — siehe `SidebarSektionFehler`. */
  sektionFehler?: SidebarSektionFehler;
}

/** Ein Fehler-Slot als Markup — oder nichts. Hält die drei Aufrufstellen unten einzeilig. */
function FehlerSlot({ fehler }: { fehler?: SektionFehler }) {
  if (!fehler) return null;
  return <SeitenFehler text={fehler.text} ursache={fehler.ursache} onWiederholen={fehler.onWiederholen} />;
}

export default function Sidebar(props: SidebarProps) {
  const { nichtVerortet, verortet, darfSchreiben, platzierungZiel } = props;
  const sektionFehler = props.sektionFehler ?? {};
  /** Eine Zählung, die im Fehlerfall keine Null behauptet. */
  const zaehler = (n: number) => (sektionFehler.nichtVerortet ? '—' : n);
  // Darstellungsfarben/-abstände kommen aus den Rollen-Tokens (LFH-328/T14) — dark-safe und
  // dichteabhängig. Persistierte Farbwerte (Zone `farbe`) sind davon ausgenommen, siehe unten.
  const { token } = theme.useToken();
  const [koord, setKoord] = useState<LatLon | null>(null);
  // Freies-Zeichen-Schnellerfassung (LFH-170): Picker erst auf Klick sichtbar (kein Dauer-
  // Combobox in der Sidebar), Entwurf bleibt über Platzierungen erhalten.
  const [zeichenPickerOffen, setZeichenPickerOffen] = useState(false);
  const [zeichenEntwurf, setZeichenEntwurf] = useState<FreiesZeichenUpdate>({ grundzeichen: 'taktische-formation' });
  // Entwurfswert der numerischen Mittelpunkt-Eingabe im Bild-Platzier-Modus.
  const [bildMitte, setBildMitte] = useState<LatLon | null>(null);
  // Entwurf verwerfen, sobald ein anderes Bild platziert wird oder der Modus endet.
  useEffect(() => setBildMitte(null), [props.bildPlatzierenId]);
  const uhsVerortet = verortet.filter((m) => m.typ === 'uhs');
  const schadenVerortet = verortet.filter((m) => m.typ === 'schaden');

  // Zum kleinen `size`-Prop in dieser Datei (LFH-328/A1 Festlegung 4): auf allen
  // interaktiven Elementen — Button, Switch, Select, Radio.Group — ist es ENTFERNT; deren
  // Höhe kommt jetzt aus der Zeilenhöhe der Dichte-Staffel am `ConfigProvider`. Stehen
  // bleiben ausschliesslich Container-Fälle, und zwar aus zwei getrennten Gründen:
  //
  //   * Die elf `Card` und der eine `Spin` ändern nur die Polsterung bzw. die Grösse einer
  //     Anzeige — sie verkleinern keine Treffläche. Die Leiste ist 300 px breit und
  //     scrollt; elf Karten auf Normalpolsterung zu heben wäre eine REINE Sichtänderung an
  //     der meistgenutzten Fläche der Anwendung, die jsdom nicht nachrechnen kann
  //     (Layout-Regressionen sind hier nur per e2e sichtbar).
  //   * Die drei `Liste` tragen gar kein antd-Prop: `components/Liste.tsx` bildet `size`
  //     auf die Abstands-Token ab und zieht bei der Dichte-Umschaltung (B5) mit. Es zu
  //     entfernen würde die Staffel nicht bedienen, sondern verlassen.
  //
  // Die Prop-Schreibweise steht hier bewusst NICHT ausgeschrieben: Gate 4 zählt ihr Literal
  // repo-weit, und ein erklärender Kommentar darf das Gate, das er erklärt, nicht füllen.
  return (
    <div style={{ width: 300, padding: 12, overflowY: 'auto', height: '100%' }}>
      {sektionFehler.ansichten ? (
        <div style={{ marginBottom: 12 }}>
          <FehlerSlot fehler={sektionFehler.ansichten} />
        </div>
      ) : (
      <AnsichtSwitcher
        ansichten={props.ansichten}
        aktiveAnsichtId={props.aktiveAnsichtId}
        darfSchreiben={darfSchreiben}
        busy={props.ansichtBusy}
        onWaehlen={props.onAnsichtWaehlen}
        onNeu={props.onAnsichtNeu}
        onUmbenennen={props.onAnsichtUmbenennen}
        onStandard={props.onAnsichtStandard}
        onLoeschen={props.onAnsichtLoeschen}
      />
      )}
      <Card
        size="small"
        title={
          <Space>
            <Typography.Text strong>⚠ Nicht verortet</Typography.Text>
            {/* Zweiter Kanal ist die Zahl selbst (WCAG 1.4.1) — die Farbe trägt hier nur „Achtung". */}
            <Badge count={nichtVerortet.length} showZero color={token.colorWarning} />
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        {/* Der Fehlerzweig steht VOR der Leer-/Listen-Weiche (LFH-331 · B3): „Alles verortet"
            ist eine Erfolgsaussage und darf nicht fallen, solange unklar ist, ob überhaupt
            etwas geladen wurde.

            Die Zeile darunter trägt jetzt dasselbe Primitiv wie die übrigen Leerzustände —
            aber OHNE Aktion und ohne Hinweis „lege etwas an". Sie ist kein Leerzustand,
            sondern ein Erfolgszustand: hier fehlt nichts, hier ist alles erledigt. */}
        {sektionFehler.nichtVerortet ? (
          <FehlerSlot fehler={sektionFehler.nichtVerortet} />
        ) : nichtVerortet.length === 0 ? (
          <SeitenLeer titel="Alles verortet" />
        ) : (
          <Liste
            size="small"
            dataSource={nichtVerortet}
            rowKey={(o) => `${o.typ}-${o.id}`}
            renderItem={(o) => {
              const aktiv = platzierungZiel?.typ === o.typ && platzierungZiel?.id === o.id;
              let action: React.ReactNode = null;
              if (darfSchreiben) {
                if (o.typ === 'abschnitt') {
                  action = (
                    <Button type="primary" onClick={() => props.onAbschnittZeichnenStart(o.id)}>
                      Fläche zeichnen
                    </Button>
                  );
                } else if (aktiv) {
                  action = (
                    <Button onClick={props.onPlatzierenAbbrechen}>
                      Abbrechen
                    </Button>
                  );
                } else {
                  // o.typ ist hier auf die Punkt-Typen verengt (abschnitt oben behandelt).
                  const punktTyp = o.typ;
                  action = (
                    <Button
                      type="primary"
                      onClick={() => props.onPlatzierenStart({ typ: punktTyp, id: o.id })}
                    >
                      Platzieren
                    </Button>
                  );
                }
              }
              return (
                <ListenEintrag actions={action ? [action] : []}>
                  <Typography.Text>
                    {NICHT_VERORTET_LABEL[o.typ]}: {o.label}
                  </Typography.Text>
                </ListenEintrag>
              );
            }}
          />
        )}
      </Card>

      {platzierungZiel && darfSchreiben && (
        <Card size="small" style={{ marginBottom: 12, borderColor: token.colorPrimary }}>
          <Typography.Text type="secondary">
            Klick auf die Karte setzt die Koordinate. (Abbrechen beendet.)
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            <KoordinatenEingabe
              value={koord}
              onChange={setKoord}
              einsatzId={props.einsatzId}
              exclude={ortVorschauExclude(props.platzierungZiel, props.einsatzId)}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <Button
              disabled={!koord}
              onClick={() => {
                if (koord) {
                  props.onKoordinateEingeben(koord.lat, koord.lon);
                  setKoord(null);
                }
              }}
            >
              Übernehmen
            </Button>
          </div>
        </Card>
      )}

      <Card size="small" title="Einsatzort" style={{ marginBottom: 12 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type={props.einsatzortVerortet ? undefined : 'warning'}>
            {props.einsatzortVerortet ? 'verortet' : 'nicht verortet'}
          </Typography.Text>
          {darfSchreiben &&
            (platzierungZiel?.typ === 'einsatzort' ? (
              <Button onClick={props.onPlatzierenAbbrechen}>
                Abbrechen
              </Button>
            ) : (
              <Button
                type={props.einsatzortVerortet ? 'default' : 'primary'}
                onClick={props.onEinsatzortPlatzieren}
              >
                {props.einsatzortVerortet ? 'Verschieben' : 'Platzieren'}
              </Button>
            ))}
        </Space>
      </Card>

      <Card size="small" title="Verortet" style={{ marginBottom: 12 }}>
        {/* Die Karte trägt keinen eigenen Fehlerkasten (Begründung an `SidebarSektionFehler`),
            aber ihre Zahlen dürfen nicht lügen: „UHS (0)" ist eine Aussage über die Lage, und
            im Fehlerfall hat sie niemand geprüft. Der Gedankenstrich ist die ehrliche Form.
            Ein Template-Literal statt {…}-Interpolation, damit der Text EIN Knoten bleibt. */}
        <Typography.Text type="secondary">{`UHS (${zaehler(uhsVerortet.length)})`}</Typography.Text>
        <Liste
          size="small"
          dataSource={uhsVerortet}
          rowKey={(m) => m.schluessel}
          renderItem={(m) => (
            <ListenEintrag style={{ cursor: 'pointer' }} onClick={() => props.onMarkerWaehlen(m.schluessel)}>
              {m.label}
            </ListenEintrag>
          )}
        />
        <Typography.Text type="secondary">{`Schäden (${zaehler(schadenVerortet.length)})`}</Typography.Text>
        <Liste
          size="small"
          dataSource={schadenVerortet}
          rowKey={(m) => m.schluessel}
          renderItem={(m) => (
            <ListenEintrag style={{ cursor: 'pointer' }} onClick={() => props.onMarkerWaehlen(m.schluessel)}>
              {m.label}
            </ListenEintrag>
          )}
        />
      </Card>

      {darfSchreiben && props.ansichtDirty && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Karten-Konfiguration weicht von der gespeicherten Ansicht ab.
            </Typography.Text>
            {/* Seit LFH-320 schreibt der Button in die AKTIVE Ansicht, nicht in eine
                einsatzweite Einstellung — die alte Beschriftung „Für den Einsatz speichern"
                legte genau das Gegenteil nahe (LFH-325). */}
            <Button type="primary" block loading={props.ansichtSpeichert} onClick={props.onAnsichtSpeichern}>
              In dieser Ansicht speichern
            </Button>
          </Space>
        </Card>
      )}

      <Card size="small" title="Ebenen" style={{ marginBottom: 12 }}>
        <Space orientation="vertical">
          <Space>
            <Switch checked={props.layer.einsatzort} onChange={(v) => props.onLayerToggle('einsatzort', v)} />
            Einsatzort
          </Space>
          <Space>
            <Switch checked={props.layer.uhs} onChange={(v) => props.onLayerToggle('uhs', v)} /> UHS
          </Space>
          <Space>
            <Switch checked={props.layer.schaden} onChange={(v) => props.onLayerToggle('schaden', v)} /> Schäden
          </Space>
          <Space>
            <Switch checked={props.layer.einheit} onChange={(v) => props.onLayerToggle('einheit', v)} /> Einheiten
          </Space>
          <Space>
            <Switch checked={props.layer.fahrzeug} onChange={(v) => props.onLayerToggle('fahrzeug', v)} /> Fahrzeuge
          </Space>
          <Space>
            <Switch checked={props.layer.fuehrung} onChange={(v) => props.onLayerToggle('fuehrung', v)} /> Personal
          </Space>
          <Space>
            <Switch checked={props.layer.abschnitt} onChange={(v) => props.onLayerToggle('abschnitt', v)} /> Abschnitte
          </Space>
          <Space>
            <Switch checked={props.layer.zone} onChange={(v) => props.onLayerToggle('zone', v)} /> Zonen
          </Space>
          <Space>
            <Switch checked={props.layer.lagemeldung} onChange={(v) => props.onLayerToggle('lagemeldung', v)} /> Lagemeldungen
          </Space>
          <Space>
            <Switch checked={props.layer.freies_zeichen} onChange={(v) => props.onLayerToggle('freies_zeichen', v)} /> Taktische Zeichen
          </Space>
        </Space>
      </Card>

      <Card size="small" title="Fachebenen (extern)" style={{ marginBottom: 12 }}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          {fachebeneKeys().map((key) => {
            const def = FACHEBENEN[key];
            const status = props.fachebenenStatus[key];
            const sichtbar = props.fachebenenSichtbar[key];
            const offline = status === 'offline';
            const laedt = sichtbar && props.fachebenenLaedt?.[key];
            const zoomHinweis = sichtbar && key === 'kritis' && props.kritisZoomZuKlein;
            return (
              <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space>
                  <Switch
                    checked={sichtbar}
                    onChange={(v) => props.onFachebeneToggle(key, v)}
                  />
                  <span style={{ color: def.farbe }}>●</span> {def.label}
                </Space>
                {laedt ? (
                  <Spin size="small" />
                ) : zoomHinweis ? (
                  <Tooltip title="KRITIS-Objekte werden erst ab einer näheren Zoomstufe geladen">
                    <Typography.Text type="warning" style={{ fontSize: 11 }}>näher heranzoomen</Typography.Text>
                  </Tooltip>
                ) : (
                  <>
                    {sichtbar && offline && (
                      <Tooltip title="Quelle offline — Ebene wird leer angezeigt">
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>offline</Typography.Text>
                      </Tooltip>
                    )}
                    {sichtbar && status === 'leer' && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>keine Daten</Typography.Text>
                    )}
                  </>
                )}
              </Space>
            );
          })}
        </Space>
      </Card>

      <Card size="small" title="Bild-Hintergründe" style={{ marginBottom: 12 }}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          {/* Nur die LESE-Liste wird ersetzt; der Upload darunter hängt an einer eigenen
              Route und bleibt bedienbar. */}
          <FehlerSlot fehler={sektionFehler.bilder} />
          {!sektionFehler.bilder && props.bilder.map((b) => {
            const imPlatzieren = props.bildPlatzierenId === b.id;
            return (
              <div key={b.id} style={{ borderBottom: `1px solid ${token.colorSplit}`, paddingBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Switch
                    checked={b.sichtbar}
                    aria-label={b.name}
                    onChange={(v) => props.onBildToggle(b.id, v)}
                    style={{ flexShrink: 0 }}
                  />
                  <Typography.Text
                    ellipsis={{ tooltip: b.name }}
                    editable={darfSchreiben ? {
                      tooltip: 'Umbenennen',
                      onChange: (val) => {
                        const t = val.trim();
                        if (t && t !== b.name) props.onBildUmbenennen(b.id, t);
                      },
                    } : false}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    {b.name}
                  </Typography.Text>
                  <Space size={4} style={{ flexShrink: 0 }}>
                    <Tooltip title="Auf Bild zentrieren">
                      <Button
                        icon={<FullscreenOutlined />}
                        onClick={() => props.onBildZentrieren(b.id)}
                        aria-label={`${b.name} zentrieren`}
                      />
                    </Tooltip>
                    {darfSchreiben && (
                      <>
                        <Tooltip title={imPlatzieren ? 'Platzieren beenden' : 'Auf der Karte platzieren'}>
                          <Button
                            type={imPlatzieren ? 'primary' : 'default'}
                            icon={<AimOutlined />}
                            onClick={() => (imPlatzieren ? props.onBildPlatzierenFertig() : props.onBildPlatzieren(b.id))}
                            aria-label={`${b.name} platzieren`}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="Bild entfernen?"
                          onConfirm={() => props.onBildLoeschen(b.id)}
                          okText="Entfernen"
                          cancelText="Abbrechen"
                        >
                          <Button danger icon={<DeleteOutlined />} aria-label={`${b.name} löschen`} />
                        </Popconfirm>
                      </>
                    )}
                  </Space>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={b.opazitaet}
                  disabled={!darfSchreiben}
                  onChange={(v) => props.onBildOpazitaet(b.id, v as number)}
                  tooltip={{ formatter: (v) => `${v}%` }}
                />
                <AnsichtZuordnung
                  ansichten={props.ansichten}
                  wert={b.ansicht_id}
                  disabled={!darfSchreiben}
                  onChange={(ansichtId) => props.onBildVerschieben(b.id, ansichtId)}
                />
                {/* Hinterlegung war `rgba(22,119,255,.06)` — derselbe Blauton wie die
                    Bedien-Rolle, nur in rgba-Schreibweise und damit für jedes Hex-Grep
                    unsichtbar. Jetzt die Rolle „aktiver Bedienbereich". */}
                {imPlatzieren && darfSchreiben && (
                  <div
                    style={{
                      padding: token.paddingXS,
                      background: token.colorPrimaryBg,
                      borderRadius: token.borderRadiusSM,
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Auf der Karte: Ecken = Größe (Seitenverhältnis), Kanten = frei strecken, ↻ = drehen, Mitte = verschieben. Oder Mittelpunkt numerisch:
                    </Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <KoordinatenEingabe
                        value={bildMitte ?? props.bildPlatzierZentrum}
                        onChange={setBildMitte}
                        einsatzId={props.einsatzId}
                      />
                    </div>
                    <Space style={{ marginTop: 6, width: '100%', justifyContent: 'space-between' }}>
                      <Button
                        disabled={!bildMitte}
                        onClick={() => {
                          if (bildMitte) {
                            props.onBildMittelpunkt(bildMitte.lat, bildMitte.lon);
                            setBildMitte(null);
                          }
                        }}
                      >
                        Mittelpunkt setzen
                      </Button>
                      <Button type="primary" onClick={props.onBildPlatzierenFertig}>
                        Fertig
                      </Button>
                    </Space>
                  </div>
                )}
              </div>
            );
          })}
          {darfSchreiben && (
            <Upload
              accept="image/png,image/jpeg"
              showUploadList={false}
              beforeUpload={(datei) => {
                props.onBildUpload(datei as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>Bild hochladen</Button>
            </Upload>
          )}
        </Space>
      </Card>

      {darfSchreiben && (
        <Card size="small" title="Zone zeichnen" style={{ marginBottom: 12 }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            {ZONE_TYPEN.map((t) => {
              if (t.geometrie === 'beides') {
                return (
                  <Space key={t.typ}>
                    <Typography.Text>{t.label}</Typography.Text>
                    {/* `farbe` ist ein PERSISTIERTER Datenwert: er wandert über
                        `onZoneZeichnenStart` in die Zone und damit in die Datenbank. Er darf
                        deshalb NICHT auf ein Laufzeit-Token zeigen — ein Themenwechsel würde
                        sonst bereits gespeicherte Zonen nachträglich uminterpretieren. Das
                        Literal bleibt bewusst stehen (LFH-328/T14). */}
                    <Button
                      onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus: 'polygon', farbe: '#1677ff' })}
                    >
                      Fläche
                    </Button>
                    <Button
                      onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus: 'linie', farbe: '#1677ff' })}
                    >
                      Linie
                    </Button>
                  </Space>
                );
              }
              const modus: ZeichenModus = t.geometrie === 'LineString' ? 'linie' : 'polygon';
              return (
                <Button
                  key={t.typ}
                  block
                  onClick={() => props.onZoneZeichnenStart({ typ: t.typ, modus })}
                >
                  {t.label} zeichnen
                </Button>
              );
            })}
          </Space>
        </Card>
      )}

      {darfSchreiben && (
        <Card size="small" title="Taktisches Zeichen" style={{ marginBottom: 12 }}>
          {props.zeichenPlatzieren ? (
            <Space orientation="vertical" style={{ width: '100%' }}>
              <Typography.Text type="secondary">Auf Karte klicken zum Platzieren.</Typography.Text>
              <Button onClick={props.onZeichenPlatzierenAbbrechen}>
                Abbrechen
              </Button>
            </Space>
          ) : zeichenPickerOffen ? (
            <Space orientation="vertical" style={{ width: '100%' }}>
              <FreiesZeichenPicker wert={zeichenEntwurf} onChange={setZeichenEntwurf} />
              <Space>
                <Button
                  type="primary"
                  onClick={() => {
                    props.onZeichenPlatzierenStart(zeichenEntwurf);
                    setZeichenPickerOffen(false);
                  }}
                >
                  Platzieren
                </Button>
                <Button onClick={() => setZeichenPickerOffen(false)}>
                  Abbrechen
                </Button>
              </Space>
            </Space>
          ) : (
            <Button block onClick={() => setZeichenPickerOffen(true)}>
              Taktisches Zeichen platzieren
            </Button>
          )}
        </Card>
      )}

      <Card size="small" title="Basemap">
        <Radio.Group
          value={props.basemap}
          onChange={(e) => props.onBasemapWechsel(e.target.value as BasemapModus)}
          optionType="button"
          name="lagekarte-basemap"
        >
          <Tooltip title={props.onlineVerfuegbar ? '' : 'nicht konfiguriert'}>
            <Radio.Button value="online" disabled={!props.onlineVerfuegbar}>
              Online
            </Radio.Button>
          </Tooltip>
          <Tooltip title={props.offlineVerfuegbar ? '' : 'nicht konfiguriert'}>
            <Radio.Button value="offline" disabled={!props.offlineVerfuegbar}>
              Offline
            </Radio.Button>
          </Tooltip>
          <Radio.Button value="blind">Blind</Radio.Button>
        </Radio.Group>
        {props.basemap === 'online' && props.onlineStyles.length > 1 && (
          <Select
            aria-label="Online-Ansicht"
            style={{ width: '100%', marginTop: 8 }}
            value={props.onlineStilName ?? props.onlineStyles[0]?.name}
            onChange={(name) => props.onOnlineStilWechsel(name)}
            options={props.onlineStyles.map((s) => ({ label: s.name, value: s.name }))}
          />
        )}
        {props.basemap === 'offline' && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              Karten-Design
            </Typography.Text>
            <Radio.Group
              value={props.kartenTheme}
              onChange={(e) => props.onKartenThemeWechsel(e.target.value as KartenThemeWahl)}
              optionType="button"
              aria-label="Karten-Design"
              name="lagekarte-karten-design"
            >
              <Tooltip title="folgt dem App-Design">
                <Radio.Button value="auto">Auto</Radio.Button>
              </Tooltip>
              <Radio.Button value="light">Hell</Radio.Button>
              <Radio.Button value="dark">Dunkel</Radio.Button>
            </Radio.Group>
          </div>
        )}
        {props.basemap === 'blind' && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            Keine Basemap konfiguriert — Marker und Verorten funktionieren weiterhin.
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  );
}
