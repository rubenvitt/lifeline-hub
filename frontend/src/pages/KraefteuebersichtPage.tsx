import { IconPlus, IconTrichter } from '../icons';
import { useModulFreigaben, useSprungSperre } from '../einsatz/useSprungSperre';
import { istKeyFreigegeben, KEINE_BERECHTIGUNG, modulName } from '../einsatz/modulRegistry';
import { Breadcrumb, Button, Input, Popover, Space, Tag, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { formatUhrzeitMitTag, taktischeDtgVoll } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams } from 'react-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  auftraegePfad,
  einheitenPfad,
  lageberichtDetailPfad,
  meldungenPfad,
  nachforderungenPfad,
} from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { listeEinheiten, setzeEinheitStatus } from '../api/einheiten';
import { listeEinsatzPersonal, listEntlassenesPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge, listEntlasseneFahrzeuge } from '../api/einsatzFahrzeuge';
import { listEinsatzMaterial, listEntlassenesMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeOffeneAuftraege } from '../api/auftraege';
import { holeRueckmeldungen } from '../api/meldungen';
import { listeNachforderungen } from '../api/nachforderungen';
import { zulaufBand } from '../kraefte/zulauf';
import {
  MELDEWEG_WORT,
  RUECKMELDUNG_ROLLE,
  RUECKMELDUNG_WORT,
  rueckmeldungJeEinheit,
} from '../meldungen/rueckmeldung';
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
  baueMeldebildRaster,
  einheitBand,
  einheitZeilen,
  istProblemZeile,
  istRueckmeldungProblem,
  keineRueckmeldungZelle,
  personalBand,
  rueckmeldungDerZeile,
  toenungsGruende,
  type RasterZeile,
  type RueckmeldungAnzeige,
} from '../kraefte/meldebildRaster';
import { handStatusOptionen, KEIN_HANDSTATUS } from '../kraefte/fmsTableauKern';
import Statusband from '../kraefte/Statusband';
import KraeftebaumZelle, { type SprungGesperrt } from '../kraefte/KraeftebaumZelle';
import {
  besatzungZeilen,
  schluesselBisStufe,
  schluesselZumSprung,
  stufeVon,
  type Ausklappstufe,
} from '../kraefte/kraeftebaumKern';
import { KATEGORIE_WERTE } from '../kraefte/statusAchse';
import { legeLageberichtAn } from '../api/lageberichte';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler, type ZeilenGrund } from '../components/useZeilenFehler';
import type { StatusKategorie } from '../api/types';
import StatusWahl from '../components/StatusWahl';
import { statusKategorie } from '../theme/statusFarben';
import Datensicht, { HERVORGEHOBEN, scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { useDruckModus } from '../components/druck/useDruckModus';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import {
  toEntlassene,
  toEntlasseneFahrzeuge,
  toHerausgenommenesMaterial,
} from '../kraefte/entlassene';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { StatusChip, StatusZelle, monoStil, useRollen } from '../components/instrument';
import Segmentleiste from '../components/instrument/Segmentleiste';
import './kraefteuebersichtPrint.css';
import { KennungsLink } from '../components/kennungsLink';
import { funktionText } from '../kraefte/einsatzfunktionKern';

/**
 * Meldebild: Statusraster über alle Einheiten, als Kräftebaum (LLH-1025, Spec `kraeftebaum`).
 *
 * Aufbau: Seitenkopf (Titel · Mono-Meta · Abschnitt-Filter · „Einheit") → Statusband (Paneele
 * Einheiten nach FMS-Status und Personal nach Status, „keine Rückmeldung"; LLH-1140) → Werkzeugzeile außerhalb des
 * Primitivs, einzeilig (Auswahlzeile, Suche, „Filter (n)“, Stufe, Lagebericht, Druck) → Raster als
 * Baum: Einheit → Untereinheiten, darunter ihre Fahrzeuge mit Besatzung, „Ohne Fahrzeug“ und das
 * Material als Gruppe. Die Elternzeile zeigt die kumulierte Stärke, Verteilung und Tönung bleiben
 * eigen. Die Baumlogik steht in `kraefte/kraeftebaumKern.ts`, die Zeilen in
 * `kraefte/meldebildRaster.ts`, die erste Spalte in `kraefte/KraeftebaumZelle.tsx`.
 *
 * Ausklappstufe: „Einheiten“ (Vorgabe beim Öffnen: Untereinheiten sichtbar, Mittel zu) · „mit
 * Fahrzeugen“ · „alles“; der Druck klappt alles auf. Der Wert der Segmentleiste wird aus den
 * offenen Schlüsseln abgeleitet (`stufeVon`), einzelne Zeilen klappen weiter von Hand.
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

/** Breite der Auftragsspalte: gekürzt auf zwei Zeilen, der Volltext steht im `title`. */
const AUFTRAG_BREITE = 180;

/** Zusatzspalten, die nie auf dem Blatt stehen (LFH-1109, Begründung an `spalten`). */
const NUR_AM_SCHIRM: ReadonlySet<string> = new Set(['funk', 'mittel']);

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
  /** Grund des zuletzt abgelehnten Handstatus je Einheit (`components/useZeilenFehler.ts`). */
  handFehler: (einheitId: number) => ZeilenGrund | null;
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
  sprungGesperrt: SprungGesperrt,
) {
  // Spaltenfolge nach der Frage am Schirm (LFH-973): Status, Rückmeldung und Auftrag stehen
  // vorn, damit sie bei 1440 px ohne Querscrollen im Bild liegen; Funkrufname und Mittel weichen
  // als Zusatz unter xxl. „Rückmeldung“ und „Im Einsatz“ bleiben ohne `abBreite`: `abBreite`
  // hängt an der Fensterbreite, nicht an `@media print`, und das Meldeblatt auf A4 braucht sie.
  // Die Einheit ist die Fließspalte (LFH-523): ohne sie liefe die Tabelle auf die einzeilige
  // Länge des längsten Namens, gemessen 317 px und 130 px Überlauf bei 1440. Alle übrigen
  // Spalten tragen deshalb eine Zahlbreite; zusammen passen sie in die 1050 px Inhaltsbreite des
  // Fükw-Hauptgeräts (1366), gemessen in `e2e/meldebild-tabelle.spec.ts`.
  return spaltenFuer<RasterZeile>()([
    {
      title: 'Einheit',
      key: 'einheit',
      immerSichtbar: true,
      mindestBreite: 170,
      render: (_t, z) => (
        <KraeftebaumZelle zeile={z} einsatzId={einsatzId} gesperrt={sprungGesperrt} />
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 180,
      render: (_t, z) => (
        <StatusSpalte
          zeile={z}
          handStatus={kontext.handStatus}
          fehler={
            z.art === 'einheit' && z.einheitId != null ? kontext.handFehler(z.einheitId) : null
          }
          gruende={toenungsGruende(z, rueckmeldung.jeZeile.get(z.key))}
        />
      ),
    },
    // Für eine Rolle ohne Leserecht auf „Meldungen" (403) entfällt die Spalte — ein grauer Strich
    // stünde verwechselbar neben dem roten „—" für „nie zurückgemeldet".
    ...(rueckmeldung.zustand === 'gesperrt'
      ? []
      : [
          {
            title: 'Rückmeldung',
            key: 'rueckmeldung',
            // Der Kopf selbst braucht 114 px; schmaler setzte die Messzeile die Breite ohnehin.
            width: 116,
            render: (_t: unknown, z: RasterZeile) => (
              <RueckmeldungZelle
                zeile={z}
                zustand={rueckmeldung.zustand}
                anzeige={rueckmeldung.jeZeile.get(z.key) ?? null}
              />
            ),
          },
        ]),
    {
      title: 'Auftrag',
      key: 'auftrag',
      width: AUFTRAG_BREITE,
      render: (_t, z) => (
        <AuftragZelle einsatzId={einsatzId} zeile={z} zustand={auftraegeZustand} />
      ),
    },
    {
      title: 'Stärke',
      key: 'staerke',
      width: 100,
      // Einheit: kumulierte Stärke (D2). Fahrzeug: die Besatzung Ist/Soll statt einer Stärke
      // (D4), gedämpft — sie ist in der Elternzahl schon enthalten.
      render: (_t, z) =>
        z.staerke ? (
          <span style={monoStil(12)}>{staerkeText(z.staerke)}</span>
        ) : z.besatzung ? (
          <StaerkeBesatzung zeilen={besatzungZeilen(z.besatzung)} />
        ) : null,
    },
    // Kein `abBreite`: als Spalte ist der Abschnitt die Gliederung, und ein Meldeblatt auf A4
    // ginge sonst ohne die Zuordnung Einheit → Abschnitt hinaus.
    { title: 'Abschnitt', dataIndex: 'abschnitt', key: 'abschnitt', width: 110 },
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
    {
      title: 'Funkrufname',
      key: 'funk',
      width: 140,
      abBreite: 'xxl',
      render: (_t, z) =>
        z.art === 'einheit' && z.funkrufname ? (
          <span style={monoStil(12)}>{z.funkrufname}</span>
        ) : null,
    },
    // Die Mittelverteilung ist Zusatz zum Einheitenstatus, keine Vergleichsachse — sie weicht
    // zuerst (Zähler im Spaltenschalter); die Statusspalte nennt einen Ausfall als Wort. Der Kopf
    // heißt wie die Gruppe der Zellen und trägt ihre Legende (LFH-962): das Wort der Zelle steht
    // sonst nur im `title`.
    {
      title: (
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span>Fahrzeuge und Personal</span>
          <span data-lfh="status-legende" style={{ ...monoStil(10), fontWeight: 400 }}>
            bereit · gebunden · Ausfall
          </span>
        </span>
      ),
      etikett: 'Fahrzeuge und Personal',
      key: 'mittel',
      width: 190,
      abBreite: 'xxl',
      render: (_t, z) => <MittelVerteilungZellen zeile={z} />,
    },
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

/** Besatzung eines Fahrzeugs in der Stärkespalte — gedämpft, Ist über Soll. */
function StaerkeBesatzung({ zeilen }: { zeilen: readonly string[] }) {
  const { rollen } = useRollen();
  // Untereinander und eine Stufe kleiner: hintereinander brach „Ist … · Soll …“ in der 100 px
  // breiten Spalte auf vier Zeilen (Doku-Bild, LLH-1025).
  return (
    <span
      data-lfh="meldebild-besatzung"
      style={{ ...monoStil(10), display: 'flex', flexDirection: 'column', color: rollen.gedaempft }}
    >
      {zeilen.map((z) => (
        <span key={z}>{z}</span>
      ))}
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
  gruende,
  fehler,
}: {
  zeile: RasterZeile;
  handStatus: StatusKontext['handStatus'];
  gruende: readonly string[];
  /**
   * Grund eines abgelehnten Handstatus (LFH-1077). Steht unabhängig vom Auslöser: nach einer
   * Ablehnung nimmt der Refetch ihn oft weg, weil die Einheit inzwischen ein Fahrzeug führt.
   */
  fehler: ZeilenGrund | null;
}) {
  const { token, rollen } = useRollen();
  // Der Grund der Zeilentönung als Wort (LFH-973): sichtbar in einer Spalte, die auch bei
  // 1180 px steht; der Text ist zugleich der zugängliche Name, kein abweichendes `aria-label`.
  const grund = gruende.length > 0 && (
    <span data-lfh="meldebild-toenungsgrund" style={{ fontSize: 12, fontWeight: 500 }}>
      {gruende.join(' · ')}
    </span>
  );
  let status: React.ReactNode = null;
  if (z.art === 'einheit' && z.handStatus && handStatus) status = handStatus(z);
  else if (z.status) {
    const verteilung = 'verteilung' in z.status ? z.status.verteilung : null;
    status = (
      <>
        <StatusChip
          ton={z.status.ton}
          code={z.status.code ?? undefined}
          wort={z.status.wort}
          trenner
        />
        {verteilung && (
          <span
            data-lfh="meldebild-statusverteilung"
            style={{ ...monoStil(11), color: rollen.gedaempft }}
          >
            {verteilung}
          </span>
        )}
      </>
    );
  }
  if (!status && !grund && !fehler) return null;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: token.marginXXS }}>
      {status}
      {grund}
      {fehler && <ZeilenFehler fehler={fehler.fehler} fallback={fehler.fallback} />}
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
    // Der Boden sitzt am Link (LFH-908), die Auslassung am inneren Span: `-webkit-box` und
    // `inline-flex` schließen einander aus.
    <KennungsLink to={auftraegePfad(einsatzId, { auftrag: a.id })} title={text}>
      <span
        // Zwei Zeilen mit Auslassung: eine nicht umbrechende Zeile setzte die Mindestbreite der
        // Spalte auf die Textlänge. Der Volltext steht im `title`.
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          maxWidth: AUFTRAG_BREITE,
        }}
      >
        {text}
      </span>
    </KennungsLink>
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
  const meldungenGesperrt = sprungGesperrt('meldungen');
  // Zulauf aus Nachforderungen (LLH-1384, design.md D7): nur mit Freigabe des Moduls, sonst weder
  // Abruf noch Kennzahl. Dieselben Freigaben aus dem Rahmen-Cache wie die Sprungsperre.
  const nachforderungenFrei = istKeyFreigegeben('nachforderungen', useModulFreigaben(einsatzId));
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useJetzt();

  const [filter, setFilter] = useState<FilterWerte>(LEERER_FILTER);
  /**
   * Offene Zeilen; `null` heißt „Vorgabestufe Einheiten“ (Untereinheiten sichtbar, Mittel zu).
   * Als `null` statt einer berechneten Liste, weil das Raster beim ersten Bild noch leer ist.
   */
  const [expandedKeys, setExpandedKeys] = useState<React.Key[] | null>(null);
  /** Die zuletzt gewählte Stufe: bei gleichen Schlüsselmengen gewinnt sie (`stufeVon`). */
  const [gewaehlteStufe, setGewaehlteStufe] = useState<Ausklappstufe | null>(null);
  const [filterOffen, setFilterOffen] = useState(false);
  /** Per `?einheit=` angesprungene Einheitenzeile (LLH-1049), markiert nach `deeplink-hervorhebung`. */
  const [sprungZeile, setSprungZeile] = useState<string | null>(null);

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
  // Nachweis der beendeten Kräfte (LLH-1079, LLH-1235): Blöcke unter dem Raster und im
  // Lagebericht. Scheitert ein Abruf, fehlt am Schirm nur sein Teil; der Lagebericht sagt
  // „nicht geladen“.
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.personalEntlassene(einsatzId),
    queryFn: () => listEntlassenesPersonal(einsatzId),
  });
  const fahrzeugeEntlasseneQuery = useQuery({
    queryKey: einsatzKeys.fahrzeugeEntlassene(einsatzId),
    queryFn: () => listEntlasseneFahrzeuge(einsatzId),
  });
  const materialEntlassenQuery = useQuery({
    queryKey: einsatzKeys.materialEntlassene(einsatzId),
    queryFn: () => listEntlassenesMaterial(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
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
  // Nur offene (LFH-1071): das Raster wertet nur offene und laufende Aufträge aus. Derselbe Cache
  // wie die ungefilterte Offen-Ansicht des Auftragsboards.
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraegePhase(einsatzId, 'offen', 'alle', 'alle'),
    queryFn: () => listeOffeneAuftraege(einsatzId),
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
  // Fünfter Zusatzabruf (LLH-1384): derselbe Cache wie das Board, live über `nachforderung`.
  // Scheitert er, fehlt nur die Kennzahl „Zulauf“.
  const nachforderungenQuery = useQuery({
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
    enabled: nachforderungenFrei,
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
        // Ungefiltert: „fährt auf“ nennt auch ein weggefiltertes Fahrzeug, und die Besatzung Ist
        // zählt alle Kräfte auf dem Fahrzeug (D4).
        quelle: {
          einheiten: einheitenQuery.data ?? [],
          personal: personalQuery.data ?? [],
          fahrzeuge: fahrzeugeQuery.data ?? [],
        },
      }),
    [
      gefiltertRoh,
      statusKatalogQuery.data,
      auftraegeQuery.data,
      einheitenQuery.data,
      personalQuery.data,
      fahrzeugeQuery.data,
    ],
  );
  const offeneSchluessel = useMemo(
    () => expandedKeys ?? schluesselBisStufe(raster, 'einheiten'),
    [expandedKeys, raster],
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
    // Rekursiv: auch Untereinheiten tragen eine Rückmeldung (D12).
    for (const z of einheitZeilen(raster)) {
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
   * Zulauf (LLH-1384): nur mit lesbaren Daten. Zählt nicht in Stärke, Einheiten oder Personal
   * (design.md D3); bei gesetztem Filter blendet die Seite ihn unten aus (D8). Hängt an `jetzt`:
   * „überfällig“ schlägt mit der Uhr um.
   */
  const nachforderungenDaten =
    nachforderungenFrei && abrufZustand(nachforderungenQuery) === 'daten'
      ? nachforderungenQuery.data
      : undefined;
  const zulauf = useMemo(
    () =>
      nachforderungenDaten
        ? zulaufBand(nachforderungenDaten, jetzt.valueOf(), (utc) =>
            formatUhrzeitMitTag(utc, konventionen),
          )
        : null,
    [nachforderungenDaten, jetzt, konventionen],
  );

  /**
   * Handstatus einer Einheit ohne Fahrzeug. Kein optimistisches Update: der Status ist eine
   * Ableitung des Servers, und die Antwort trägt ihn fertig. Eine Ablehnung steht in der
   * Statuszelle der Zeile, bis zum nächsten Handstatus dort (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“).
   */
  const handFehler = useZeilenFehler<number>();
  const handStatusMutation = useMutation({
    mutationFn: (v: { eid: number; statusId: number | null }) =>
      setzeEinheitStatus(einsatzId, v.eid, v.statusId),
    onMutate: (v) => handFehler.beginne(v.eid),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
    // Auch der Fehlerweg holt den Serverstand: ein 422 heißt meist, dass die Einheit inzwischen ein
    // Fahrzeug hat — ohne Refetch bliebe der Auslöser stehen.
    onError: (e, v) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      handFehler.melde(v.eid, e, 'Status nicht gesetzt');
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
  const darfSchreibenFrueh = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;
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

  // Das Blatt trägt nur die Grundspalten (LFH-1109). Die Zusatzspalten stehen am Schirm ab `xxl`
  // oder per Handwahl; auf A4 hoch ließen sie der Einheitenspalte neben den Mindestbreiten der
  // übrigen neun Spalten gut 120 px, Namen brachen silbenweise (`e2e/meldebild-druck.spec.ts`,
  // Lesbarkeit mit eingeblendeten Zusatzspalten). Über den Druckmodus, nicht über `@media print`:
  // eine ausgeblendete Zelle ließe ihre `col` stehen.
  const druckt = useDruckModus();
  const spalten = useMemo(
    () =>
      rasterSpalten(
        einsatzId,
        auftraegeZustand,
        {
          zeit: (utc) => formatUhrzeitMitTag(utc, konventionen),
          handStatus,
          handFehler: handFehler.grund,
        },
        { zustand: rueckmeldungZustand, jeZeile: rueckmeldungJeZeile },
        { zustand: periodenZustand, jeEinheit: imEinsatzJeEinheit },
        sprungGesperrt,
      ).filter((spalte) => !druckt || !NUR_AM_SCHIRM.has(spalte.key)),
    [
      druckt,
      einsatzId,
      auftraegeZustand,
      konventionen,
      handStatus,
      handFehler.grund,
      rueckmeldungZustand,
      rueckmeldungJeZeile,
      periodenZustand,
      imEinsatzJeEinheit,
      sprungGesperrt,
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
        // Ungefiltert wie am Schirm: „fährt auf“ und Besatzung Ist (D4, D10).
        {
          einheiten: einheitenQuery.data ?? [],
          personal: personalQuery.data ?? [],
          fahrzeuge: fahrzeugeQuery.data ?? [],
        },
      );
      // Gefiltert gilt der Bericht einer Auswahl; die Entlassenen gehören zu keiner mehr.
      const md = rendereMeldebildMarkdown(
        bild,
        stand,
        gefiltert
          ? undefined
          : {
              personal: entlasseneQuery.data ? toEntlassene(entlasseneQuery.data) : null,
              fahrzeuge: fahrzeugeEntlasseneQuery.data
                ? toEntlasseneFahrzeuge(fahrzeugeEntlasseneQuery.data)
                : null,
              material: materialEntlassenQuery.data
                ? toHerausgenommenesMaterial(materialEntlassenQuery.data)
                : null,
              dtg: (iso) => taktischeDtgVoll(iso, konventionen),
            },
      );
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
  // Vorgabe „Einheiten“ (Ruben, 13.10.2026): die Gliederung steht offen, die Mittel sind Detail —
  // die Einheitenzeile trägt Stärke, Verteilung und Auftrag schon selbst.
  useEffect(() => {
    setExpandedKeys(null);
    setGewaehlteStufe(null);
    setFilter(LEERER_FILTER);
    setSprungZeile(null);
  }, [einsatzId]);

  // Sprung auf eine Einheit (LLH-1049, Spec `kraeftebaum`, „Sprung auf eine Einheit“): Vorfahren
  // und Teilbaum bis „mit Fahrzeugen“ auf, die übrigen Zeilen in der Vorgabestufe. Erst mit
  // frischen Listen: nach dem Bilden steht noch der alte Cache, in dem die Einheit fehlt. Eine
  // gescheiterte Mittel-Liste (Modul ohne Freigabe) hält den Sprung nicht auf. Steht NACH dem
  // Rücksetzen oben, sonst räumte es beim ersten Bild den Sprung wieder ab. Eine unbekannte oder
  // fremde ID lässt die Vorgabe ohne Markierung.
  const listenFrisch =
    einheitenQuery.isSuccess &&
    [einheitenQuery, personalQuery, fahrzeugeQuery].every((q) => !q.isPending && !q.isFetching);
  useQueryParamSelektion('einheit', listenFrisch, (eid) => {
    const ziel = `eh-${eid}`;
    const sprung = schluesselZumSprung(raster, ziel);
    if (!sprung) return;
    setExpandedKeys([...new Set([...offeneSchluessel.map(String), ...sprung])]);
    setSprungZeile(ziel);
  });
  useEffect(() => {
    if (sprungZeile != null) scrolleZurZeile(sprungZeile);
  }, [sprungZeile]);

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  /** Ältester erfolgreicher Listenabruf — trägt Kopfzeile UND Druckstand. */
  const datenstand = gemeinsamerDatenstand(
    einheitenQuery.dataUpdatedAt,
    personalQuery.dataUpdatedAt,
    fahrzeugeQuery.dataUpdatedAt,
    materialQuery.dataUpdatedAt,
    abschnitteQuery.dataUpdatedAt,
  );

  /**
   * Die Stufe, die die offenen Zeilen gerade zeigen — trägt den Zustand des Umschalters. Als
   * benannte Zwischenvariable, nicht inline im `value` — `datensicht.guard.test.ts` liest aus dem
   * Schalter-Attribut eine „Reiterachse"; hier liest der Schalter die Daten, nicht umgekehrt.
   */
  const stufe = stufeVon(raster, offeneSchluessel, gewaehlteStufe);

  const abschnittName = (aid: number) =>
    (abschnitteQuery.data ?? []).find((a) => a.id === aid)?.name ?? `Abschnitt ${aid}`;
  const chips = aktiveFilterChips(filter, abschnittName);
  const gefiltert = chips.length > 0;
  /** „Kräfte" = Personal + Fahrzeuge, kein Material (eigene Statusachse). */
  const sichtbareKraefte = v.anzahlPersonal + v.anzahlFahrzeuge;
  const alleKraefte = gesamt.anzahlPersonal + gesamt.anzahlFahrzeuge;
  // Rekursiv (D12): eine Untereinheit ist eine Einheit der Auswahl.
  const einheitenZeilen = einheitZeilen(raster).filter((z) => z.einheitId != null).length;
  /** Die zwei Filter hinter „Filter (n)“ — Abschnitt steht im Kopf, die Suche offen. */
  const filterZahl = (filter.traeger ? 1 : 0) + (filter.kategorie ? 1 : 0);

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
        titel={modulName('kraefteuebersicht')}
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: modulName('kraefteuebersicht') },
            ]}
          />
        }
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
                title={einheitenGesperrt ? KEINE_BERECHTIGUNG : undefined}
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
            // Eine Marke, kein Satz (LFH-1078): Träger, Status und Suche treffen nur die Mittel,
            // das Einheitenband zählt weiter alle Einheiten (des gewählten Abschnitts).
            einheitenHinweis={
              filter.traeger || filter.kategorie || filter.suche.trim()
                ? filter.abschnittId != null
                  ? 'nur nach Abschnitt gefiltert'
                  : 'ungefiltert'
                : null
            }
            personal={band.personal}
            rueckmeldung={band.rueckmeldung}
            // Der Zulauf gehört zu keiner Auswahl (design.md D8, wie die Entlassenen im
            // Lagebericht): gefiltert entfällt er.
            zulauf={gefiltert ? null : zulauf}
            zulaufZiel={nachforderungenPfad(einsatzId)}
            // Die Rückmeldungen stehen im Modul Meldungen; gesperrt: Kennzahl ohne Sprung.
            rueckmeldungZiel={meldungenGesperrt ? undefined : meldungenPfad(einsatzId)}
            zustand={listenFehler ? 'fehler' : listenLaden ? 'laden' : 'daten'}
            onNeuladen={() => {
              void personalQuery.refetch();
              void fahrzeugeQuery.refetch();
              void einheitenQuery.refetch();
            }}
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
          {/* Ein schlichtes Feld: `Input.Search` brächte einen Lupenknopf mit dem englischen
              Namen „search“ mit, und die Suche wirkt ohnehin bei jeder Eingabe. */}
          <Input
            placeholder="Suche..."
            aria-label="Einheiten und Kräfte durchsuchen"
            allowClear
            style={{ flex: '1 1 180px', minWidth: 0, maxWidth: 280 }}
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          />
          {/* Träger und Status hinter einem Knopf (D9): die Zeile bleibt bei 1366 px einzeilig.
              Gesetzte Filter stehen trotzdem sichtbar als Marken davor, der Knopf nennt ihre
              Zahl. */}
          <Popover
            trigger="click"
            placement="bottomRight"
            open={filterOffen}
            onOpenChange={setFilterOffen}
            content={
              <div
                data-lfh="meldebild-filter"
                style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
              >
                <Select
                  placeholder="Trägerorganisation"
                  aria-label="Nach Trägerorganisation filtern"
                  allowClear
                  style={{ minWidth: 220 }}
                  value={filter.traeger ?? undefined}
                  options={traeger.map((t) => ({ value: t, label: t }))}
                  onChange={(wert) => setFilter((f) => ({ ...f, traeger: wert ?? null }))}
                />
                {/* Der vierte Eimer („ohne Status") bleibt draußen: `filtereKraefte` vergleicht
                    `kat === f.kategorie`, ein Wert `'ohne'` träfe nie eine Zeile. */}
                <Select
                  placeholder="Status"
                  aria-label="Nach Status filtern"
                  allowClear
                  style={{ minWidth: 220 }}
                  value={filter.kategorie ?? undefined}
                  options={KATEGORIE_WERTE.filter((w) => w.value !== 'ohne').map((w) => ({
                    value: w.value as StatusKategorie,
                    label: w.text,
                  }))}
                  onChange={(wert) => setFilter((f) => ({ ...f, kategorie: wert ?? null }))}
                />
              </div>
            }
          >
            <Button
              aria-expanded={filterOffen}
              icon={
                <span aria-hidden style={{ display: 'inline-flex' }}>
                  <IconTrichter />
                </span>
              }
            >
              {filterZahl > 0 ? `Filter (${filterZahl})` : 'Filter'}
            </Button>
          </Popover>
          {/* Drei Stufen desselben Baums. Der Wert wird aus den offenen Schlüsseln abgeleitet
              (`stufeVon`) — klappt jemand eine Zeile von Hand, zeigt die Leiste die größte Stufe,
              die noch ganz offen steht, sonst „Einheiten“; ein Klick darauf stellt sie wieder her. */}
          <Segmentleiste<Ausklappstufe>
            beschriftung="Ausklappstufe des Kräftebaums"
            wert={stufe}
            onWechsel={(wert) => {
              setGewaehlteStufe(wert);
              setExpandedKeys(schluesselBisStufe(raster, wert));
            }}
            optionen={[
              { wert: 'einheiten', label: 'Einheiten' },
              { wert: 'fahrzeuge', label: 'mit Fahrzeugen' },
              { wert: 'alles', label: 'alles' },
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
          <DruckKnopf
            vorbereiten={() => {
              setGewaehlteStufe('alles');
              setExpandedKeys(schluesselBisStufe(raster, 'alles'));
            }}
          />
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
          baum={{
            kinder: 'children',
            aufgeklappt: offeneSchluessel,
            onAufgeklappt: setExpandedKeys,
          }}
          zeilenKlasse={(z) =>
            [
              istProblemZeile(z) || istRueckmeldungProblem(rueckmeldungJeZeile.get(z.key))
                ? 'meldebild-problemzeile'
                : null,
              z.key === sprungZeile ? HERVORGEHOBEN : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          karte={{
            art: 'plan',
            titel: { spalte: 'einheit' },
            sekundaer: ['abschnitt', 'staerke', 'auftrag'],
          }}
        />
        {!gefiltert && (
          <>
            {/* Personen und Fahrzeuge in einem Block wie im Lagebericht (LLH-1235). */}
            <EntlassenBlock
              titel="Entlassen"
              endeWort="entlassen"
              aufgeklappt={druckt}
              eintraege={[
                ...(entlasseneQuery.data ?? []).map((ep) => ({
                  id: ep.id,
                  schluessel: `person-${ep.id}`,
                  name: ep.name,
                  zusatz: funktionText(ep),
                  beendetAt: ep.beendet_at,
                })),
                ...(fahrzeugeEntlasseneQuery.data ?? []).map((ef) => ({
                  id: ef.id,
                  schluessel: `fahrzeug-${ef.id}`,
                  name: ef.funkrufname,
                  zusatz: ef.fahrzeugtyp,
                  beendetAt: ef.beendet_at,
                })),
              ]}
            />
            <EntlassenBlock
              titel="Aus dem Einsatz genommen"
              endeWort="aus dem Einsatz genommen"
              aufgeklappt={druckt}
              eintraege={(materialEntlassenQuery.data ?? []).map((em) => ({
                id: em.id,
                name: em.bezeichnung,
                zusatz: `×${em.menge}`,
                beendetAt: em.beendet_at,
              }))}
            />
          </>
        )}
      </EinsatzSeite>
    </div>
  );
}
