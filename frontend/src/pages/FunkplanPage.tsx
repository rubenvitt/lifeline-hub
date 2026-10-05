import { Breadcrumb, Button, Flex, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { taktischeDtgVoll } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ladeEinsatz, ladeFuehrungsstelle } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { ladeFernmeldeskizze } from '../api/fernmeldeskizze';
import { ladeKommunikationsplan } from '../api/kommunikationsplan';
import { legeLageberichtAn } from '../api/lageberichte';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import { useAuth } from '../auth/AuthContext';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { useDruckModus } from '../components/druck/useDruckModus';
import { Paneel, PaneelZeile, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useOhneVerbindung } from '../offline/verbindung';
import {
  einheitDetailPfad,
  einsatzabschnittePfad,
  einsatzdatenPfad,
  fahrzeugePfad,
  kommunikationsplanPfad,
  lageberichtDetailPfad,
  parseFunkplanAnsicht,
  stabPfad,
  type FunkplanAnsicht,
} from '../routing/deeplinks';
import { baueFernmeldenetz, type Fernmeldenetz } from '../stab/fernmeldeskizze';
import FernmeldeskizzeBild from '../stab/FernmeldeskizzeBild';
import {
  DRUCKFORMAT_VORGABE,
  skizzenDruckKlasse,
  type Druckformat,
} from '../stab/skizze/druckformat';
import { Befehlsstapel } from '../stab/skizzenBefehle';
import {
  GEGENSTELLE_HINWEIS,
  ZUSTAND_GRUND,
  fehlendeQuellen,
  strukturVollstaendig,
  aufklappbareSchluessel,
  baueFunkplan,
  funkplanLuecken,
  gegenstelleHinweis,
  rendereFunkplanMarkdown,
  type FunkplanQuellen,
  type FunkplanZeile,
} from '../stab/funkplan';
import type { FuehrungsstelleQuelle } from '../stab/fuehrungsstelle';
import type { Luecke, Quelle, SkizzenQuelle, Verbindung } from '../stab/luecken';
import type { SkizzenAktionen } from '../stab/skizzenAktionen';
import {
  HERKUNFT_LABEL,
  baueSprechgruppenplan,
  fehlendText,
  sprechgruppenplanLeerText,
  type SprechgruppenZeile,
  type TeilnehmerAngabe,
} from '../stab/sprechgruppenplan';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { skizzenRechte, useSkizzenAktionen } from '../stab/useSkizzenAktionen';
import { stabFreigabeAnzeige, useStabFreigabe } from '../stab/useStabFreigabe';
import './funkplanPrint.css';

/**
 * Funkplan des Sachgebiets S6 (FwDV 100 Anlage 5, LFH-548): eine schreibgeschützte, aus dem
 * Bestand abgeleitete Tabelle Abschnitt → Einheit → Fahrzeug. Herleitung:
 * `openspec/changes/archive/2026-09-30-lfh-548-funkplan/design.md`.
 *
 * - **Ort:** Unterroute des Stabs (`funkplanPfad`), Einstieg in der S6-Zeile der Stabseite. Kein
 *   eigenes Modul; Sperre und Sichtbarkeit erbt die Seite vom Stab (D1).
 * - **Daten:** fünf bestehende Listen, jede mit eigener Rechteweiche. Eine gesperrte Liste ist
 *   kein leerer Bestand: ihre Ebene fehlt, und der Grund steht oberhalb der Tabelle (D2). Eine
 *   Liste eines fremden Moduls läuft nur bei Freigabe des Servers (LFH-669, Spec
 *   `modul-freigabe`); ist ihr Modul gesperrt, geht sie ohne Anfrage durch dieselbe Weiche wie
 *   ein 403. Die Sprechgruppen gehören keinem Modul (`PFAD_KEY`), ebenso die eigene
 *   Führungsstelle als sechste Quelle (LFH-849, gepflegt auf den Einsatzdaten): erfasst steht
 *   sie als erste Zeile, sonst nennt das Lücken-Paneel sie.
 * - **Form:** `form="tabelle"` in jeder Breite (Vergleichsfläche, `NUR_TABELLE`). Kein Suchen,
 *   Sortieren oder Filtern, die Ordnung ist der Baum (D3, D4). Bearbeitet wird am Datensatz, jede
 *   Zeile führt über ihre Kennung dorthin (D7).
 * - **Erreichbarkeit** ist personenbezogen: am Schirm ab `xl`, im Druck immer, im Lagebericht nie
 *   (D5, Entscheidung 30.09.2026).
 * - **Drei Darstellungen** (LFH-625, `openspec/changes/archive/2026-10-01-lfh-625-fernmeldeskizze/design.md` D1, D6;
 *   LFH-848, `openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md` D8): „Tabelle“, „Skizze“
 *   (Fernmeldeskizze, `stab/FernmeldeskizzeBild.tsx`) und „Sprechgruppen“ (Kanalbelegung,
 *   `stab/sprechgruppenplan.ts`). Dieselben Quellen, dasselbe Lücken-Paneel, dieselbe Übernahme
 *   (sie schreibt immer die Tabelle); eine Druckwurzel, der Druckkopf nennt die aktive
 *   Darstellung. Die Tabelle klappt, die Sprechgruppen sind flach.
 * - **Taktische Fernmeldeskizze** (LFH-893, `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/
 *   design.md`): zwei weitere Quellen mit eigener Weiche — die Stellen des Kommunikationsplans und
 *   die Daten der Skizze (ohne Netz „nicht geladen“, die Skizze ist nicht offline). Das Netz
 *   (`baueFernmeldenetz`) entsteht EINMAL und speist Skizze, Lücken-Paneel und Übernahme; das
 *   Paneel trägt dazu „Sprechgruppen mit nur einem Teilnehmer“ und die Lücke „Leitstelle“. In der
 *   Skizze wählt ein Klick auf einen Betroffenen das Element. Bearbeitet wird nur mit
 *   Schreibrecht und Verbindung (`useSkizzenAktionen`, sonst schreibgeschützt). Der Druck der
 *   Skizze hängt die Funkplan-Tabelle als Anlage ab neuer Seite an (`data-lfh="druck-anlage"`).
 */

type SpalteKey =
  'stelle' | 'rufname' | 'leitung' | 'tmo' | 'dmo' | 'kommunikation' | 'erreichbarkeit';

