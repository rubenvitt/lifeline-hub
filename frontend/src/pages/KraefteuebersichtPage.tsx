import { IconPlus, IconTrichter } from '../icons';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { App as AntApp, Button, Input, Segmented, Space, Tag, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { formatUhrzeitMitTag, taktischeDtgVoll } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams } from 'react-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auftraegePfad, einheitenPfad, lageberichtDetailPfad } from '../routing/deeplinks';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheiten, setzeEinheitStatus } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeAuftraege } from '../api/auftraege';
import { holeRueckmeldungen } from '../api/meldungen';
import {
  MELDEWEG_WORT,
  RUECKMELDUNG_ROLLE,
  RUECKMELDUNG_WORT,
  rueckmeldungJeEinheit,
} from '../meldungen/rueckmeldung';
import { ApiError } from '../api/client';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { listeEinheitenPerioden } from '../api/kraefteZeitachse';
import { ankerText, dauerText, kraftDauern, type LaufendeDauer } from '../kraefte/zeitachse';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import { staerkeText } from '../anzeige/staerke';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  verdichte,
  type FilterWerte,
  type Rohdaten,
} from '../kraefte/kraeftebild';
import {
  aufklappbareSchluessel,
  baueMeldebildRaster,
  einheitBand,
  istProblemZeile,
  istRueckmeldungProblem,
  keineRueckmeldungZelle,
  personalBand,
  rueckmeldungDerZeile,
  type RasterZeile,
  type RueckmeldungAnzeige,
} from '../kraefte/meldebildRaster';
import { fmsStatusOptionen } from '../kraefte/fmsTableauKern';
import Statusband from '../kraefte/Statusband';
import EinheitZeichen from '../kraefte/EinheitZeichen';
import { KATEGORIE_WERTE } from '../kraefte/statusAchse';
import { legeLageberichtAn } from '../api/lageberichte';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import type { FahrzeugStatus, StatusKategorie } from '../api/types';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { statusKategorie } from '../theme/statusFarben';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { StatusChip, StatusZelle, monoStil, useRollen } from '../components/instrument';
import './kraefteuebersichtPrint.css';

/**
 * Meldebild: Statusraster über alle Einheiten.
 *
 * Aufbau: Seitenkopf (Titel · Mono-Meta · Abschnitt-Filter · „Einheit") → Statusband (Einheiten je
 * FMS-Status, Personal je Kategorie, Kachel „keine Rückmeldung") → Werkzeugzeile außerhalb des
 * Primitivs (Auswahlzeile, weitere Filter, Aufklappen, Lagebericht, Druck) → Raster: eine Zeile je
 * Einheit, die Mittel als aufklappbares Detail. Die Ableitungen stehen rein in
 * `kraefte/meldebildRaster.ts`.
 *
 * Einheitenstatus (LFH-609): serverseitig aus den Fahrzeugen abgeleitet — gemeinsam oder „gemischt"
 * mit Verteilung —, eine Einheit ohne Fahrzeug führt ihn von Hand (Auslöser nur dort). Das
 * Statusband zählt die Einheiten je Status; die Verteilung der Mittel (bereit / gebunden / Ausfall)
 * steht als eigene Spalte „Mittel".
 *
 * Der Funkrufname der Einheit ist ihr gepflegter eigener (LFH-614); fehlt er, steht nur der eines
 * einzigen Fahrzeugs, sonst bleibt die Zelle leer.
 *
 * Rückmeldung (LFH-610): die letzte Spalte zeigt die Uhrzeit der letzten Rückmeldung (neutral),
 * überfällig in `achtung`, nie zurückgemeldet „—" in `alarm`; beide Problemfälle tönen die Zeile.
 * Die Kachel „keine Rückmeldung" zählt nur die nie zurückgemeldeten Einheiten. Solange die Daten
 * laden, gescheitert oder gesperrt (403) sind, steht nirgends „keine" — eine leere Menge färbte
 * sonst alles rot.
 */

/**
 * Der leere Filterzustand — eine Quelle für Startwert, Zurücksetzen und das Zurücknehmen einer
 * einzelnen Marke.
 */
export const LEERER_FILTER: FilterWerte = {
  abschnittId: null,
  traeger: null,
  kategorie: null,
  suche: '',
};

export interface FilterChip {
  schluessel: keyof FilterWerte;
  label: string;
}

/**
 * Die gesetzten Filter als Beschriftungen, in fester Reihenfolge (Abschnitt · Träger · Status ·
 * Suche); `suche` getrimmt wie in `filtereKraefte`.
 */
export function aktiveFilterChips(
  filter: FilterWerte,
  abschnittName: (id: number) => string,
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.abschnittId != null) {
    chips.push({
      schluessel: 'abschnittId',
      label: `Abschnitt: ${abschnittName(filter.abschnittId)}`,
    });
  }
  if (filter.traeger) chips.push({ schluessel: 'traeger', label: `Träger: ${filter.traeger}` });
  if (filter.kategorie) {
    const wert = KATEGORIE_WERTE.find((w) => w.value === filter.kategorie);
    chips.push({ schluessel: 'kategorie', label: `Status: ${wert?.text ?? filter.kategorie}` });
  }
  if (filter.suche.trim())
    chips.push({ schluessel: 'suche', label: `Suche: „${filter.suche.trim()}"` });
  return chips;
}

