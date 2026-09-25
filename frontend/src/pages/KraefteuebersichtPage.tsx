import { App as AntApp, Button, Input, Segmented, Space, Tag, theme } from 'antd';
import { TbFilter, TbPlus } from 'react-icons/tb';
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
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  staerkeText,
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
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { FahrzeugStatus, StatusKategorie } from '../api/types';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { statusKategorie } from '../theme/statusFarben';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { StatusChip, StatusZelle, monoStil, useRollen } from '../components/instrument';
import './kraefteuebersichtPrint.css';

/**
 * MELDEBILD (Neuentwurf S6 „Statusraster über alle Einheiten", 21.09.2026).
 *
 * Aufbau: Seitenkopf (Titel · Mono-Meta · Abschnitt-Filter · „Einheit") → Statusband
 * (Einheiten je FMS-Status, Personal je Kategorie, Kachel „keine Rückmeldung") →
 * Werkzeugzeile außerhalb des Primitivs
 * (Auswahlzeile, weitere Filter, Aufklappen, Lagebericht, Druck) → Raster: EINE Zeile je
 * Einheit, die Mittel als aufklappbares Detail. Die Ableitungen stehen rein in
 * `kraefte/meldebildRaster.ts`.
 *
 * EINHEITENSTATUS UND „SEIT" (LFH-609, Entscheidung vom 22.09.2026): der Status einer
 * Einheit wird serverseitig aus ihren Fahrzeugen ABGELEITET — gemeinsam oder „gemischt"
 * mit Verteilung —, eine Einheit ohne Fahrzeug führt ihn von Hand (Auslöser nur dort).
 * Das Statusband zählt die Einheiten je Status wie der Entwurf. Die verdichtete
 * Verteilung der Mittel (bereit / gebunden / Ausfall) bleibt als eigene Spalte „Mittel".
 *
 * Der Funkrufname der Einheit ist ihr gepflegter eigener (LFH-614); fehlt er, steht nur
 * der eines EINZIGEN Fahrzeugs, sonst bleibt die Zelle leer.
 *
 * RÜCKMELDUNG (LFH-610) — seit es `GET …/meldungen/rueckmeldungen` gibt, ist sie da: die
 * letzte Spalte zeigt die Uhrzeit der letzten Rückmeldung (neutral), überfällig in
 * `achtung`, nie zurückgemeldet „—" in `alarm`; beide Problemfälle tönen die Zeile. Die
 * Kachel „keine Rückmeldung" zählt NUR die nie zurückgemeldeten Einheiten. Solange die
 * Daten laden, gescheitert oder für die Rolle gesperrt (403) sind, steht nirgends „keine" —
 * eine leere Menge hieße sonst „niemand hat je zurückgemeldet" und färbte alles rot.
 *
 * NICHTS IST MEHR WEGGELASSEN: die beiden Lücken, die hier bis 22.09.2026 unter
 * „Entscheidung 4, keine erfundenen Daten" standen (Einheitenstatus/„Seit", Rückmeldung),
 * haben seither je eine echte Datenquelle.
 */

/**
 * Der leere Filterzustand — EINE Quelle für Startwert, Zurücksetzen und das Zurücknehmen
 * einer einzelnen Marke.
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
 * Die gesetzten Filter als Beschriftungen (LFH-338 · C3, Befund H3). Feste Reihenfolge
 * (Abschnitt · Träger · Status · Suche), nicht die Setzreihenfolge; `suche` getrimmt wie in
 * `filtereKraefte`.
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
 * DIE H3-ZUSICHERUNG LEBT HIER WEITER: bei gesetztem Filter nennt die Zeile den Ausschnitt
 * UND den Bezugswert („3 von 7 Einheiten · Stärke 1/0/5//6 von 2/3/10//15"). Ohne ihn
 * verschwände die Gesamtstärke des Einsatzes genau in dem Moment, in dem jemand einen
 * Abschnitt anwählt — und dann wird gemeldet. Rein und exportiert, damit beide Zweige ohne
 * Rendern prüfbar sind.
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
    // Dieselbe Beschriftung wie im FMS-Tableau (LFH-642) — eine Quelle für beide Menüs.
    ...fmsStatusOptionen(katalog),
    // Der Handstatus muss sich auch wieder ENTFERNEN lassen — sonst bliebe ein einmal
    // gesetzter Wert für immer stehen und tauchte nach jeder Fahrzeugabgabe wieder auf.
    { wert: KEIN_HANDSTATUS, label: 'kein Status' },
  ];
}

/** Menüwert für „Handstatus löschen" — eine Katalog-ID ist nie negativ. */
export const KEIN_HANDSTATUS = -1;