/**
 * Eine Liste als Quelle des Funkplans, identitätsstabil je Daten und Zustand. Ein Fehler MIT
 * Daten ist ein Stand, kein Ausfall (der Datenstand im Kopf zeigt sein Alter). Ohne Freigabe ihres
 * Moduls (`frei: false`) ist sie `gesperrt` wie bei einem 403 und trägt keine Daten, auch keinen
 * Altstand aus dem Cache (LFH-669).
 */
function useQuelle<T>(
  q: {
    data: T[] | undefined;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  },
  frei = true,
  ohneVerbindung = false,
): Quelle<T> {
  // `ohneVerbindung`: ein ohne Netz pausierter Abruf ohne Stand ist „nicht geladen“, nicht „lädt“.
  const zustand: AbrufZustand = !frei
    ? 'gesperrt'
    : q.data != null
      ? 'daten'
      : ohneVerbindung
        ? 'fehler'
        : abrufZustand(q);
  const data = frei ? q.data : undefined;
  return useMemo(() => ({ zustand, daten: data ?? [] }), [zustand, data]);
}

/** Die eigene Führungsstelle als Quelle (LFH-849), mit derselben Weiche wie die Listen. */
function useFuehrungsstelleQuelle(q: {
  data: FuehrungsstelleQuelle['daten'] | undefined;
  error: unknown;
  isError: boolean;
  isPending: boolean;
}): FuehrungsstelleQuelle {
  const zustand: AbrufZustand = q.data != null ? 'daten' : abrufZustand(q);
  const data = q.data ?? null;
  return useMemo(() => ({ zustand, daten: data }), [zustand, data]);
}

function Mono({ children }: { children: ReactNode }) {
  return <span style={monoStil(12)}>{children}</span>;
}

/** Leerzelle: „—" als Text, gedämpft. Mit Grund, wenn die Quelle fehlt. */
function Leer({ grund }: { grund?: string }) {
  const { rollen } = useRollen();
  return <span style={{ color: rollen.gedaempft }}>—{grund ? ` · ${grund}` : ''}</span>;
}

function Untereinander({ werte }: { werte: string[] }) {
  if (werte.length === 0) return <Leer />;
  return (
    <Flex vertical>
      {werte.map((w) => (
        <Mono key={w}>{w}</Mono>
      ))}
    </Flex>
  );
}

function StelleZelle({ zeile: z }: { zeile: FunkplanZeile }) {
  const { rollen } = useRollen();
  if (z.art === 'sammel') {
    return <span style={{ color: rollen.gedaempft, fontStyle: 'italic' }}>{z.stelle}</span>;
  }
  return (
    // Umbrechend: die Kennung wird gelesen, nicht verglichen. Ein langer Fahrzeug-Funkrufname
    // (gemessen 245 px in Mono 12) bricht in der 240er-Spalte um, statt die Summe zu sprengen.
    <span style={{ overflowWrap: 'anywhere' }}>
      {z.art === 'fahrzeug' ? <Mono>{z.stelle}</Mono> : z.stelle}
      {z.stelleZusatz && (
        <>
          {' · '}
          <span style={{ color: rollen.gedaempft }}>{z.stelleZusatz}</span>
        </>
      )}
    </span>
  );
}

function LeitungZelle({ zeile: z }: { zeile: FunkplanZeile }) {
  if (z.art === 'sammel') return null;
  if (z.leitung.art === 'name') return <>{z.leitung.namen.join(', ')}</>;
  if (z.leitung.art === 'zustand') {
    return <Leer grund={`Personal ${ZUSTAND_GRUND[z.leitung.zustand]}`} />;
  }
  return <Leer />;
}

/**
 * Spalten. Breiten aus der Messung vor dem Bau (design.md D4, Nachtrag): Σ Zahlbreiten 860 +
 * `mindestBreite` 160 = 1020 px bei 1050 px Contentbreite am Fükw mit offenem Panel. Genau EINE
 * fließende Spalte (Leiter/Führer), alle übrigen mit Zahlbreite (LFH-523).
 */
function funkplanSpalten(druckt: boolean) {
  return spaltenFuer<FunkplanZeile>()([
    {
      title: 'Stelle',
      key: 'stelle' as SpalteKey,
      width: 240,
      immerSichtbar: true,
      render: (_t, z) => <StelleZelle zeile={z} />,
    },
    {
      title: 'Rufname/OPTA',
      key: 'rufname' as SpalteKey,
      width: 150,
      render: (_t, z) =>
        z.art === 'sammel' ? null : z.rufname ? <Mono>{z.rufname}</Mono> : <Leer />,
    },
    {
      title: 'Leiter/Führer',
      key: 'leitung' as SpalteKey,
      mindestBreite: 160,
      render: (_t, z) => <LeitungZelle zeile={z} />,
    },
    {
      title: 'TMO',
      key: 'tmo' as SpalteKey,
      width: 110,
      render: (_t, z) =>
        z.art === 'sammel' || z.art === 'fahrzeug' ? null : <Untereinander werte={z.tmo} />,
    },
    {
      title: 'DMO',
      key: 'dmo' as SpalteKey,
      width: 110,
      render: (_t, z) =>
        z.art === 'sammel' || z.art === 'fahrzeug' ? null : <Untereinander werte={z.dmo} />,
    },
    {
      title: 'Kommunikationsmittel',
      key: 'kommunikation' as SpalteKey,
      width: 110,
      render: (_t, z) =>
        z.art === 'sammel' || z.art === 'fahrzeug' ? null : (z.kommunikationsmittel ?? <Leer />),
    },
    {
      title: 'Erreichbarkeit',
      key: 'erreichbarkeit' as SpalteKey,
      width: 140,
      // Personenbezogen: am Schirm erst ab `xl`. `abBreite` misst die Fensterbreite, nicht
      // `@media print` — im Druck deshalb ohne, sonst verlöre ein Ausdruck aus schmalem Fenster
      // die Spalte (D5; beide Druckwege laufen über `beforeprint`).
      ...(druckt ? {} : { abBreite: 'xl' as const }),
      render: (_t, z) =>
        z.art === 'sammel' || z.art === 'fahrzeug' ? null : z.erreichbarkeit ? (
          <Mono>{z.erreichbarkeit}</Mono>
        ) : (
          <Leer />
        ),
    },
  ]);
}