/**
 * Der Seitenkopf-Meta — Einheitenzahl und Stärke in BOS-Schreibweise (`F/UF/M//Ges`).
 *
 * Bei gesetztem Filter nennt die Zeile den Ausschnitt und den Bezugswert („3 von 7 Einheiten ·
 * Stärke 1/0/5//6 von 2/3/10//15"); sonst verschwände die Gesamtstärke genau dann, wenn jemand
 * einen Abschnitt anwählt. Rein und exportiert, damit beide Zweige ohne Rendern prüfbar sind.
 */
export function meldebildMeta(args: {
  einheiten: number;
  einheitenGesamt: number;
  staerke: string;
  staerkeGesamt: string;
  gefiltert: boolean;
}): string {
  const wort = args.einheitenGesamt === 1 ? 'Einheit' : 'Einheiten';
  if (!args.gefiltert) return `${args.einheitenGesamt} ${wort} · Stärke ${args.staerkeGesamt}`;
  return (
    `${args.einheiten} von ${args.einheitenGesamt} ${wort} · ` +
    `Stärke ${args.staerke} von ${args.staerkeGesamt}`
  );
}

/**
 * Der FMS-Katalog als Menüwerte für den Handstatus. Beschriftung wie am Chip
 * („S2 · Frei auf Wache"), Ton aus der Kategorie, Mandantenfarbe als Punkt.
 */
export function handStatusOptionen(katalog: readonly FahrzeugStatus[]): StatusOption<number>[] {
  return [
    // Dieselbe Beschriftung wie im FMS-Tableau — eine Quelle für beide Menüs.
    ...fmsStatusOptionen(katalog),
    // Der Handstatus muss sich auch entfernen lassen — sonst bliebe ein einmal gesetzter Wert
    // stehen und tauchte nach jeder Fahrzeugabgabe wieder auf.
    { wert: KEIN_HANDSTATUS, label: 'kein Status' },
  ];
}

/** Menüwert für „Handstatus löschen" — eine Katalog-ID ist nie negativ. */
export const KEIN_HANDSTATUS = -1;

/** Kurzwort der Mittelart — Satz, kein Piktogramm (Regel „Ein Emoji ist kein Icon"). */
const MITTEL_KURZ = { fahrzeug: 'Fzg.', person: 'Pers.', material: 'Mtl.' } as const;

/**
 * Die Spalten des Rasters. Eine Fabrik, weil zwei Zellen vom Kontext abhängen (Einsatz-ID für den
 * Auftrags-Deeplink, Abrufzustand der Aufträge). Durch `spaltenFuer<RasterZeile>()` geführt, nicht
 * annotiert.
 *
 * Keine Sortierung, kein Spaltenfilter, keine Suche im Primitiv (`VOLLMENGE_PFLICHT`): gefiltert
 * wird außerhalb über die Rohlisten, aus denen Zeilen und Verteilungen neu entstehen.
 */
/** Was die Rückmeldungsspalte braucht: Abrufzustand und die Anzeige je Zeilenschlüssel. */
interface RueckmeldungSpalte {
  zustand: AbrufZustand;
  jeZeile: ReadonlyMap<string, RueckmeldungAnzeige>;
}

/** Was die Statusspalte außer der Zeile braucht: Zeitformat und den Handstatus-Weg. */
interface StatusKontext {
  zeit: (utc: string) => string;
  handStatus: ((z: RasterZeile) => React.ReactNode) | null;
}

/**
 * Spalte „Im Einsatz" (LFH-552): laufende Einsatzdauer je Einheit aus der Kräfte-Zeitachse.
 * `gesperrt` (403) nimmt die Spalte weg; solange die Perioden laden oder scheitern, bleibt die
 * Zelle leer — ein „—" behauptete sonst „nicht im Einsatz" für eine ungeprüfte Lage.
 */
interface ImEinsatzSpalte {
  zustand: AbrufZustand;
  jeEinheit: ReadonlyMap<number, LaufendeDauer>;
}

