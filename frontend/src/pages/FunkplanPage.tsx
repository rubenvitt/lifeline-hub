import { Breadcrumb, Button, Flex, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type Key, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { taktischeDtgVoll } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { legeLageberichtAn } from '../api/lageberichte';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import { useAuth } from '../auth/AuthContext';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { useDruckModus } from '../components/druck/useDruckModus';
import { Paneel, PaneelZeile, monoStil, useRollen } from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import {
  einheitDetailPfad,
  einsatzabschnittePfad,
  fahrzeugePfad,
  lageberichtDetailPfad,
  stabPfad,
} from '../routing/deeplinks';
import {
  GEGENSTELLE_HINWEIS,
  ZUSTAND_GRUND,
  fehlendeQuellen,
  strukturVollstaendig,
  aufklappbareSchluessel,
  baueFunkplan,
  funkplanLuecken,
  rendereFunkplanMarkdown,
  type FunkplanQuellen,
  type FunkplanZeile,
} from '../stab/funkplan';
import type { Luecke, Quelle } from '../stab/luecken';
import { stabZeilenzielStil } from '../stab/zeilenziel';
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
 *   ein 403. Die Sprechgruppen gehören keinem Modul (`PFAD_KEY`).
 * - **Form:** `form="tabelle"` in jeder Breite (Vergleichsfläche, `NUR_TABELLE`). Kein Suchen,
 *   Sortieren oder Filtern, die Ordnung ist der Baum (D3, D4). Bearbeitet wird am Datensatz, jede
 *   Zeile führt über ihre Kennung dorthin (D7).
 * - **Erreichbarkeit** ist personenbezogen: am Schirm ab `xl`, im Druck immer, im Lagebericht nie
 *   (D5, Entscheidung 30.09.2026).
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
): Quelle<T> {
  const zustand: AbrufZustand = !frei ? 'gesperrt' : q.data != null ? 'daten' : abrufZustand(q);
  const data = frei ? q.data : undefined;
  return useMemo(() => ({ zustand, daten: data ?? [] }), [zustand, data]);
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

/** Höchstens so viele Betroffene je Lücke, danach „+n weitere". */
const TREFFER_DECKEL = 5;

function LueckenZeile<T>({
  titel,
  luecke,
  treffer,
}: {
  titel: string;
  luecke: Luecke<T>;
  treffer: (x: T) => { key: Key; name: string; ziel: string | null };
}) {
  const { token, rollen } = useRollen();
  const gezeigt = luecke.treffer.slice(0, TREFFER_DECKEL).map(treffer);
  const rest = luecke.treffer.length - gezeigt.length;
  return (
    <PaneelZeile>
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
              t.ziel ? (
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

const UMFANG: { quelle: 'abschnitte' | 'einheiten' | 'fahrzeuge'; wort: string }[] = [
  { quelle: 'abschnitte', wort: 'Abschnitte' },
  { quelle: 'einheiten', wort: 'Einheiten' },
  { quelle: 'fahrzeuge', wort: 'Fahrzeuge' },
];

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

  const abschnitte = useQuelle(abschnitteQuery, abschnitteFrei);
  const einheiten = useQuelle(einheitenQuery, einheitenFrei);
  const fahrzeuge = useQuelle(fahrzeugeQuery, fahrzeugeFrei);
  const personal = useQuelle(personalQuery, personalFrei);
  const sprechgruppen = useQuelle(sprechgruppenQuery);
  const quellen: FunkplanQuellen = useMemo(
    () => ({ abschnitte, einheiten, fahrzeuge, personal, sprechgruppen }),
    [abschnitte, einheiten, fahrzeuge, personal, sprechgruppen],
  );
  const zeilen = useMemo(() => baueFunkplan(quellen), [quellen]);
  const luecken = useMemo(() => funkplanLuecken(quellen), [quellen]);

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
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Funkplan ${stand}`,
        abschnitte: [
          { schluessel: 'text', text: rendereFunkplanMarkdown(zeilen, stand, luecken, quellen) },
        ],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
  });

  const spalten = useMemo(() => funkplanSpalten(druckt), [druckt]);

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
  const quellenLaden = Object.values(quellen).some((q) => q.zustand === 'laden');

  // Ein gesperrtes Modul zählt nicht zum Stand: sein Cache-Zeitstempel gehört zu nichts Gezeigtem.
  const datenstand = gemeinsamerDatenstand(
    abschnitteFrei ? abschnitteQuery.dataUpdatedAt : undefined,
    einheitenFrei ? einheitenQuery.dataUpdatedAt : undefined,
    fahrzeugeFrei ? fahrzeugeQuery.dataUpdatedAt : undefined,
    personalFrei ? personalQuery.dataUpdatedAt : undefined,
    sprechgruppenQuery.dataUpdatedAt,
  );

  const umfang = UMFANG.filter((u) => quellen[u.quelle].zustand === 'daten')
    .map((u) => `${quellen[u.quelle].daten.length} ${u.wort}`)
    .join(' · ');

  // Nur Gescheitertes und Gesperrtes: Ladendes kündigt die Tabelle selbst an.
  const fehlend = fehlendeQuellen(quellen).filter((f) => f.zustand !== 'laden');

  const abschnittZiel = (aid: number) => einsatzabschnittePfad(einsatzId, { abschnitt: aid });

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
      >
        <Druckkopf
          dokumentart="Funkplan"
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
            treffer={(a) => ({ key: a.id, name: a.name, ziel: abschnittZiel(a.id) })}
          />
          <LueckenZeile
            titel="Einheiten ohne Sprechgruppe"
            luecke={luecken.einheitenOhneSprechgruppe}
            treffer={(e) => ({ key: e.id, name: e.name, ziel: einheitDetailPfad(einsatzId, e.id) })}
          />
          <LueckenZeile
            titel="Einheiten ohne Erreichbarkeit"
            luecke={luecken.einheitenOhneErreichbarkeit}
            treffer={(e) => ({ key: e.id, name: e.name, ziel: einheitDetailPfad(einsatzId, e.id) })}
          />
          <LueckenZeile
            titel="Einsatzlokale Sprechgruppen ohne Zuordnung"
            luecke={luecken.lokaleSprechgruppenOhneZuordnung}
            // Kein Ziel: eine Sprechgruppe hat keine eigene Seite, zugeordnet wird am Abschnitt
            // bzw. an der Einheit (`SprechgruppenPicker`).
            treffer={(s) => ({ key: s.id, name: s.bezeichnung, ziel: null })}
          />
          {/* LFH-849: der Einsatz kennt die eigene Führungsstelle (Rufname, Sprechgruppen,
              Erreichbarkeit) noch nicht. Keine erfundene Zeile, sondern die benannte Lücke. */}
          <PaneelZeile style={{ borderBlockEnd: 'none' }}>
            <Flex wrap align="baseline" gap={token.marginXS}>
              <span>{GEGENSTELLE_HINWEIS}</span>
              <span style={monoStil(14, 500)}>—</span>
              <span style={{ color: rollen.gedaempft }}>nicht erfasst</span>
            </Flex>
          </PaneelZeile>
        </Paneel>

        {fehlend.length > 0 && (
          <Typography.Paragraph data-lfh="funkplan-quellen" style={{ color: rollen.gedaempft }}>
            {fehlend.map((f) => `${f.name}: ${ZUSTAND_GRUND[f.zustand]}`).join(' · ')}
            {' — diese Angaben fehlen im Funkplan.'}
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
              Commit aus. */}
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

        <Datensicht
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
          karte={{
            art: 'plan',
            titel: {
              spalte: 'stelle',
              ziel: (z) =>
                z.id == null
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
          }}
        />
      </EinsatzSeite>
    </div>
  );
}