/** Kurzwort der Mittelart — Satz, kein Piktogramm (Regel „Ein Emoji ist keine Ikone"). */
const MITTEL_KURZ = { fahrzeug: 'Fzg.', person: 'Pers.', material: 'Mtl.' } as const;

/**
 * Die Spalten des Rasters. In einer Fabrik statt als Modulkonstante, weil zwei Zellen vom
 * Kontext abhängen (Einsatz-ID für den Auftrags-Deeplink, Abrufzustand der Aufträge).
 * Durch `spaltenFuer<RasterZeile>()` geführt, NICHT annotiert (Schlüsselliterale).
 *
 * Keine Sortierung, kein Spaltenfilter, keine Suche im Primitiv (`VOLLMENGE_PFLICHT`):
 * gefiltert wird außerhalb über die Rohlisten, aus denen Zeilen und Verteilungen neu
 * entstehen.
 */
/** Abrufzustand eines Zusatzabrufs — `gesperrt` ist 403, kein Defekt. */
type AbrufZustand = 'daten' | 'laden' | 'fehler' | 'gesperrt';

function abrufZustand(q: { error: unknown; isError: boolean; isLoading: boolean }): AbrufZustand {
  if (q.error instanceof ApiError && q.error.status === 403) return 'gesperrt';
  if (q.isError) return 'fehler';
  if (q.isLoading) return 'laden';
  return 'daten';
}

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