function rasterSpalten(
  einsatzId: number,
  auftraegeZustand: AbrufZustand,
  kontext: StatusKontext,
  rueckmeldung: RueckmeldungSpalte,
  imEinsatz: ImEinsatzSpalte,
) {
  return spaltenFuer<RasterZeile>()([
    {
      title: 'Einheit',
      key: 'einheit',
      immerSichtbar: true,
      render: (_t, z) => <EinheitZelle zeile={z} />,
    },
    {
      title: 'Funkrufname',
      key: 'funk',
      width: 140,
      abBreite: 'lg',
      render: (_t, z) =>
        z.art === 'einheit' && z.funkrufname ? (
          <span style={monoStil(12)}>{z.funkrufname}</span>
        ) : null,
    },
    // Kein `abBreite`: als Spalte ist der Abschnitt die Gliederung. `abBreite` hängt an der
    // Fensterbreite, nicht an `@media print`, und ein Meldeblatt auf A4 ginge sonst ohne die
    // Zuordnung Einheit → Abschnitt hinaus.
    { title: 'Abschnitt', dataIndex: 'abschnitt', key: 'abschnitt', width: 140 },
    {
      title: 'Stärke',
      key: 'staerke',
      width: 120,
      render: (_t, z) =>
        z.staerke ? <span style={monoStil(12)}>{staerkeText(z.staerke)}</span> : null,
    },
    {
      title: 'Status',
      key: 'status',
      width: 200,
      render: (_t, z) => <StatusSpalte zeile={z} handStatus={kontext.handStatus} />,
    },
    {
      title: 'Seit',
      key: 'seit',
      width: 90,
      render: (_t, z) =>
        (z.art === 'einheit' && z.einheitId != null) || z.art === 'fahrzeug' ? (
          <span style={monoStil(12)}>{z.seit ? kontext.zeit(z.seit) : '—'}</span>
        ) : null,
    },
    // Kein `abBreite`: die Einsatzdauer gehört zum Einsatzwert im Lagevortrag und auf das
    // Meldeblatt (Druck).
    ...(imEinsatz.zustand === 'gesperrt'
      ? []
      : [
          {
            title: 'Im Einsatz',
            key: 'im_einsatz',
            width: 96,
            render: (_t: unknown, z: RasterZeile) =>
              z.art === 'einheit' && z.einheitId != null ? (
                <ImEinsatzZelle
                  zustand={imEinsatz.zustand}
                  dauer={imEinsatz.jeEinheit.get(z.einheitId) ?? null}
                  zeit={kontext.zeit}
                />
              ) : null,
          },
        ]),
    // Die Mittelverteilung ist Zusatz zum Einheitenstatus, keine Vergleichsachse — sie weicht auf
    // schmalem Schirm zuerst (Zähler im Spaltenschalter).
    {
      title: 'Mittel',
      key: 'mittel',
      width: 190,
      abBreite: 'xl',
      render: (_t, z) => <MittelVerteilungZellen zeile={z} />,
    },
    {
      title: 'Auftrag',
      key: 'auftrag',
      render: (_t, z) => (
        <AuftragZelle einsatzId={einsatzId} zeile={z} zustand={auftraegeZustand} />
      ),
    },
    // Letzte Spalte, rechtsbündig. Kein `abBreite` (das Meldeblatt auf A4 braucht sie). Für eine
    // Rolle ohne Leserecht auf „Meldungen" (403) entfällt die Spalte — ein grauer Strich stünde
    // verwechselbar neben dem roten „—" für „nie zurückgemeldet".
    ...(rueckmeldung.zustand === 'gesperrt'
      ? []
      : [
          {
            title: 'Rückmeldung',
            key: 'rueckmeldung',
            width: 96,
            align: 'right' as const,
            render: (_t: unknown, z: RasterZeile) => (
              <RueckmeldungZelle
                zeile={z}
                zustand={rueckmeldung.zustand}
                anzeige={rueckmeldung.jeZeile.get(z.key) ?? null}
              />
            ),
          },
        ]),
  ]);
}

/** Nur für Screenreader: der Anker der Dauer, sehend steht er im `title`. */
const NUR_VORGELESEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

function ImEinsatzZelle({
  zustand,
  dauer,
  zeit,
}: {
  zustand: AbrufZustand;
  dauer: LaufendeDauer | null;
  zeit: (utc: string) => string;
}) {
  if (zustand !== 'daten') return null;
  if (!dauer) return <span style={monoStil(12)}>—</span>;
  const anker = ankerText(dauer.anker, zeit(dauer.beginnAt));
  return (
    <span data-lfh="im-einsatz" title={anker} style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>
      {dauerText(dauer.minuten)}
      <span style={NUR_VORGELESEN}>, {anker}</span>
    </span>
  );
}

function EinheitZelle({ zeile: z }: { zeile: RasterZeile }) {
  const { token, rollen } = useRollen();
  // Umbrechend: die Einheitenspalte hat keine feste Breite, und ein nicht umbrechender Nebentext
  // höbe die Mindestbreite der ganzen Tabelle — im Druck auf A4 ragte sie aus dem Blatt
  // (`e2e/meldebild-druck.spec.ts`).
  const nebentext = z.zusatz && (
    <span style={{ display: 'block', fontSize: 11, color: rollen.gedaempft }}>{z.zusatz}</span>
  );
  if (z.art !== 'einheit') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: token.marginXS }}>
        <span style={{ ...monoStil(11), color: rollen.schwach }}>{MITTEL_KURZ[z.art]}</span>
        <span style={{ minWidth: 0 }}>
          {z.art === 'fahrzeug' ? <span style={monoStil(12)}>{z.bezeichnung}</span> : z.bezeichnung}
          {nebentext}
        </span>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginSM }}>
      <EinheitZeichen tz={z.tz} />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{z.bezeichnung}</span>
        {nebentext}
      </span>
    </span>
  );
}

/**
 * Statusspalte. Mittel: der Einzelstatus als Chip (Fahrzeug mit FMS-Code). Einheit: abgeleitet als
 * Chip, „gemischt" mit der Verteilung als Text daneben, und bei einer Einheit ohne Fahrzeug mit
 * Schreibrecht der Auslöser für den Handstatus.
 */
function StatusSpalte({
  zeile: z,
  handStatus,
}: {
  zeile: RasterZeile;
  handStatus: StatusKontext['handStatus'];
}) {
  const { token, rollen } = useRollen();
  if (z.art === 'einheit' && z.handStatus && handStatus) return <>{handStatus(z)}</>;
  if (!z.status) return null;
  const verteilung = 'verteilung' in z.status ? z.status.verteilung : null;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: token.marginXXS }}>
      <StatusChip ton={z.status.ton} code={z.status.code ?? undefined} wort={z.status.wort} />
      {verteilung && (
        <span
          data-lfh="meldebild-statusverteilung"
          style={{ ...monoStil(11), color: rollen.gedaempft }}
        >
          {verteilung}
        </span>
      )}
    </span>
  );
}