type SprechgruppenSpalteKey =
  'sprechgruppe' | 'betriebsart' | 'hinweis' | 'herkunft' | 'teilnehmer';

/** Teilnehmer einer Sprechgruppe: je Stelle der Verweis auf ihren Datensatz und ihr Rufname. */
function TeilnehmerZelle({ angabe }: { angabe: TeilnehmerAngabe }) {
  const { token, rollen } = useRollen();
  // Ohne alle Strukturquellen ist „keine“ nicht belegt: der Grund steht da (design.md D8).
  if (angabe.art === 'unbekannt') return <Leer grund={fehlendText(angabe.fehlend)} />;
  if (angabe.teilnehmer.length === 0) return <span style={{ color: rollen.gedaempft }}>keine</span>;
  return (
    <Flex vertical>
      {angabe.teilnehmer.map((t) => (
        <Flex key={t.key} wrap align="center" style={{ overflowWrap: 'anywhere' }}>
          {t.ziel ? (
            <Link to={t.ziel} style={stabZeilenzielStil(token)}>
              {t.name}
            </Link>
          ) : (
            // Eine Komponente lebt nur in der Skizze: kein Pflegeort außerhalb.
            <span style={stabZeilenzielStil(token)}>{t.name}</span>
          )}
          {t.rufname && <Mono>{t.rufname}</Mono>}
          {/* Eine geplante Teilnahme ist keine Tatsache (LFH-893 D7): das Wort steht da. */}
          {t.status === 'geplant' && <span style={{ color: rollen.gedaempft }}>geplant</span>}
        </Flex>
      ))}
      {angabe.art === 'unvollstaendig' && (
        <span style={{ color: rollen.gedaempft }}>
          {`unvollständig · ${fehlendText(angabe.fehlend)}`}
        </span>
      )}
    </Flex>
  );
}

/**
 * Spalten der Darstellung „Sprechgruppen“ (design.md D8). Gegen dieselbe Fläche gewählt wie die
 * Tabelle (LFH-548 D4: 1050 px Contentbreite am Fükw mit offenem Panel): Σ Zahlbreiten 630 +
 * `mindestBreite` 300 = 930 px, Rest als Reserve. EINE fließende Spalte (Teilnehmer, LFH-523);
 * Kennung und Hinweis brechen um, statt die Summe zu sprengen. Im Druck neutralisiert
 * `druck/druck.css` die Breiten (A4 ohne Überhang, `e2e/funkplan-druck.spec.ts`).
 */
function sprechgruppenSpalten() {
  return spaltenFuer<SprechgruppenZeile>()([
    {
      title: 'Sprechgruppe',
      key: 'sprechgruppe' as SprechgruppenSpalteKey,
      width: 200,
      immerSichtbar: true,
      render: (_t, z) => (
        <span style={{ overflowWrap: 'anywhere' }}>
          <Mono>{z.bezeichnung}</Mono>
        </span>
      ),
    },
    {
      title: 'Betriebsart',
      key: 'betriebsart' as SprechgruppenSpalteKey,
      width: 100,
      render: (_t, z) => <Mono>{z.betriebsart}</Mono>,
    },
    {
      title: 'Hinweis',
      key: 'hinweis' as SprechgruppenSpalteKey,
      width: 220,
      render: (_t, z) =>
        z.hinweis ? <span style={{ overflowWrap: 'anywhere' }}>{z.hinweis}</span> : <Leer />,
    },
    {
      title: 'Herkunft',
      key: 'herkunft' as SprechgruppenSpalteKey,
      width: 110,
      render: (_t, z) => HERKUNFT_LABEL[z.herkunft],
    },
    {
      title: 'Teilnehmer',
      key: 'teilnehmer' as SprechgruppenSpalteKey,
      mindestBreite: 300,
      render: (_t, z) => <TeilnehmerZelle angabe={z.teilnehmer} />,
    },
  ]);
}

/** Höchstens so viele Betroffene je Lücke, danach „+n weitere". */
const TREFFER_DECKEL = 5;

/** Ein Betroffener einer Lücke; `element` ist sein Schlüssel in der Skizze (`ab-1`, `sg-3` …). */
interface LueckenTreffer {
  key: Key;
  name: string;
  ziel: string | null;
  element?: string;
}

/**
 * Wahl statt Verweis (LFH-893, Spec „Lücken am Bild“): in der Skizze wählt der Betroffene sein
 * Element, statt die Seite zu verlassen. Ein Knopf mit der Trefffläche der Lücken-Verweise.
 */
function WahlKnopf({ name, onWahl }: { name: string; onWahl: () => void }) {
  const { token } = useRollen();
  return (
    <button
      type="button"
      onClick={onWahl}
      style={{
        ...stabZeilenzielStil(token),
        background: 'none',
        border: 'none',
        font: 'inherit',
        color: 'inherit',
        cursor: 'pointer',
        textDecoration: 'underline',
      }}
    >
      {name}
    </button>
  );
}

function LueckenZeile<T>({
  titel,
  luecke,
  treffer,
  letzte = false,
  onWahl,
}: {
  titel: string;
  luecke: Luecke<T>;
  treffer: (x: T) => LueckenTreffer;
  letzte?: boolean;
  /** Nur in der Skizze: ein Betroffener mit `element` wählt sein Element. */
  onWahl?: (element: string) => void;
}) {
  const { token, rollen } = useRollen();
  const gezeigt = luecke.treffer.slice(0, TREFFER_DECKEL).map(treffer);
  const rest = luecke.treffer.length - gezeigt.length;
  return (
    <PaneelZeile style={letzte ? { borderBlockEnd: 'none' } : undefined}>
      <div data-lfh="funkplan-luecke">
        <Flex wrap align="baseline" gap={token.marginXS}>
          <span>{titel}</span>
          {luecke.zustand === 'daten' ? (
            <span style={monoStil(14, 500)}>{luecke.treffer.length}</span>
          ) : (
            <>
              <span style={monoStil(14, 500)}>—</span>
              <span style={{ color: rollen.gedaempft }}>{ZUSTAND_GRUND[luecke.zustand]}</span>
            </>
          )}
        </Flex>
        {gezeigt.length > 0 && (
          <Flex wrap align="center">
            {gezeigt.map((t) =>
              onWahl && t.element ? (
                <WahlKnopf key={t.key} name={t.name} onWahl={() => onWahl(t.element!)} />
              ) : t.ziel ? (
                <Link key={t.key} to={t.ziel} style={stabZeilenzielStil(token)}>
                  {t.name}
                </Link>
              ) : (
                <span key={t.key} style={{ ...stabZeilenzielStil(token), ...monoStil(12) }}>
                  {t.name}
                </span>
              ),
            )}
            {rest > 0 && <span style={{ color: rollen.gedaempft }}>+{rest} weitere</span>}
          </Flex>
        )}
      </div>
    </PaneelZeile>
  );
}