function rasterSpalten(
  einsatzId: number,
  auftraegeZustand: AbrufZustand,
  kontext: StatusKontext,
  rueckmeldung: RueckmeldungSpalte,
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
    // KEIN `abBreite`: der Abschnitt war im alten Baum eine Ebene und damit in jeder Breite
    // und im Ausdruck da. Als Spalte ist er die Gliederung, die die Zeilenform ersetzt hat —
    // `abBreite` hängt an der Fensterbreite, nicht an `@media print`, und ein Meldeblatt auf
    // A4 (717 px) ginge sonst ohne die Zuordnung Einheit → Abschnitt hinaus.
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
    // Die Mittelverteilung ist Zusatz zum Einheitenstatus, keine Vergleichsachse — sie
    // weicht auf schmalem Schirm zuerst (Zähler im Spaltenschalter).
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
    // Letzte Spalte wie im Entwurf, rechtsbündig. KEIN `abBreite` (Begründung wie beim
    // Abschnitt: das Meldeblatt auf A4 braucht sie). Für eine Rolle ohne Leserecht auf
    // „Meldungen" (403) entfällt die Spalte ganz — n leere Zellen sagten nichts, und ein
    // grauer Strich stünde verwechselbar neben dem roten „—" für „nie zurückgemeldet".
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

function EinheitZelle({ zeile: z }: { zeile: RasterZeile }) {
  const { token, rollen } = useRollen();
  // Umbrechend, NICHT `nowrap`: die Einheitenspalte hat keine feste Breite, und ein
  // nicht umbrechender Nebentext hebt die Mindestbreite der ganzen Tabelle — im Druck auf
  // A4 ragte sie dann aus dem Blatt (`e2e/meldebild-tabelle.spec.ts`, Nachweis 2).
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
 * Statusspalte. Mittel: der echte Einzelstatus als Chip (Fahrzeug mit FMS-Code). Einheit:
 * ihr Status (LFH-609) — abgeleitet als Chip, „gemischt" mit der Verteilung als Text
 * daneben, und bei einer Einheit ohne Fahrzeug mit Schreibrecht der Auslöser für den
 * Handstatus.
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
 * Die verdichtete Verteilung der Fahrzeuge und des Personals einer Einheit als drei
 * Statuszellen in FESTER Folge, auch bei 0 — sonst fluchten zwei Zeilen nicht. Eine 0
 * bekommt keinen Ton: eine rot getönte Null meldete das Gegenteil dessen, was sie heißt.
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
  // Scheitert der Auftragsabruf, bleibt die Tabelle stehen — die Zelle sagt, dass sie
  // nichts weiß, statt „kein Auftrag" zu behaupten (Fehler ≠ leer).
  // Eine Rolle ohne Auftragsrecht bekommt 403 — das ist „nicht für dich", keine Störung,
  // und darf nicht wie eine aussehen.
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
      // Zwei Zeilen mit Auslassung statt `nowrap`: eine nicht umbrechende Zeile setzte die
      // Mindestbreite der Spalte auf die Textlänge. Der Volltext steht im `title`.
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
 * Rückmeldungszelle (Neuentwurf S6): Mono 11, Uhrzeit der letzten Rückmeldung.
 *
 * Farbe allein trägt die Aussage nicht (WCAG 1.4.1): „nie" ist ein eigenes Zeichen („—"
 * statt einer Uhrzeit), und jeder Zustand steht als Wort im zugänglichen Namen und im
 * Tooltip (`RUECKMELDUNG_WORT`). `achtung` als Textfarbe in Mono 11 folgt
 * `personen/personenSpalten.tsx` (Lückenzeile).
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
  // Scheitert der Abruf, sagt die Zelle, dass sie nichts weiß — NICHT „keine Rückmeldung".
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
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useJetzt();

  const [filter, setFilter] = useState<FilterWerte>(LEERER_FILTER);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [printPending, setPrintPending] = useState(false);

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
  // Dritter Zusatzabruf (LFH-610). Liegt unter dem `meldungen`-Präfix und wird vom
  // Live-Ereignis `meldung` mit invalidiert. 403 heißt „Meldungen für diese Rolle nicht
  // lesbar" — dann gibt es weder Spalte noch Kachel.
  const rueckmeldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungenRueckmeldungen(einsatzId),
    queryFn: () => holeRueckmeldungen(einsatzId),
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
   * Anzeige je Zeilenschlüssel — NUR bei lesbaren Daten. Beim Laden, bei Fehler und bei 403
   * bleibt die Tabelle leer statt einer leeren Nachschlagetabelle, die jede Einheit zu „nie
   * zurückgemeldet" machte. Hängt an `jetzt`: das Urteil „überfällig" schlägt mit der Uhr um.
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
    // Kein `statusKatalogQuery.data` mehr: `einheitBand` liest den Status seit LFH-609 an
    // der Einheit selbst, nicht mehr über den Katalog.
    [gefiltertRoh, raster, rueckmeldungDaten],
  );

  /**
   * Handstatus einer Einheit ohne Fahrzeug (LFH-609). Kein optimistisches Update: der
   * Status der Einheit ist eine Ableitung des Servers, und die Antwort trägt ihn fertig.
   */
  const handStatusMutation = useMutation({
    mutationFn: (v: { eid: number; statusId: number | null }) =>
      setzeEinheitStatus(einsatzId, v.eid, v.statusId),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
    // Auch der Fehlerweg holt den Serverstand: ein 422 heißt meist, dass die Einheit
    // inzwischen ein Fahrzeug hat — ohne Refetch bliebe der Auslöser stehen und jeder
    // weitere Versuch scheiterte ohne Grund.
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      message.error(e instanceof ApiError && e.status === 422 ? e.message : 'Status nicht gesetzt');
    },
  });

  const v = useMemo(
    () => verdichte(gefiltertRoh.personal, gefiltertRoh.fahrzeuge, gefiltertRoh.material),
    [gefiltertRoh],
  );
  /** Der Bezugswert — dieselbe Rechnung über die UNGEFILTERTEN Listen (Befund H3). */
  const gesamt = useMemo(
    () => verdichte(personalQuery.data ?? [], fahrzeugeQuery.data ?? [], materialQuery.data ?? []),
    [personalQuery.data, fahrzeugeQuery.data, materialQuery.data],
  );

  const auftraegeZustand = abrufZustand(auftraegeQuery);
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
      ),
    [
      einsatzId,
      auftraegeZustand,
      konventionen,
      handStatus,
      rueckmeldungZustand,
      rueckmeldungJeZeile,
    ],
  );

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const stand = taktischeDtgVoll(new Date().toISOString());
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
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Kräftemeldebild ${stand}`,
      });
      // Schlägt der PATCH fehl, bleibt ein leerer Entwurf zurück (vom EL löschbar) —
      // atomar wäre nur ein eigener Backend-Endpunkt, bewusster v1-Kompromiss.
      await aktualisiereLagebericht(einsatzId, lb.id, {
        abschnitte: [{ schluessel: 'text', text: md }],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
    onError: () => message.error('Übernahme fehlgeschlagen'),
  });

  // Ein Einsatzwechsel setzt Filter und Aufklappzustand zurück — sonst trüge die
  // Filtermarke den Abschnittsnamen des vorigen Einsatzes.
  //
  // ZUGEKLAPPT STARTEN ist hier richtig, und es dreht H7 (LFH-338 · C3) nicht zurück: der
  // Befund war, dass im alten Baum die meldefähigen Zahlen erst nach n Klicks zu sehen
  // waren. Im Raster trägt die EINHEITENZEILE selbst Stärke, Verteilung und Auftrag; die
  // Mittel darunter sind Detail. Ein Riegel „nur einmal aufklappen" ist damit entfallen.
  useEffect(() => {
    setExpandedKeys([]);
    setFilter(LEERER_FILTER);
  }, [einsatzId]);

  // Erst nach committetem Aufklappen drucken (sonst fehlen die Mittel im Ausdruck).
  useEffect(() => {
    if (printPending) {
      window.print();
      setPrintPending(false);
    }
  }, [printPending]);

  const handleDrucken = () => {
    setExpandedKeys(aufklappbareSchluessel(raster));
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
   * Stehen alle Mittel offen? Trägt den Zustand des Umschalters. Als benannte
   * Zwischenvariable, nicht inline im `value` — `datensicht.guard.test.ts` liest aus dem
   * Schalter-Attribut eine „Reiterachse"; hier liest der Schalter die Daten, nicht umgekehrt.
   */
  const alleAufgeklappt =
    expandedKeys.length > 0 && expandedKeys.length === aufklappbareSchluessel(raster).length;

  const abschnittName = (aid: number) =>
    (abschnitteQuery.data ?? []).find((a) => a.id === aid)?.name ?? `Abschnitt ${aid}`;
  const chips = aktiveFilterChips(filter, abschnittName);
  const gefiltert = chips.length > 0;
  /** „Kräfte" = Personal + Fahrzeuge, kein Material (eigene Statusachse, kein Kategoriefilter). */
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
    // `kraefte-print-root` bleibt die ÄUSSERE Hülle: `kraefteuebersichtPrint.css` hängt daran,
    // und `EinsatzSeite` nimmt kein `className` entgegen.
    <div className="kraefte-print-root" data-lfh="druckwurzel">
      <EinsatzSeite
        titel="Meldebild"
        meta={meta}
        dataUpdatedAt={datenstand}
        aktionen={
          <Space className="kraefte-no-print" wrap>
            {/* Sekundär: der Abschnitt-Filter. Er wirkt wie alle Filter AUSSERHALB des
                Primitivs auf die Rohlisten (VOLLMENGE_PFLICHT). */}
            <Select
              aria-label="Abschnitt filtern"
              placeholder="Abschnitt"
              prefix={
                <span aria-hidden style={{ display: 'inline-flex' }}>
                  <TbFilter />
                </span>
              }
              allowClear
              style={{ minWidth: 160 }}
              value={filter.abschnittId ?? undefined}
              options={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              onChange={(wert) => setFilter((f) => ({ ...f, abschnittId: wert ?? null }))}
            />
            {/* Primär: eine Einheit bilden. Die Maske lebt auf der Einheiten-Seite (dort
                steht das Anlegen-Modal); ein zweites Formular hier wäre eine zweite
                Erfassungsmaske derselben Sache. Ohne Schreibrecht kein Knopf — dort
                entstünde keine Einheit. */}
            {darfSchreiben && (
              <Button
                type="primary"
                icon={
                  <span aria-hidden style={{ display: 'inline-flex' }}>
                    <TbPlus />
                  </span>
                }
                title="Einheit anlegen (Einheiten-Seite)"
                onClick={() => navigate(einheitenPfad(einsatzId))}
              >
                Einheit
              </Button>
            )}
          </Space>
        }
      >
        {/* ── NUR IM DRUCK (LFH-338 · C3, Befund H4) ──────────────────────────────────
          Einsatzbezeichnung, Zeitstand, Ersteller und Auswahl — ohne diese vier Angaben ist
          ein Meldeblatt nicht zuordenbar. `data-testid`, weil der Knoten am Schirm per CSS
          verborgen ist und jsdom kein CSS auswertet. */}
        <div className="kraefte-nur-print" data-testid="kraefte-druckkopf">
          <div style={{ fontWeight: 600 }}>
            Meldebild — {einsatz.bezeichnung}
            {einsatz.einsatznummer_intern ? ` (${einsatz.einsatznummer_intern})` : ''}
          </div>
          {/* Der Stand ist der ÄLTESTE erfolgreiche Listenabruf, nicht die Druckzeit. */}
          <div>Stand: {taktischeDtgVoll(new Date(datenstand || Date.now()).toISOString())}</div>
          <div>Erstellt von: {benutzer?.anzeigename ?? '—'}</div>
          <div>{meta}</div>
          {gefiltert && <div>Auswahl: {chips.map((c) => c.label).join(' · ')}</div>}
        </div>

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

        {/* ── WERKZEUGZEILE, AUSSERHALB DES PRIMITIVS ─────────────────────────────────
          Die Auswahlzeile sagt IMMER, wie viel von wie viel gezeigt wird (H3) — auch
          ungefiltert, sonst wäre ihr Erscheinen selbst das Signal. Träger, Status und Suche
          filtern die Rohlisten wie der Abschnitt im Kopf. Druck und Lagebericht stehen HIER
          und nicht in der Werkzeugzeile von `Datensicht`: nur hier trägt `.kraefte-no-print`. */}
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
          {/* Der vierte Eimer („ohne Status") bleibt draußen: `filtereKraefte` vergleicht
            `kat === f.kategorie`, ein Wert `'ohne'` träfe nie eine Zeile. */}
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
          {/* Zwei Zustände desselben Rasters, keine zwei Handlungen. Der Wert wird aus
            `expandedKeys` ABGELEITET, gegen die Vollzähligkeit — mit `length > 0` stünde der
            Umschalter nach dem Zuklappen einer einzelnen Zeile weiter auf „alles". */}
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
            <Button loading={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>
              In Lagebericht übernehmen
            </Button>
          )}
          <Button onClick={handleDrucken}>Drucken / als PDF</Button>
        </div>

        {/* Das Raster läuft mit `form="tabelle"` — in JEDER Breite Tabelle (Vergleichsfläche,
          Kriterium 14; `NUR_TABELLE`). Die fixierte menschenlesbare Kennung ist die
          Einheitenspalte.

          KEIN `suche`, KEIN Spaltenfilter, KEINE Sortierung im Primitiv (`VOLLMENGE_PFLICHT`):
          die Verteilungen je Einheit entstehen aus den gefilterten Rohlisten; fiele im
          Primitiv eine Mittelzeile weg, behielte die Einheit Zahlen über unsichtbare Kinder.

          ZUFLUSS: Vorgabe `sammelbanner`. Bis 21.09. stand hier `sofort`, weil die Schleuse
          nur die WURZEL-Schlüsselfolge führt und eine neue Disposition tief im alten Baum
          landete. Die Wurzel ist jetzt die Einheitenliste — eine neu gebildete Einheit
          erscheint als Banner statt unter dem Cursor einzurutschen; neue Mittel wachsen in
          den Kindern und ändern die Wurzelfolge nicht.

          PROBLEMZEILE: eine Einheit mit Ausfall trägt `meldebild-problemzeile` (Tönung aus
          `--lfh-problem-zeile`, Regel in `kraefteuebersichtPrint.css`); der zweite Kanal ist
          die Ausfall-Zahl in der Statusspalte. Dieselbe Tönung trägt eine Einheit mit
          überfälliger oder fehlender Rückmeldung (LFH-610, Entwurf `rowBg`) — zweiter Kanal
          dort Uhrzeit bzw. „—" samt Wort im zugänglichen Namen. KEINE zweite Tönungsfarbe:
          der Entwurf nimmt für beide Fälle denselben Wert. */}
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
              {darfSchreiben && (
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