/**
 * Die verdichtete Verteilung der Fahrzeuge und des Personals als drei Statuszellen in fester Folge,
 * auch bei 0 — sonst fluchten zwei Zeilen nicht. Eine 0 bekommt keinen Ton: eine rot getönte Null
 * meldete das Gegenteil.
 */
function MittelVerteilungZellen({ zeile: z }: { zeile: RasterZeile }) {
  const { rollen } = useRollen();
  const v = z.verteilung;
  if (!v) return null;
  const zellen = [
    { wert: v.bereit, wort: 'bereit', ton: 'normal' as const },
    { wert: v.gebunden, wort: 'gebunden', ton: 'achtung' as const },
    { wert: v.ausfall, wort: 'Ausfall', ton: 'alarm' as const },
  ];
  return (
    <div
      role="group"
      aria-label="Fahrzeuge und Personal"
      data-lfh="meldebild-verteilung"
      title={v.ohne > 0 ? `zusätzlich ${v.ohne} ohne Status` : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(40px, 1fr))',
        gap: 1,
        background: rollen.linie,
        maxWidth: 180,
      }}
    >
      {zellen.map((c) => (
        <StatusZelle
          key={c.wort}
          ton={c.wert > 0 ? c.ton : 'neutral'}
          wert={c.wert}
          wort={c.wort}
          hoehe={24}
        />
      ))}
    </div>
  );
}

function AuftragZelle({
  einsatzId,
  zeile: z,
  zustand,
}: {
  einsatzId: number;
  zeile: RasterZeile;
  zustand: AbrufZustand;
}) {
  const { rollen } = useRollen();
  if (z.art !== 'einheit' || z.einheitId == null) return null;
  // Scheitert der Auftragsabruf, bleibt die Tabelle stehen — die Zelle sagt, dass sie nichts weiß,
  // statt „kein Auftrag" zu behaupten. Eine Rolle ohne Auftragsrecht bekommt 403 — „nicht für
  // dich", keine Störung, und darf nicht wie eine aussehen.
  if (zustand === 'gesperrt') {
    return (
      <span title="Aufträge für diese Rolle nicht einsehbar" style={{ color: rollen.gedaempft }}>
        —
      </span>
    );
  }
  if (zustand === 'fehler') {
    return (
      <span title="Aufträge nicht abrufbar" style={{ color: rollen.gedaempft }}>
        ?
      </span>
    );
  }
  if (zustand === 'laden' || !z.auftrag) return null;
  const a = z.auftrag;
  const text = [
    a.nr != null ? `Nr. ${a.nr}` : null,
    a.ueberfaellig ? 'überfällig' : a.inArbeit ? 'in Arbeit' : null,
    a.text,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      to={auftraegePfad(einsatzId, { auftrag: a.id })}
      title={text}
      // Zwei Zeilen mit Auslassung: eine nicht umbrechende Zeile setzte die Mindestbreite der
      // Spalte auf die Textlänge. Der Volltext steht im `title`.
      style={{
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        maxWidth: 360,
      }}
    >
      {text}
    </Link>
  );
}

/**
 * Rückmeldungszelle: Mono 11, Uhrzeit der letzten Rückmeldung. Die Farbe trägt die Aussage nicht
 * allein (WCAG 1.4.1): „nie" ist ein eigenes Zeichen („—"), und jeder Zustand steht als Wort im
 * zugänglichen Namen und Tooltip (`RUECKMELDUNG_WORT`).
 */