/**
 * Leertext der Tabelle: „kein Bestand“ nur, wenn alle drei Strukturquellen geladen sind. Sonst
 * steht der Grund da, gruppiert nach Grund („Abschnitte, Einheiten: nicht freigegeben“).
 */
function leerTextFuer(quellen: FunkplanQuellen): string {
  if (strukturVollstaendig(quellen))
    return 'Weder Abschnitte noch Einheiten noch Fahrzeuge im Einsatz';
  const struktur = fehlendeQuellen(quellen).filter((f) => f.quelle !== 'personal');
  const jeGrund = new Map<string, string[]>();
  for (const f of struktur) {
    const grund = ZUSTAND_GRUND[f.zustand];
    jeGrund.set(grund, [...(jeGrund.get(grund) ?? []), f.name]);
  }
  return `Keine Zeilen darstellbar — ${[...jeGrund]
    .map(([grund, namen]) => `${namen.join(', ')}: ${grund}`)
    .join(' · ')}`;
}

/** Was der Seitenkopf zählt; eine gesperrte Liste zählt nicht mit (keine „0"). */
const FUNKPLAN_SEITE = { titel: 'Funkplan', mitArtikel: 'der Funkplan' };

const DARSTELLUNG_OPTIONEN = [
  { wert: 'tabelle', label: 'Tabelle' },
  { wert: 'skizze', label: 'Skizze' },
  { wert: 'sprechgruppen', label: 'Sprechgruppen' },
] as const satisfies readonly { wert: FunkplanAnsicht; label: string }[];

const UMFANG: { quelle: 'abschnitte' | 'einheiten' | 'fahrzeuge'; wort: string }[] = [
  { quelle: 'abschnitte', wort: 'Abschnitte' },
  { quelle: 'einheiten', wort: 'Einheiten' },
  { quelle: 'fahrzeuge', wort: 'Fahrzeuge' },
];

/**
 * Die Skizze mit ihren Quellzuständen (LFH-625 D5, LFH-893): ohne Abschnitte gibt es keine
 * Fläche, nur den Grund. Jede übrige fehlende Quelle (Einheiten, externe Stellen, Daten der
 * Skizze) nennt die Fläche selbst, einmal, aus `netz.fehlend` (Review O5).
 */
function SkizzenBereich({
  abschnitte,
  netz,
  aktionen,
  einsatzbezeichnung,
  gewaehlt,
  onWahl,
  druckFormat,
  onDruckFormat,
  druckt,
  befehle,
}: {
  abschnitte: AbrufZustand;
  netz: Fernmeldenetz;
  aktionen: SkizzenAktionen | null;
  einsatzbezeichnung: string;
  gewaehlt: string | null;
  onWahl: (key: string | null) => void;
  druckFormat: Druckformat;
  onDruckFormat: (f: Druckformat) => void;
  druckt: boolean;
  befehle: Befehlsstapel;
}) {
  const { rollen } = useRollen();
  if (abschnitte === 'laden') return <SeitenSkeleton />;
  if (abschnitte !== 'daten') {
    return (
      <Typography.Paragraph style={{ color: rollen.gedaempft }}>
        {`Keine Skizze darstellbar — Abschnitte: ${ZUSTAND_GRUND[abschnitte]}`}
      </Typography.Paragraph>
    );
  }
  return (
    <FernmeldeskizzeBild
      netz={netz}
      aktionen={aktionen}
      einsatzbezeichnung={einsatzbezeichnung}
      gewaehlt={gewaehlt}
      onWahl={onWahl}
      druckFormat={druckFormat}
      onDruckFormat={onDruckFormat}
      druckt={druckt}
      befehle={befehle}
    />
  );
}

/** Die Quelle „Daten der Skizze“: wie eine Liste, aber eine Angabe (`stab/luecken.ts`). */
function useSkizzenQuelle(
  q: {
    data: SkizzenQuelle['daten'] | undefined;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  },
  frei: boolean,
  ohneVerbindung: boolean,
): SkizzenQuelle {
  // Ohne Netz pausiert der Abruf und stünde für immer „lädt“: die Skizze ist nicht offline
  // (`LAGEBILD_OFFLINE`), also „nicht geladen“ — wie auf dem Kommunikationsplan.
  const zustand: AbrufZustand = !frei
    ? 'gesperrt'
    : q.data != null
      ? 'daten'
      : ohneVerbindung
        ? 'fehler'
        : abrufZustand(q);
  const data = frei ? (q.data ?? null) : null;
  return useMemo(() => ({ zustand, daten: data }), [zustand, data]);
}