function RueckmeldungZelle({
  zeile: z,
  zustand,
  anzeige,
}: {
  zeile: RasterZeile;
  zustand: AbrufZustand;
  anzeige: RueckmeldungAnzeige | null;
}) {
  const { rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  if (z.art !== 'einheit' || z.einheitId == null) return null;
  // Scheitert der Abruf, sagt die Zelle, dass sie nichts weiß — nicht „keine Rückmeldung".
  if (zustand === 'fehler') {
    return (
      <span title="Rückmeldungen nicht abrufbar" style={{ color: rollen.gedaempft }}>
        ?
      </span>
    );
  }
  if (zustand !== 'daten' || !anzeige) return null;
  const rolle = RUECKMELDUNG_ROLLE[anzeige.zustand];
  const farbe =
    rolle === 'alarm' ? rollen.alarm : rolle === 'achtung' ? rollen.achtung : rollen.gedaempft;
  const wort = RUECKMELDUNG_WORT[anzeige.zustand];
  const l = anzeige.letzte;
  const zeit = l ? formatUhrzeitMitTag(l.ereigniszeit, konventionen) : null;
  const beschreibung = l
    ? [wort, `letzte ${zeit}`, MELDEWEG_WORT[l.meldeweg], `Meldung Nr. ${l.lfd_nr}`].join(' · ')
    : wort;
  return (
    <span
      role="img"
      aria-label={beschreibung}
      title={beschreibung}
      data-lfh="meldebild-rueckmeldung"
      data-zustand={anzeige.zustand}
      style={{ ...monoStil(11), color: farbe, whiteSpace: 'nowrap' }}
    >
      {zeit ?? '—'}
    </span>
  );
}

/** Seitenuhr für das Überfällig-Urteil — schlägt ohne Live-Ereignis um (30-s-Takt). */
function useJetzt(intervallMs = 30_000): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(dayjs()), intervallMs);
    return () => window.clearInterval(t);
  }, [intervallMs]);
  return jetzt;
}

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  // Sprungziele in fremde Module (LFH-888, design.md D4): gesperrt mit Grund statt ins 403.
  const sprungGesperrt = useSprungSperre(einsatzId);
  const einheitenGesperrt = sprungGesperrt('einheiten');
  const lageberichtGesperrt = sprungGesperrt('lageberichte');
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useJetzt();

  const [filter, setFilter] = useState<FilterWerte>(LEERER_FILTER);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  // Die zwei Zusatzabrufe des Rasters. Beide dürfen scheitern, ohne die Seite zu nehmen:
  // ohne Katalog fehlen nur die FMS-Codes, ohne Aufträge nur die Auftragsspalte.
  const statusKatalogQuery = useQuery({
    queryKey: globalKeys.fahrzeugStatus(),
    queryFn: listeFahrzeugStatus,
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
  });
  // Dritter Zusatzabruf. Liegt unter dem `meldungen`-Präfix und wird vom Live-Ereignis `meldung`
  // mit invalidiert. 403 heißt „Meldungen für diese Rolle nicht lesbar" — dann gibt es weder Spalte
  // noch Kachel.
  const rueckmeldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungenRueckmeldungen(einsatzId),
    queryFn: () => holeRueckmeldungen(einsatzId),
  });
  // Vierter Zusatzabruf (LFH-552): Perioden je Einheit für „Im Einsatz". Scheitert er, fehlt nur
  // die Dauer.
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachseEinheiten(einsatzId),
    queryFn: () => listeEinheitenPerioden(einsatzId),
  });

  const traeger = useMemo(
    () =>
      [
        ...new Set(
          [
            ...(personalQuery.data ?? []).map((x) => x.traegerorganisation),
            ...(fahrzeugeQuery.data ?? []).map((x) => x.traegerorganisation),
          ].filter((t): t is string => !!t),
        ),
      ].sort(),
    [personalQuery.data, fahrzeugeQuery.data],
  );

  const gefiltertRoh = useMemo(() => {
    const roh: Rohdaten = {
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
    };
    return filtereKraefte(roh, filter);
  }, [
    abschnitteQuery.data,
    einheitenQuery.data,
    personalQuery.data,
    fahrzeugeQuery.data,
    materialQuery.data,
    filter,
  ]);

  const raster = useMemo(
    () =>
      baueMeldebildRaster({
        ...gefiltertRoh,
        statusKatalog: statusKatalogQuery.data ?? [],
        auftraege: auftraegeQuery.data ?? [],
      }),
    [gefiltertRoh, statusKatalogQuery.data, auftraegeQuery.data],
  );

  const rueckmeldungZustand = abrufZustand(rueckmeldungenQuery);
  const rueckmeldungDaten = rueckmeldungZustand === 'daten' ? rueckmeldungenQuery.data : undefined;
  /**
   * Anzeige je Zeilenschlüssel — nur bei lesbaren Daten. Beim Laden, bei Fehler und bei 403 bleibt
   * die Tabelle leer, statt jede Einheit zu „nie zurückgemeldet" zu machen. Hängt an `jetzt`:
   * „überfällig" schlägt mit der Uhr um.
   */
  const rueckmeldungJeZeile = useMemo(() => {
    const m = new Map<string, RueckmeldungAnzeige>();
    if (!rueckmeldungDaten) return m;
    const je = rueckmeldungJeEinheit(rueckmeldungDaten);
    for (const z of raster) {
      const r = rueckmeldungDerZeile(z, je, jetzt);
      if (r) m.set(z.key, r);
    }
    return m;
  }, [raster, rueckmeldungDaten, jetzt]);

  const band = useMemo(
    () => ({
      einheiten: einheitBand(gefiltertRoh.einheiten),
      personal: personalBand(gefiltertRoh.personal),
      rueckmeldung: rueckmeldungDaten ? keineRueckmeldungZelle(raster, rueckmeldungDaten) : null,
    }),
    // `einheitBand` liest den Status an der Einheit selbst, nicht über den Katalog.
    [gefiltertRoh, raster, rueckmeldungDaten],
  );

  /**
   * Handstatus einer Einheit ohne Fahrzeug. Kein optimistisches Update: der Status ist eine
   * Ableitung des Servers, und die Antwort trägt ihn fertig.
   */
  const handStatusMutation = useMutation({
    mutationFn: (v: { eid: number; statusId: number | null }) =>
      setzeEinheitStatus(einsatzId, v.eid, v.statusId),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
    // Auch der Fehlerweg holt den Serverstand: ein 422 heißt meist, dass die Einheit inzwischen ein
    // Fahrzeug hat — ohne Refetch bliebe der Auslöser stehen.
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      message.error(e instanceof ApiError && e.status === 422 ? e.message : 'Status nicht gesetzt');
    },
  });

  const v = useMemo(
    () => verdichte(gefiltertRoh.personal, gefiltertRoh.fahrzeuge, gefiltertRoh.material),
    [gefiltertRoh],
  );
  /** Der Bezugswert — dieselbe Rechnung über die ungefilterten Listen. */
  const gesamt = useMemo(
    () => verdichte(personalQuery.data ?? [], fahrzeugeQuery.data ?? [], materialQuery.data ?? []),
    [personalQuery.data, fahrzeugeQuery.data, materialQuery.data],
  );

  const auftraegeZustand = abrufZustand(auftraegeQuery);
  const periodenZustand = abrufZustand(periodenQuery);
  const jetztMs = jetzt.valueOf();
  const imEinsatzJeEinheit = useMemo(() => {
    const m = new Map<number, LaufendeDauer>();
    for (const e of periodenQuery.data ?? []) {
      const d = kraftDauern(e.perioden, jetztMs).laufend;
      if (d) m.set(e.einheit_id, d);
    }
    return m;
  }, [periodenQuery.data, jetztMs]);
  const darfSchreibenFrueh = einsatzQuery.data
    ? darfImEinsatzSchreiben(einsatzQuery.data, benutzer)
    : false;
  const statusOptionen = useMemo(
    () => handStatusOptionen(statusKatalogQuery.data ?? []),
    [statusKatalogQuery.data],
  );
  const handLaeuft = handStatusMutation.isPending;
  const handEid = handStatusMutation.variables?.eid;
  const handMutate = handStatusMutation.mutate;
  const handStatus = useMemo<StatusKontext['handStatus']>(() => {
    if (!darfSchreibenFrueh) return null;
    const HandStatusZelle = (z: RasterZeile) => {
      const s = z.status;
      const aktuell =
        z.einheitStatus?.quelle === 'hand' ? (z.einheitStatus.status?.status_id ?? null) : null;
      return (
        <StatusWahl<number>
          darstellung={
            s && aktuell != null
              ? {
                  ...statusKategorie[z.einheitStatus!.status!.kategorie],
                  label: s.code ? `${s.code} · ${s.wort}` : s.wort,
                }
              : null
          }
          aktuell={aktuell}
          farbe={aktuell != null ? z.einheitStatus?.status?.farbe : null}
          optionen={statusOptionen}
          kennung={z.bezeichnung}
          laeuft={handLaeuft && handEid === z.einheitId}
          gesperrt={handLaeuft}
          darfSchreiben
          onWaehlen={(wert) => {
            if (!handLaeuft && z.einheitId != null)
              handMutate({ eid: z.einheitId, statusId: wert === KEIN_HANDSTATUS ? null : wert });
          }}
        />
      );
    };
    return HandStatusZelle;
  }, [darfSchreibenFrueh, statusOptionen, handLaeuft, handEid, handMutate]);

  const spalten = useMemo(
    () =>
      rasterSpalten(
        einsatzId,
        auftraegeZustand,
        { zeit: (utc) => formatUhrzeitMitTag(utc, konventionen), handStatus },
        { zustand: rueckmeldungZustand, jeZeile: rueckmeldungJeZeile },
        { zustand: periodenZustand, jeEinheit: imEinsatzJeEinheit },
      ),
    [
      einsatzId,
      auftraegeZustand,
      konventionen,
      handStatus,
      rueckmeldungZustand,
      rueckmeldungJeZeile,
      periodenZustand,
      imEinsatzJeEinheit,
    ],
  );

  const uebernehmen = useMutation({
    mutationFn: async () => {
      // Stand in der Anzeigezone: die DTG landet als Text im Lagebericht (LFH-692).
      const stand = taktischeDtgVoll(new Date().toISOString(), konventionen);
      // Der Lagebericht behält die Abschnittsgliederung: ein Meldetext wird nach Abschnitten
      // gelesen, das Raster am Schirm nach Einheiten verglichen.
      const bild = baueKraeftebild(
        gefiltertRoh.abschnitte,
        gefiltertRoh.einheiten,
        gefiltertRoh.personal,
        gefiltertRoh.fahrzeuge,
        gefiltertRoh.material,
      );
      const md = rendereMeldebildMarkdown(bild, stand);
      // EIN Aufruf mit Startinhalt (LFH-548): der Bericht entsteht mit Text oder gar nicht. Das
      // frühere POST + PATCH ließ bei gescheitertem PATCH einen leeren Entwurf stehen.
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Kräftemeldebild ${stand}`,
        abschnitte: [{ schluessel: 'text', text: md }],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
    // Kein `onError`-Toast: der Fehler steht an der Seite (`SpeicherFehler` unter der
    // Werkzeugzeile) und geht beim nächsten Versuch von selbst.
  });

  // Ein Einsatzwechsel setzt Filter und Aufklappzustand zurück — sonst trüge die Filtermarke den
  // Abschnittsnamen des vorigen Einsatzes.
  //
  // Zugeklappt starten ist richtig: die Einheitenzeile selbst trägt Stärke, Verteilung und Auftrag;
  // die Mittel darunter sind Detail.
  useEffect(() => {
    setExpandedKeys([]);
    setFilter(LEERER_FILTER);
  }, [einsatzId]);

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  /** Ältester erfolgreicher Listenabruf — trägt Kopfzeile UND Druckstand. */
  const datenstand = gemeinsamerDatenstand(
    einheitenQuery.dataUpdatedAt,
    personalQuery.dataUpdatedAt,
    fahrzeugeQuery.dataUpdatedAt,
    materialQuery.dataUpdatedAt,
    abschnitteQuery.dataUpdatedAt,
  );

  /**
   * Stehen alle Mittel offen? Trägt den Zustand des Umschalters. Als benannte Zwischenvariable,
   * nicht inline im `value` — `datensicht.guard.test.ts` liest aus dem Schalter-Attribut eine
   * „Reiterachse"; hier liest der Schalter die Daten, nicht umgekehrt.
   */
  const alleAufgeklappt =
    expandedKeys.length > 0 && expandedKeys.length === aufklappbareSchluessel(raster).length;

  const abschnittName = (aid: number) =>
    (abschnitteQuery.data ?? []).find((a) => a.id === aid)?.name ?? `Abschnitt ${aid}`;
  const chips = aktiveFilterChips(filter, abschnittName);
  const gefiltert = chips.length > 0;
  /** „Kräfte" = Personal + Fahrzeuge, kein Material (eigene Statusachse). */
  const sichtbareKraefte = v.anzahlPersonal + v.anzahlFahrzeuge;
  const alleKraefte = gesamt.anzahlPersonal + gesamt.anzahlFahrzeuge;
  const einheitenZeilen = raster.filter((z) => z.einheitId != null).length;

  const listenFehler = personalQuery.isError || fahrzeugeQuery.isError || einheitenQuery.isError;
  const listenLaden = personalQuery.isLoading || fahrzeugeQuery.isLoading;

  const meta = meldebildMeta({
    einheiten: einheitenZeilen,
    einheitenGesamt: (einheitenQuery.data ?? []).length,
    staerke: staerkeText(v.staerke),
    staerkeGesamt: staerkeText(gesamt.staerke),
    gefiltert,
  });

  return (
    // `kraefte-print-root` bleibt die äußere Hülle: `kraefteuebersichtPrint.css` hängt daran, und
    // `EinsatzSeite` nimmt kein `className`.
    <div className="kraefte-print-root" data-lfh="druckwurzel">
      <EinsatzSeite
        titel="Meldebild"
        meta={meta}
        dataUpdatedAt={datenstand}
        aktionen={
          <Space className="kraefte-no-print" wrap>
            {/* Sekundär: der Abschnitt-Filter. Er wirkt wie alle Filter außerhalb des Primitivs
                auf die Rohlisten. */}
            <Select
              aria-label="Abschnitt filtern"
              placeholder="Abschnitt"
              prefix={
                <span aria-hidden style={{ display: 'inline-flex' }}>
                  <IconTrichter />
                </span>
              }
              allowClear
              style={{ minWidth: 160 }}
              value={filter.abschnittId ?? undefined}
              options={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              onChange={(wert) => setFilter((f) => ({ ...f, abschnittId: wert ?? null }))}
            />
            {/* Primär: eine Einheit bilden. Die Maske lebt auf der Einheiten-Seite; ein zweites
                Formular hier wäre eine zweite Erfassungsmaske derselben Sache. Ohne
                Schreibrecht kein Knopf. */}
            {darfSchreiben && (
              <Button
                type="primary"
                icon={
                  <span aria-hidden style={{ display: 'inline-flex' }}>
                    <IconPlus />
                  </span>
                }
                disabled={einheitenGesperrt}
                title={einheitenGesperrt ? KEINE_BERECHTIGUNG : 'Einheit anlegen (Einheiten-Seite)'}
                onClick={() => navigate(einheitenPfad(einsatzId))}
              >
                Einheit
              </Button>
            )}
          </Space>
        }
      >
        {/* ── Druckkopf ── Einsatz, Stand, druckende Person und Auswahl — ohne sie ist ein
            Meldeblatt nicht zuordenbar. Am Schirm verborgen. Der Stand ist der älteste
            erfolgreiche Listenabruf, nicht die Druckzeit. */}
        <Druckkopf
          dokumentart="Meldebild"
          einsatz={einsatz}
          sichtbarkeit="druck"
          zeilen={[
            {
              etikett: 'Stand',
              wert: taktischeDtgVoll(
                new Date(datenstand || Date.now()).toISOString(),
                konventionen,
              ),
            },
            { etikett: 'Umfang', wert: meta },
            ...(gefiltert
              ? [{ etikett: 'Auswahl', wert: chips.map((c) => c.label).join(' · ') }]
              : []),
          ]}
        />

        <div style={{ marginBlock: token.marginLG }}>
          <Statusband
            einheiten={band.einheiten}
            einheitenHinweis={
              filter.traeger || filter.kategorie || filter.suche.trim()
                ? 'alle Einheiten des Abschnitts — Träger-, Status- und Suchfilter wirken auf die Mittel'
                : null
            }
            personal={band.personal}
            rueckmeldung={band.rueckmeldung}
            zustand={listenFehler ? 'fehler' : listenLaden ? 'laden' : 'daten'}
          />
        </div>

        {/* ── Werkzeugzeile, außerhalb des Primitivs ── Die Auswahlzeile sagt immer, wie viel
            von wie viel gezeigt wird — auch ungefiltert, sonst wäre ihr Erscheinen selbst das
            Signal. Druck und Lagebericht stehen hier und nicht in der Werkzeugzeile von
            `Datensicht`: nur hier trägt `.kraefte-no-print`. */}
        <div
          className="kraefte-no-print"
          data-lfh="meldebild-werkzeuge"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: token.marginSM,
            marginBlockEnd: token.margin,
          }}
        >
          <span style={{ color: token.colorTextSecondary }}>
            {sichtbareKraefte} von {alleKraefte} Kräften
          </span>
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
          <Select
            placeholder="Trägerorganisation"
            allowClear
            style={{ minWidth: 180 }}
            value={filter.traeger ?? undefined}
            options={traeger.map((t) => ({ value: t, label: t }))}
            onChange={(wert) => setFilter((f) => ({ ...f, traeger: wert ?? null }))}
          />
          {/* Der vierte Eimer („ohne Status") bleibt draußen: `filtereKraefte` vergleicht `kat
              === f.kategorie`, ein Wert `'ohne'` träfe nie eine Zeile. */}
          <Select
            placeholder="Status"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.kategorie ?? undefined}
            options={KATEGORIE_WERTE.filter((w) => w.value !== 'ohne').map((w) => ({
              value: w.value as StatusKategorie,
              label: w.text,
            }))}
            onChange={(wert) => setFilter((f) => ({ ...f, kategorie: wert ?? null }))}
          />
          <Input.Search
            placeholder="Suche..."
            allowClear
            style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320 }}
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          />
          {/* Zwei Zustände desselben Rasters. Der Wert wird aus `expandedKeys` gegen die
              Vollzähligkeit abgeleitet — mit `length > 0` stünde der Umschalter nach dem
              Zuklappen einer einzelnen Zeile weiter auf „alles". */}
          <Segmented
            value={alleAufgeklappt ? 'mittel' : 'einheiten'}
            onChange={(wert) =>
              setExpandedKeys(wert === 'mittel' ? aufklappbareSchluessel(raster) : [])
            }
            options={[
              { value: 'einheiten', label: 'Nur Einheiten' },
              { value: 'mittel', label: 'Mit Mitteln' },
            ]}
          />
          {darfSchreiben && (
            <Button
              loading={uebernehmen.isPending}
              disabled={lageberichtGesperrt}
              title={lageberichtGesperrt ? KEINE_BERECHTIGUNG : undefined}
              onClick={() => uebernehmen.mutate()}
            >
              In Lagebericht übernehmen
            </Button>
          )}
          {/* Erst nach committetem Aufklappen drucken (sonst fehlen die Mittel) — `useDrucken`
              löst den Dialog nach dem Commit aus. */}
          <DruckKnopf vorbereiten={() => setExpandedKeys(aufklappbareSchluessel(raster))} />
        </div>
        {uebernehmen.error != null && (
          <div className="kraefte-no-print" style={{ marginBlockEnd: token.margin }}>
            <SpeicherFehler
              fehler={uebernehmen.error}
              titel="Nicht in den Lagebericht übernommen"
              fallback="Übernahme fehlgeschlagen"
            />
          </div>
        )}

        {/* Das Raster läuft mit `form="tabelle"` — in jeder Breite Tabelle (Vergleichsfläche).
            Die fixierte menschenlesbare Kennung ist die Einheitenspalte.

            Kein `suche`, kein Spaltenfilter, keine Sortierung im Primitiv
            (`VOLLMENGE_PFLICHT`): die Verteilungen entstehen aus den gefilterten Rohlisten;
            fiele im Primitiv eine Mittelzeile weg, behielte die Einheit Zahlen über unsichtbare
            Kinder.

            Zufluss: `sammelbanner`. Die Wurzel ist die Einheitenliste — eine neu gebildete
            Einheit erscheint als Banner; neue Mittel wachsen in den Kindern und ändern die
            Wurzelfolge nicht.

            Problemzeile: eine Einheit mit Ausfall oder mit überfälliger/fehlender Rückmeldung
            trägt `meldebild-problemzeile` (Tönung `--lfh-problem-zeile`, Regel in
            `kraefteuebersichtPrint.css`). Zweiter Kanal ist die Ausfall-Zahl bzw. Uhrzeit oder
            „—" samt Wort im zugänglichen Namen. Eine Tönungsfarbe für beide Fälle, wie im
            Entwurf. */}
        <Datensicht
          bezeichnung="Meldebild"
          form="tabelle"
          spalten={spalten}
          daten={raster}
          zeilenSchluessel="key"
          ladend={einheitenQuery.isLoading}
          leerText={
            <span>
              Keine Einheiten und keine Kräfte im Einsatz
              {darfSchreiben && !einheitenGesperrt && (
                <>
                  {' — '}
                  <Link to={einheitenPfad(einsatzId)}>Einheit bilden</Link>
                </>
              )}
            </span>
          }
          baum={{ kinder: 'children', aufgeklappt: expandedKeys, onAufgeklappt: setExpandedKeys }}
          zeilenKlasse={(z) =>
            istProblemZeile(z) || istRueckmeldungProblem(rueckmeldungJeZeile.get(z.key))
              ? 'meldebild-problemzeile'
              : undefined
          }
          karte={{
            art: 'plan',
            titel: { spalte: 'einheit' },
            sekundaer: ['abschnitt', 'staerke', 'auftrag'],
          }}
        />
      </EinsatzSeite>
    </div>
  );
}