export default function FunkplanPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const druckt = useDruckModus();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Die Sperre des Stabs gilt auch hier (D1): die Listen des Funkplans hängen an ANDEREN Modulen,
  // kein Endpunkt dieser Seite prüft den Stab. Fail-closed über `useStabFreigabe`.
  const stabFreigabe = useStabFreigabe(einsatzId);
  // Modulgrenze (LFH-669): eine Liste läuft erst, wenn der Stab frei ist (sonst zeigt die Seite
  // ohnehin nichts) UND der Server ihr Modul freigibt. Keys nach `PFAD_KEY`.
  const frei = (key: string) =>
    stabFreigabe.zustand === 'frei' && istKeyFreigegeben(key, stabFreigabe.freigaben);
  const abschnitteFrei = frei('einsatzabschnitte');
  const einheitenFrei = frei('einheiten');
  const fahrzeugeFrei = frei('fahrzeuge');
  const personalFrei = frei('personal');
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: abschnitteFrei,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugeFrei,
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei,
  });
  // Nicht live (`NICHT_LIVE_KEYS`): eine fremd angelegte lokale Sprechgruppe erscheint erst beim
  // nächsten Abruf. Die Zuordnungen selbst kommen live über Abschnitte und Einheiten (D10).
  const sprechgruppenQuery = useQuery({
    queryKey: einsatzKeys.sprechgruppen(einsatzId),
    queryFn: () => listeEinsatzSprechgruppen(einsatzId),
  });
  // Die eigene Führungsstelle (LFH-849): Teil der Kopfdaten, kein Modul; live über `einsatz`.
  const fuehrungsstelleQuery = useQuery({
    queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
    queryFn: () => ladeFuehrungsstelle(einsatzId),
  });
  // LFH-893: die Stellen des Kommunikationsplans (offline lesbar) und die Daten der Skizze (nicht
  // offline), beide am Stab, live über `stab`. Eigene Weiche je Quelle.
  const stabFrei = stabFreigabe.zustand === 'frei';
  const freigaben = stabFrei ? stabFreigabe.freigaben : undefined;
  const ohneVerbindung = useOhneVerbindung();
  const stellenQuery = useQuery({
    queryKey: einsatzKeys.stabKommunikationsplan(einsatzId),
    queryFn: () => ladeKommunikationsplan(einsatzId),
    enabled: stabFrei,
  });
  const skizzeQuery = useQuery({
    queryKey: einsatzKeys.stabFernmeldeskizze(einsatzId),
    queryFn: () => ladeFernmeldeskizze(einsatzId),
    enabled: stabFrei,
  });

  const abschnitte = useQuelle(abschnitteQuery, abschnitteFrei);
  const einheiten = useQuelle(einheitenQuery, einheitenFrei);
  const fahrzeuge = useQuelle(fahrzeugeQuery, fahrzeugeFrei);
  const personal = useQuelle(personalQuery, personalFrei);
  const sprechgruppen = useQuelle(sprechgruppenQuery);
  const fuehrungsstelle = useFuehrungsstelleQuelle(fuehrungsstelleQuery);
  const stellen = useQuelle(stellenQuery, stabFrei, ohneVerbindung);
  const skizzenDaten = useSkizzenQuelle(skizzeQuery, stabFrei, ohneVerbindung);
  const quellen: FunkplanQuellen = useMemo(
    () => ({ abschnitte, einheiten, fahrzeuge, personal, sprechgruppen, fuehrungsstelle }),
    [abschnitte, einheiten, fahrzeuge, personal, sprechgruppen, fuehrungsstelle],
  );
  const zeilen = useMemo(() => baueFunkplan(quellen), [quellen]);
  // Mit Stellen und Skizze: Paneel und Bild zählen dieselben Träger (Review O2).
  const luecken = useMemo(
    () => funkplanLuecken({ ...quellen, stellen, skizze: skizzenDaten }),
    [quellen, stellen, skizzenDaten],
  );

  // Das Netz EINMAL (LFH-893): Skizze, Lücken-Paneel und Übernahme lesen dasselbe. Die Rechte je
  // Quelle bestimmen, was die Fläche anbietet; ohne Verbindung bietet sie nichts an.
  const darfSkizzeSchreiben =
    darfImEinsatzSchreiben(einsatzQuery.data, benutzer) && !ohneVerbindung;
  const rechte = useMemo(
    () => (darfSkizzeSchreiben ? skizzenRechte(einsatzQuery.data, benutzer, freigaben) : undefined),
    [darfSkizzeSchreiben, einsatzQuery.data, benutzer, freigaben],
  );
  const netz = useMemo(
    () =>
      baueFernmeldenetz({
        einsatzId,
        abschnitte,
        einheiten,
        fuehrungsstelle,
        sprechgruppen,
        stellen,
        skizze: skizzenDaten,
        rechte,
      }),
    [
      einsatzId,
      abschnitte,
      einheiten,
      fuehrungsstelle,
      sprechgruppen,
      stellen,
      skizzenDaten,
      rechte,
    ],
  );
  const aktionen = useSkizzenAktionen(einsatzId, darfSkizzeSchreiben);
  // Das in der Skizze gewählte Element; das Lücken-Paneel setzt es von außen (Spec „Lücken am Bild“).
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  // Papierformat und Rückgängig-Stapel der Skizze leben in der Seite: beide überdauern einen
  // Wechsel der Darstellung, der Stapel gilt je Einsatz.
  const [druckFormat, setDruckFormat] = useState<Druckformat>(DRUCKFORMAT_VORGABE);
  const [stapelJeEinsatz] = useState(() => new Map<number, Befehlsstapel>());
  const befehle = useMemo(() => {
    const da = stapelJeEinsatz.get(einsatzId);
    if (da) return da;
    const neu = new Befehlsstapel();
    stapelJeEinsatz.set(einsatzId, neu);
    return neu;
  }, [stapelJeEinsatz, einsatzId]);

  // Zugeklappt statt aufgeklappt gemerkt: der Plan wird gelesen, also startet er offen, und eine
  // live hinzukommende Einheit steht ebenfalls offen da.
  const [zugeklappt, setZugeklappt] = useState<ReadonlySet<Key>>(new Set());
  const aufklappbar = useMemo(() => aufklappbareSchluessel(zeilen), [zeilen]);
  const aufgeklappt = aufklappbar.filter((k) => !zugeklappt.has(k));

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const stand = taktischeDtgVoll(new Date().toISOString(), konventionen);
      // EIN Aufruf mit Startinhalt (Spec `dokument-uebernahme`): der Bericht entsteht mit Text
      // oder gar nicht. Die Erreichbarkeit kennt das Markdown nicht.
      const gueltigAbRoh = netz.schriftfeld?.gueltig_ab;
      const gueltigAb = gueltigAbRoh ? taktischeDtgVoll(gueltigAbRoh, konventionen) : null;
      const text = rendereFunkplanMarkdown(zeilen, stand, luecken, quellen, { netz, gueltigAb });
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Funkplan ${stand}`,
        abschnitte: [{ schluessel: 'text', text }],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
  });

  const spalten = useMemo(() => funkplanSpalten(druckt), [druckt]);
  const sgSpalten = useMemo(() => sprechgruppenSpalten(), []);

  // ── Darstellung (LFH-625 D1, D6) ────────────────────────────────────────────────────────────
  // Sichtvorgabe ?ansicht= apply-then-clean wie auf der Abschnittsseite. Schon der erste Zustand
  // liest sie, sonst stünde mit warmem Cache für ein Bild die Tabelle da (Review LFH-625). Geräumt
  // wird auch ein unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag.
  const [searchParams, setSearchParams] = useSearchParams();
  const [ansichtNachEinsatz, setAnsichtNachEinsatz] = useState<Record<number, FunkplanAnsicht>>(
    () => {
      const vorgabe = parseFunkplanAnsicht(searchParams);
      return vorgabe ? { [einsatzId]: vorgabe } : {};
    },
  );
  const ansicht = ansichtNachEinsatz[einsatzId] ?? 'tabelle';
  const setzeAnsicht = (a: FunkplanAnsicht) =>
    setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: a }));
  useEffect(() => {
    if (!searchParams.has('ansicht')) return;
    const vorgabe = parseFunkplanAnsicht(searchParams);
    if (vorgabe) setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: vorgabe }));
    const rest = new URLSearchParams(searchParams);
    rest.delete('ansicht');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, einsatzId]);

  // Kanalbelegung (LFH-848 D8): nur gebaut, solange sie gezeigt wird. Teilnehmer sind auch
  // externe Stellen und Komponenten (LFH-893).
  const sprechgruppenplan = useMemo(
    () =>
      ansicht === 'sprechgruppen'
        ? baueSprechgruppenplan(quellen, einsatzId, { stellen, skizze: skizzenDaten })
        : [],
    [ansicht, quellen, einsatzId, stellen, skizzenDaten],
  );

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  // Fail-closed: kein Endpunkt dieser Seite prüft den Stab, die Freigabe ist die einzige Sperre.
  // Ohne ermittelte Freigabe wird nichts gezeigt (Review LFH-548).
  if (stabFreigabe.zustand !== 'frei') {
    return stabFreigabeAnzeige(stabFreigabe, FUNKPLAN_SEITE, einsatzId);
  }
  // Die Übernahme legt einen Lagebericht an: Schreibrecht im Einsatz UND das Modul Lageberichte
  // freigegeben (Freigaben vom Server, LFH-669). Solange eine Quelle lädt, stünde „lädt“ im
  // unveränderlichen Bericht.
  const darfUebernehmen =
    darfImEinsatzSchreiben(einsatz, benutzer) &&
    istKeyFreigegeben('lageberichte', stabFreigabe.freigaben);
  const quellenLaden = [...Object.values(quellen), stellen, skizzenDaten].some(
    (q) => q.zustand === 'laden',
  );

  // Ein gesperrtes Modul zählt nicht zum Stand: sein Cache-Zeitstempel gehört zu nichts Gezeigtem.
  const datenstand = gemeinsamerDatenstand(
    abschnitteFrei ? abschnitteQuery.dataUpdatedAt : undefined,
    einheitenFrei ? einheitenQuery.dataUpdatedAt : undefined,
    fahrzeugeFrei ? fahrzeugeQuery.dataUpdatedAt : undefined,
    personalFrei ? personalQuery.dataUpdatedAt : undefined,
    sprechgruppenQuery.dataUpdatedAt,
    fuehrungsstelleQuery.dataUpdatedAt,
    stellenQuery.dataUpdatedAt,
    skizzeQuery.dataUpdatedAt,
  );

  // Skizze und Sprechgruppen zeigen keine Fahrzeuge, also zählt ihr Umfang sie auch nicht (Review
  // LFH-625). Die Sprechgruppen zählen ihre Zeilen vorweg.
  const umfang = [
    ...(ansicht === 'sprechgruppen' ? [`${sprechgruppenplan.length} Sprechgruppen`] : []),
    ...UMFANG.filter(
      (u) =>
        quellen[u.quelle].zustand === 'daten' &&
        (ansicht === 'tabelle' || u.quelle !== 'fahrzeuge'),
    ).map((u) => `${quellen[u.quelle].daten.length} ${u.wort}`),
  ].join(' · ');

  const gegenstelle = gegenstelleHinweis(quellen);

  // Nur Gescheitertes und Gesperrtes: Ladendes kündigt die Tabelle selbst an.
  const fehlend = fehlendeQuellen(quellen).filter((f) => f.zustand !== 'laden');

  const abschnittZiel = (aid: number) => einsatzabschnittePfad(einsatzId, { abschnitt: aid });
  // Beide Enden stehen da, sonst läse sich der Treffer wie „ohne Sprechgruppe“. Der Verweis führt
  // zur unteren Stelle: dort wird die Sprechgruppe zugeordnet.
  const verbindungTreffer = (v: Verbindung): LueckenTreffer => ({
    key: `${v.unten.art}-${v.unten.id}`,
    name: `${v.unten.name} → ${v.oben.name}`,
    ziel:
      v.unten.art === 'abschnitt'
        ? abschnittZiel(v.unten.id)
        : einheitDetailPfad(einsatzId, v.unten.id),
    element: `${v.unten.art === 'abschnitt' ? 'ab' : 'eh'}-${v.unten.id}`,
  });
  const funkplanKarte: Kartenplan<FunkplanZeile, SpalteKey> = {
    art: 'plan',
    titel: {
      spalte: 'stelle',
      ziel: (z) =>
        z.art === 'fuehrungsstelle'
          ? einsatzdatenPfad(einsatzId)
          : z.id == null
            ? null
            : z.art === 'abschnitt'
              ? abschnittZiel(z.id)
              : z.art === 'einheit'
                ? einheitDetailPfad(einsatzId, z.id)
                : z.art === 'fahrzeug'
                  ? fahrzeugePfad(einsatzId, { fahrzeug: z.id })
                  : null,
    },
    sekundaer: ['rufname', 'tmo', 'dmo'],
  };

  // In der Skizze wählt ein Betroffener sein Element (Spec „Lücken am Bild“), sonst führt er weg.
  const onLueckenWahl = ansicht === 'skizze' ? setGewaehlt : undefined;

  // Lücke „Leitstelle“ (LFH-848, LFH-893): dieselbe Regel wie im Kommunikationsplan. Ohne Stellen
  // fehlt alles, sonst nur die Skizze; geladen und verbunden steht keine Zeile.
  const leitstelle = netz.luecken.leitstelle;
  const leitstelleZeigen = leitstelle.zustand !== 'daten' || leitstelle.fehlt;
  const leitstelleName =
    leitstelle.element != null
      ? (netz.stellen.find((st) => st.key === leitstelle.element)?.bezeichnung ?? null)
      : null;

  return (
    // Druckwurzel (LFH-22): Mechanik in `druck/druck.css`, Eigenheiten in `funkplanPrint.css`.
    <div className="funkplan-print-root" data-lfh="druckwurzel">
      <EinsatzSeite
        titel="Funkplan"
        meta={umfang || undefined}
        dataUpdatedAt={datenstand}
        beschreibung="Sachgebiet S6 · Dienststellen, Rufnamen, Sprechgruppen und Erreichbarkeit (FwDV 100 Anl. 5)"
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: <Link to={stabPfad(einsatzId)}>Stab</Link> },
              { title: 'Funkplan' },
            ]}
          />
        }
        aktionen={
          // Auch ohne Schreibrecht: lesen kann jeder alle Darstellungen.
          <Segmentleiste<FunkplanAnsicht>
            beschriftung="Darstellung"
            optionen={DARSTELLUNG_OPTIONEN}
            wert={ansicht}
            onWechsel={setzeAnsicht}
          />
        }
      >
        {/* Das Blatt: Druckkopf, Lücken und Darstellung. In der Skizze trägt es die Klasse des
            Papierformats (A3/A4 quer, `stab/skizze/skizzeDruck.css`); die Anlage steht dahinter. */}
        <div
          data-lfh="funkplan-blatt"
          className={ansicht === 'skizze' ? skizzenDruckKlasse(druckFormat) : undefined}
        >
          <Druckkopf
            dokumentart={ansicht === 'skizze' ? 'Fernmeldeskizze' : 'Funkplan'}
            titel={ansicht === 'sprechgruppen' ? 'Sprechgruppen' : undefined}
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
              ...(umfang ? [{ etikett: 'Umfang', wert: umfang }] : []),
            ]}
          />

          {/* ── Lücken ── im ersten Bild (1366 × 768, Panel offen). Jede Zahl aus denselben
            Listen wie die Tabelle; ohne Daten „—" mit Grund, nie „0". */}
          <Paneel titel="Lücken" style={{ marginBlockEnd: token.margin }}>
            <LueckenZeile
              titel="Abschnitte ohne Sprechgruppe"
              luecke={luecken.abschnitteOhneSprechgruppe}
              treffer={(a) => ({
                key: a.id,
                name: a.name,
                ziel: abschnittZiel(a.id),
                element: `ab-${a.id}`,
              })}
              onWahl={onLueckenWahl}
            />
            <LueckenZeile
              titel="Einheiten ohne Sprechgruppe"
              luecke={luecken.einheitenOhneSprechgruppe}
              treffer={(e) => ({
                key: e.id,
                name: e.name,
                ziel: einheitDetailPfad(einsatzId, e.id),
                element: `eh-${e.id}`,
              })}
              onWahl={onLueckenWahl}
            />
            <LueckenZeile
              titel="Einheiten ohne Erreichbarkeit"
              luecke={luecken.einheitenOhneErreichbarkeit}
              treffer={(e) => ({
                key: e.id,
                name: e.name,
                ziel: einheitDetailPfad(einsatzId, e.id),
                element: `eh-${e.id}`,
              })}
              onWahl={onLueckenWahl}
            />
            <LueckenZeile
              titel="Verbindungen ohne gemeinsame Sprechgruppe"
              luecke={luecken.verbindungenOhneGemeinsameSprechgruppe}
              treffer={verbindungTreffer}
              onWahl={onLueckenWahl}
            />
            <LueckenZeile
              titel="Einsatzlokale Sprechgruppen ohne Zuordnung"
              luecke={luecken.lokaleSprechgruppenOhneZuordnung}
              // Kein Ziel: eine Sprechgruppe hat keine eigene Seite, zugeordnet wird am Abschnitt,
              // an der Einheit bzw. an der Führungsstelle (`SprechgruppenPicker`).
              treffer={(s) => ({
                key: s.id,
                name: s.bezeichnung,
                ziel: null,
                element: `sg-${s.id}`,
              })}
              onWahl={onLueckenWahl}
            />
            {/* LFH-893: dieselbe Kanalbelegung wie die Schienen der Skizze; eine einsatzlokale ohne
              Teilnehmer zählt nur oben bei „ohne Zuordnung“. */}
            <LueckenZeile
              titel="Sprechgruppen mit nur einem Teilnehmer"
              luecke={netz.luecken.schienenMitEinemTeilnehmer}
              treffer={(s) => ({
                key: s.id,
                name: s.bezeichnung,
                ziel: null,
                element: `sg-${s.id}`,
              })}
              onWahl={onLueckenWahl}
              letzte={gegenstelle == null && !leitstelleZeigen}
            />
            {leitstelleZeigen && (
              <PaneelZeile style={gegenstelle == null ? { borderBlockEnd: 'none' } : undefined}>
                <div data-lfh="funkplan-luecke">
                  <Flex wrap align="baseline" gap={token.marginXS}>
                    {leitstelle.zustand === 'daten' ? (
                      <>
                        <span>Leitstelle: keine Verbindung erfasst</span>
                        {onLueckenWahl && leitstelle.element && leitstelleName && (
                          <WahlKnopf
                            name={leitstelleName}
                            onWahl={() => onLueckenWahl(leitstelle.element!)}
                          />
                        )}
                        <Link
                          to={kommunikationsplanPfad(einsatzId)}
                          style={stabZeilenzielStil(token)}
                        >
                          im Kommunikationsplan erfassen
                        </Link>
                      </>
                    ) : (
                      <>
                        <span>Leitstelle</span>
                        <span style={monoStil(14, 500)}>—</span>
                        <span style={{ color: rollen.gedaempft }}>
                          {stellen.zustand !== 'daten'
                            ? `Kommunikationsplan ${ZUSTAND_GRUND[leitstelle.zustand]}`
                            : `Fernmeldeskizze ${ZUSTAND_GRUND[leitstelle.zustand]}`}
                        </span>
                      </>
                    )}
                  </Flex>
                </div>
              </PaneelZeile>
            )}
            {/* LFH-849: solange die eigene Führungsstelle nicht erfasst ist (oder nicht vorliegt),
              steht sie als benannte Lücke da, mit dem Weg zu ihrem Pflegeort. Erfasst ist sie
              die erste Zeile des Plans. */}
            {gegenstelle != null && (
              <PaneelZeile style={{ borderBlockEnd: 'none' }}>
                <div data-lfh="funkplan-luecke">
                  <Flex wrap align="baseline" gap={token.marginXS}>
                    <span>{GEGENSTELLE_HINWEIS}</span>
                    <span style={monoStil(14, 500)}>—</span>
                    <span style={{ color: rollen.gedaempft }}>{gegenstelle}</span>
                    {/* In derselben Zeile, mit der Trefffläche der übrigen Lücken-Verweise. */}
                    {quellen.fuehrungsstelle.zustand === 'daten' && (
                      <Link to={einsatzdatenPfad(einsatzId)} style={stabZeilenzielStil(token)}>
                        auf Einsatzdaten erfassen
                      </Link>
                    )}
                  </Flex>
                </div>
              </PaneelZeile>
            )}
          </Paneel>

          {fehlend.length > 0 && (
            <Typography.Paragraph data-lfh="funkplan-quellen" style={{ color: rollen.gedaempft }}>
              {fehlend.map((f) => `${f.name}: ${ZUSTAND_GRUND[f.zustand]}`).join(' · ')}
              {' — diese Angaben fehlen im Funkplan.'}
            </Typography.Paragraph>
          )}

          {/* Ohne die Liste des Einsatzes fehlen nur die lokalen Sprechgruppen ohne Zuordnung; die
            zugeordneten stehen an Abschnitt und Einheit. Ladendes kündigt die Tabelle an. */}
          {ansicht === 'sprechgruppen' &&
            (sprechgruppen.zustand === 'fehler' || sprechgruppen.zustand === 'gesperrt') && (
              <Typography.Paragraph
                data-lfh="sprechgruppen-quelle"
                style={{ color: rollen.gedaempft }}
              >
                {`Sprechgruppen des Einsatzes: ${ZUSTAND_GRUND[sprechgruppen.zustand]} — `}
                {'einsatzlokale Sprechgruppen ohne Zuordnung fehlen in dieser Darstellung.'}
              </Typography.Paragraph>
            )}

          {/* ── Werkzeugzeile ── außerhalb des Primitivs, nur hier trägt `.funkplan-no-print`. */}
          <Space className="funkplan-no-print" wrap style={{ marginBlockEnd: token.margin }}>
            {darfUebernehmen && (
              <Button
                loading={uebernehmen.isPending}
                disabled={quellenLaden}
                title={quellenLaden ? 'Erst wenn alle Angaben geladen sind' : undefined}
                onClick={() => uebernehmen.mutate()}
              >
                In Lagebericht übernehmen
              </Button>
            )}
            {/* Erst nach committetem Aufklappen drucken — `useDrucken` löst den Dialog nach dem
              Commit aus. Die Anlage der Skizze steht ohnehin ganz offen. */}
            <DruckKnopf vorbereiten={() => setZugeklappt(new Set())} />
          </Space>
          {uebernehmen.error != null && (
            <div className="funkplan-no-print" style={{ marginBlockEnd: token.margin }}>
              <SpeicherFehler
                fehler={uebernehmen.error}
                titel="Nicht in den Lagebericht übernommen"
                fallback="Übernahme fehlgeschlagen"
              />
            </div>
          )}

          {ansicht === 'skizze' ? (
            <SkizzenBereich
              abschnitte={quellen.abschnitte.zustand}
              netz={netz}
              aktionen={aktionen}
              einsatzbezeichnung={einsatz.bezeichnung}
              gewaehlt={gewaehlt}
              onWahl={setGewaehlt}
              druckFormat={druckFormat}
              onDruckFormat={setDruckFormat}
              druckt={druckt}
              befehle={befehle}
            />
          ) : ansicht === 'sprechgruppen' ? (
            // Flach und schreibgeschützt, Vergleichsfläche wie die Tabelle („wer funkt auf 311?“).
            // Zwei Sichten in einer Datei: der `key` trennt ihren Zustand (`datensicht.guard`).
            <Datensicht
              key="sprechgruppen"
              bezeichnung="Sprechgruppen"
              form="tabelle"
              spalten={sgSpalten}
              daten={sprechgruppenplan}
              zeilenSchluessel="key"
              ladend={
                quellen.abschnitte.zustand === 'laden' ||
                quellen.einheiten.zustand === 'laden' ||
                quellen.sprechgruppen.zustand === 'laden'
              }
              leerText={sprechgruppenplanLeerText(quellen)}
              // Die Sprechgruppe hat keine eigene Seite: zugeordnet wird an Abschnitt und Einheit,
              // dorthin führen die Teilnehmer.
              karte={{
                art: 'plan',
                titel: { spalte: 'sprechgruppe' },
                sekundaer: ['betriebsart', 'herkunft', 'teilnehmer'],
              }}
            />
          ) : (
            <Datensicht
              key="funkplan"
              bezeichnung="Funkplan"
              form="tabelle"
              spalten={spalten}
              daten={zeilen}
              zeilenSchluessel="key"
              ladend={
                quellen.abschnitte.zustand === 'laden' ||
                quellen.einheiten.zustand === 'laden' ||
                quellen.fahrzeuge.zustand === 'laden'
              }
              leerText={leerTextFuer(quellen)}
              baum={{
                kinder: 'children',
                aufgeklappt,
                onAufgeklappt: (offen) =>
                  setZugeklappt(new Set(aufklappbar.filter((k) => !offen.includes(k)))),
              }}
              karte={funkplanKarte}
            />
          )}
        </div>

        {/* Anlage nur auf Papier (Spec „Druck als eigenes Druckstück“): die Funkplan-Tabelle ganz
            offen ab neuer Seite (`druck/druck.css`, `druck-anlage`), außerhalb des Skizzenblatts,
            also im Hochformat der übrigen Druckstücke. */}
        {ansicht === 'skizze' && druckt && (
          <div data-lfh="druck-anlage">
            <Typography.Title level={2}>Anlage: Funkplan</Typography.Title>
            <Datensicht
              key="funkplan-anlage"
              bezeichnung="Funkplan (Anlage)"
              form="tabelle"
              spalten={spalten}
              daten={zeilen}
              zeilenSchluessel="key"
              ladend={false}
              leerText={leerTextFuer(quellen)}
              baum={{ kinder: 'children', aufgeklappt: aufklappbar, onAufgeklappt: () => {} }}
              karte={funkplanKarte}
            />
          </div>
        )}
      </EinsatzSeite>
    </div>
  );
}
