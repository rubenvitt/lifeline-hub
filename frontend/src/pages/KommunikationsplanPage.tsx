import { Breadcrumb, Button, Flex, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type Key, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { taktischeDtgVoll } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import {
  aendereVerbindung,
  benenneKommunikationsStelleUm,
  entferneKommunikationsStelle,
  entferneVerbindung,
  ladeKommunikationsplan,
  legeKommunikationsStelleAn,
  legeVerbindungAn,
} from '../api/kommunikationsplan';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type {
  KommunikationsStelle,
  NeueKommunikationsStelle,
  NeueVerbindung,
  VerbindungPatch,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { useDruckModus } from '../components/druck/useDruckModus';
import { Paneel, PaneelZeile, monoStil, useRollen } from '../components/instrument';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useOhneVerbindung } from '../offline/verbindung';
import { stabPfad } from '../routing/deeplinks';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import {
  BezeichnungModal,
  StelleAnlegenModal,
  StelleEntfernenRueckfrage,
  VerbindungModal,
} from '../stab/KommunikationsplanDialoge';
import {
  baueKommunikationsplan,
  type KommunikationsGruppe,
  type KommunikationsZeile,
  type VerbindungsAnzeige,
} from '../stab/kommunikationsplan';
import { leitstelleOhneVerbindung, type Quelle } from '../stab/luecken';
import { stabFreigabeAnzeige, useStabFreigabe } from '../stab/useStabFreigabe';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import './kommunikationsplanPrint.css';

/**
 * Kommunikationsplan des Sachgebiets S6 (LFH-848): wer über welche Verbindung außerhalb des
 * Funks erreichbar ist. Herleitung: `openspec/changes/lfh-848-kommunikationsplan/design.md`.
 *
 * - **Ort:** Unterroute des Stabs (`kommunikationsplanPfad`) neben dem Funkplan, Einstieg in der
 *   S6-Zeile. Sperre und Sichtbarkeit erbt die Seite vom Stab, fail-closed über
 *   `useStabFreigabe` (D1).
 * - **Daten:** gepflegte Stellen (Funktionen und externe Stellen) vom Server; Abschnitte und
 *   Einheiten abgeleitet aus ihren eigenen Angaben, gepflegt wird dort (D4). Die Besetzung ist
 *   nur Nebentext, Kontaktangaben des Personals kommen nie vor.
 * - **Form:** `form="tabelle"` in jeder Breite (Vergleichsfläche „welche Nummer hat …?“), die vier
 *   Gruppen als Baumknoten. Die Erreichbarkeit ist hier der Inhalt und immer sichtbar (D5).
 * - **Kein Lagebericht** (D6): ein Bericht wird verteilt und fortgeschrieben, Rufnummern gehören
 *   nicht hinein. Druck ja.
 * - **Ohne Netz** lesbar (Unter-Key in `LAGEBILD_OFFLINE`), die Bedienung ist gesperrt (D9).
 */

/** Eine Zeile der Tabelle: ein Gruppenknoten oder eine Stelle darunter. */
interface PlanZeile {
  key: string;
  gruppe?: KommunikationsGruppe;
  zeile?: KommunikationsZeile;
  children?: PlanZeile[];
}

type SpalteKey = 'stelle' | 'besetzung' | 'verbindungen' | 'aktionen';

const SEITE = { titel: 'Kommunikationsplan', mitArtikel: 'der Kommunikationsplan' };

/** Wie `FunkplanPage`: Fehler MIT Daten ist ein Stand; ohne Freigabe `gesperrt` ohne Altstand. */
function useQuelle<T>(
  q: { data: T[] | undefined; error: unknown; isError: boolean; isPending: boolean },
  frei = true,
): Quelle<T> {
  const zustand: AbrufZustand = !frei ? 'gesperrt' : q.data != null ? 'daten' : abrufZustand(q);
  const data = frei ? q.data : undefined;
  return useMemo(() => ({ zustand, daten: data ?? [] }), [zustand, data]);
}

function Gedaempft({ children }: { children: ReactNode }) {
  const { rollen } = useRollen();
  return <span style={{ color: rollen.gedaempft }}>{children}</span>;
}

/** Leertext eines Gruppenknotens: der Grund, wenn die Quelle fehlt, sonst „keine“. */
function gruppenLeer(g: KommunikationsGruppe): string {
  if (g.zustand !== 'daten') return `— · ${ZUSTAND_GRUND[g.zustand]}`;
  if (g.art === 'abschnitte' || g.art === 'einheiten') return 'keine mit Kommunikationsangaben';
  return 'keine erfasst';
}

/** Ist die Zeile eine Führungsfunktion? Nur dort steht die Besetzung in eigener Spalte. */
function istFunktion(z: KommunikationsZeile): boolean {
  return z.art === 'gepflegt' && z.stelle.stellenart === 'funktion';
}

function StelleZelle({ zeile: p }: { zeile: PlanZeile }) {
  if (p.gruppe) return <Typography.Text strong>{p.gruppe.titel}</Typography.Text>;
  const z = p.zeile!;
  return (
    <span style={{ overflowWrap: 'anywhere' }}>
      <span>{z.kennung}</span>
      {!istFunktion(z) && z.nebentext && (
        <>
          {' · '}
          <Gedaempft>{z.nebentext}</Gedaempft>
        </>
      )}
    </span>
  );
}

function VerbindungenZelle({ verbindungen }: { verbindungen: VerbindungsAnzeige[] }) {
  const { token } = useRollen();
  if (verbindungen.length === 0) return <Gedaempft>—</Gedaempft>;
  return (
    <Flex vertical gap={token.marginXXS}>
      {verbindungen.map((v) => (
        <Flex key={v.schluessel} wrap align="baseline" gap={token.marginXS}>
          {v.mittelLabel && <Gedaempft>{v.mittelLabel}</Gedaempft>}
          {v.wert &&
            (v.verweis ? (
              // Ein Bedienziel wie die Zeilenziele des Stabs: Höhe aus `controlHeight` (Gate 3).
              <a
                href={v.verweis}
                style={{ ...stabZeilenzielStil(token), ...monoStil(14), overflowWrap: 'anywhere' }}
              >
                {v.wert}
              </a>
            ) : (
              <span style={{ ...monoStil(14), overflowWrap: 'anywhere' }}>{v.wert}</span>
            ))}
          {v.hinweis && <Gedaempft>{v.hinweis}</Gedaempft>}
        </Flex>
      ))}
    </Flex>
  );
}

/** Kann die Bezeichnung einer gepflegten Stelle geändert werden? Extern, FHP und Fachberater. */
function hatBezeichnung(s: KommunikationsStelle): boolean {
  return (
    s.stellenart !== 'funktion' ||
    s.funktion === 'fuehrungshilfspersonal' ||
    s.funktion === 'fachberater'
  );
}

type MenueAktion = 'bezeichnung' | 'entfernen' | `bearbeiten-${number}` | `weg-${number}`;

function menueFuer(z: KommunikationsZeile & { art: 'gepflegt' }): MenueEintrag<MenueAktion>[] {
  const text = (v: VerbindungsAnzeige) => [v.mittelLabel, v.wert].filter(Boolean).join(' ');
  return [
    ...z.verbindungen.map((v) => ({
      key: `bearbeiten-${v.id!}` as const,
      label: `${text(v)} bearbeiten`,
    })),
    ...z.verbindungen.map((v) => ({
      key: `weg-${v.id!}` as const,
      label: `${text(v)} entfernen`,
    })),
    ...(hatBezeichnung(z.stelle)
      ? [{ key: 'bezeichnung' as const, label: 'Bezeichnung ändern' }]
      : []),
    { key: 'entfernen' as const, label: 'Stelle entfernen', gefahr: true as const },
  ];
}

/**
 * Spalten. Gewählt gegen die Fläche des Funkplans (LFH-548 D4: 1050 px Contentbreite am Fükw mit
 * offenem Panel): Σ Zahlbreiten 600 + `mindestBreite` 300 = 900 px. EINE fließende Spalte
 * (Verbindungen, LFH-523); Kennung und Werte brechen um. Ohne Schreibrecht und im Druck fehlt
 * die Aktionsspalte.
 */
function planSpalten(
  mitAktionen: boolean,
  gesperrt: boolean,
  onVerbindung: (z: KommunikationsZeile & { art: 'gepflegt' }) => void,
  onMenue: (aktion: MenueAktion, z: KommunikationsZeile & { art: 'gepflegt' }) => void,
) {
  const sperrGrund = gesperrt ? 'Ohne Verbindung zum Server nicht änderbar' : undefined;
  return spaltenFuer<PlanZeile>()([
    {
      title: 'Stelle',
      key: 'stelle' as SpalteKey,
      width: 260,
      immerSichtbar: true,
      render: (_t, p) => <StelleZelle zeile={p} />,
    },
    {
      title: 'Besetzung',
      key: 'besetzung' as SpalteKey,
      width: 180,
      render: (_t, p) =>
        p.zeile && istFunktion(p.zeile) && p.zeile.nebentext ? (
          <span style={{ overflowWrap: 'anywhere' }}>{p.zeile.nebentext}</span>
        ) : null,
    },
    {
      title: 'Verbindungen',
      key: 'verbindungen' as SpalteKey,
      mindestBreite: 300,
      render: (_t, p) =>
        p.gruppe ? (
          p.gruppe.zeilen.length === 0 ? (
            <Gedaempft>{gruppenLeer(p.gruppe)}</Gedaempft>
          ) : null
        ) : (
          <VerbindungenZelle verbindungen={p.zeile!.verbindungen} />
        ),
    },
    ...(mitAktionen
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as SpalteKey,
            width: 160,
            render: (_t: unknown, p: PlanZeile) => {
              const z = p.zeile;
              // Abgeleitete Zeilen werden an ihrem Datensatz gepflegt: keine Aktion.
              if (!z || z.art !== 'gepflegt') return null;
              return (
                // `middle`: ≥ 16 px zwischen zwei Zielen im Handschuh-Betrieb (LFH-653).
                <Space wrap size="middle">
                  <Button
                    aria-label={`Verbindung zu ${z.kennung} hinzufügen`}
                    disabled={gesperrt}
                    title={sperrGrund}
                    onClick={() => onVerbindung(z)}
                  >
                    + Verbindung
                  </Button>
                  <MenueAusloeser<MenueAktion>
                    eintraege={menueFuer(z)}
                    zugaenglicherName={`Weitere Aktionen zu ${z.kennung}`}
                    gesperrt={gesperrt}
                    onWahl={(aktion) => onMenue(aktion, z)}
                  />
                </Space>
              );
            },
          },
        ]
      : []),
  ]);
}

type Dialog =
  | { art: 'stelle' }
  | { art: 'verbindung'; stelle: KommunikationsStelle; kennung: string; basis?: VerbindungsAnzeige }
  | { art: 'bezeichnung'; stelle: KommunikationsStelle; kennung: string }
  | { art: 'entfernen'; stelle: KommunikationsStelle; kennung: string };

export default function KommunikationsplanPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const druckt = useDruckModus();
  const ohneVerbindung = useOhneVerbindung();
  const queryClient = useQueryClient();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const stabFreigabe = useStabFreigabe(einsatzId);
  const stabFrei = stabFreigabe.zustand === 'frei';
  const frei = (key: string) => stabFrei && istKeyFreigegeben(key, stabFreigabe.freigaben);
  const abschnitteFrei = frei('einsatzabschnitte');
  const einheitenFrei = frei('einheiten');

  const planKey = einsatzKeys.stabKommunikationsplan(einsatzId);
  const stellenQuery = useQuery({
    queryKey: planKey,
    queryFn: () => ladeKommunikationsplan(einsatzId),
    enabled: stabFrei,
  });
  // Nur für den Nebentext der Sachgebiete; ohne Netz nicht gespeichert (D9) → „nicht geladen“.
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
    enabled: stabFrei,
  });
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

  const stellen = useQuelle(stellenQuery);
  const abschnitte = useQuelle(abschnitteQuery, abschnitteFrei);
  const einheiten = useQuelle(einheitenQuery, einheitenFrei);
  // Ohne Netz pausiert die Abfrage und bliebe für immer „lädt“; die Besetzung ist dann schlicht
  // nicht geladen (D9: der Stab außer dem Plan liegt nicht auf der Platte).
  const stabZustand: AbrufZustand =
    stabQuery.data != null ? 'daten' : ohneVerbindung ? 'fehler' : abrufZustand(stabQuery);
  const plan = useMemo(
    () =>
      baueKommunikationsplan({
        einsatzId,
        stellen,
        abschnitte,
        einheiten,
        stab: { zustand: stabZustand, daten: stabQuery.data },
      }),
    [einsatzId, stellen, abschnitte, einheiten, stabZustand, stabQuery.data],
  );
  const luecke = useMemo(() => leitstelleOhneVerbindung(stellen), [stellen]);
  const zeilen: PlanZeile[] = useMemo(
    () =>
      plan.map((g) => ({
        key: `gruppe-${g.art}`,
        gruppe: g,
        children:
          g.zeilen.length > 0 ? g.zeilen.map((z) => ({ key: z.schluessel, zeile: z })) : undefined,
      })),
    [plan],
  );

  const flach = useMemo(
    () => zeilen.flatMap((g) => [{ key: g.key, gruppe: g.gruppe }, ...(g.children ?? [])]),
    [zeilen],
  );

  // Zugeklappt statt aufgeklappt gemerkt: der Plan wird gelesen, also steht er offen.
  const [zugeklappt, setZugeklappt] = useState<ReadonlySet<Key>>(new Set());
  const aufklappbar = zeilen.filter((p) => p.children).map((p) => p.key);
  const aufgeklappt = aufklappbar.filter((k) => !zugeklappt.has(k));

  // ── Schreiben: jede Antwort ist der ganze Plan nach dem Commit (setQueryData) ─────────────
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const schliessen = () => setDialog(null);
  const mitAntwort = {
    onSuccess: (neu: KommunikationsStelle[]) => queryClient.setQueryData(planKey, neu),
  };
  const stelleAnlegen = useMutation({
    mutationFn: (body: NeueKommunikationsStelle) => legeKommunikationsStelleAn(einsatzId, body),
    ...mitAntwort,
  });
  const umbenennen = useMutation({
    mutationFn: ({ sid, bezeichnung }: { sid: number; bezeichnung: string }) =>
      benenneKommunikationsStelleUm(einsatzId, sid, bezeichnung),
    ...mitAntwort,
  });
  const stelleEntfernen = useMutation({
    mutationFn: (sid: number) => entferneKommunikationsStelle(einsatzId, sid),
    ...mitAntwort,
  });
  const verbindungAnlegen = useMutation({
    mutationFn: ({ sid, body }: { sid: number; body: NeueVerbindung }) =>
      legeVerbindungAn(einsatzId, sid, body),
    ...mitAntwort,
  });
  const verbindungAendern = useMutation({
    mutationFn: ({ vid, patch }: { vid: number; patch: VerbindungPatch }) =>
      aendereVerbindung(einsatzId, vid, patch),
    ...mitAntwort,
  });
  const verbindungEntfernen = useMutation({
    mutationFn: (vid: number) => entferneVerbindung(einsatzId, vid),
    ...mitAntwort,
  });
  const oeffne = (d: Dialog) => {
    for (const m of [stelleAnlegen, umbenennen, verbindungAnlegen, verbindungAendern]) m.reset();
    setDialog(d);
  };

  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const mitAktionen = darfSchreiben && !druckt;
  const spalten = useMemo(
    () =>
      planSpalten(
        mitAktionen,
        ohneVerbindung,
        (z) => oeffne({ art: 'verbindung', stelle: z.stelle, kennung: z.kennung }),
        (aktion, z) => {
          stelleEntfernen.reset();
          verbindungEntfernen.reset();
          if (aktion === 'bezeichnung') {
            oeffne({ art: 'bezeichnung', stelle: z.stelle, kennung: z.kennung });
          } else if (aktion === 'entfernen') {
            // Ohne Verbindungen ist nichts verloren, was ein Feld nicht wiederbrächte.
            if (z.stelle.verbindungen.length === 0) stelleEntfernen.mutate(z.stelle.id);
            else setDialog({ art: 'entfernen', stelle: z.stelle, kennung: z.kennung });
          } else if (aktion.startsWith('bearbeiten-')) {
            const vid = Number(aktion.slice('bearbeiten-'.length));
            const basis = z.verbindungen.find((v) => v.id === vid);
            oeffne({ art: 'verbindung', stelle: z.stelle, kennung: z.kennung, basis });
          } else {
            verbindungEntfernen.mutate(Number(aktion.slice('weg-'.length)));
          }
        },
      ),
    // Die Mutationen sind identitätsstabil genug; neu gebaut wird mit Recht, Netz und Druck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mitAktionen, ohneVerbindung],
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
  if (stabFreigabe.zustand !== 'frei') return stabFreigabeAnzeige(stabFreigabe, SEITE, einsatzId);

  const datenstand = gemeinsamerDatenstand(
    stellenQuery.dataUpdatedAt,
    abschnitteFrei ? abschnitteQuery.dataUpdatedAt : undefined,
    einheitenFrei ? einheitenQuery.dataUpdatedAt : undefined,
  );
  const umfang =
    stellen.zustand === 'daten'
      ? `${stellen.daten.length} ${stellen.daten.length === 1 ? 'gepflegte Stelle' : 'gepflegte Stellen'}`
      : undefined;
  const sperrGrund = ohneVerbindung ? 'Ohne Verbindung zum Server nicht änderbar' : undefined;
  const entfernFehler = stelleEntfernen.error ?? verbindungEntfernen.error;

  return (
    // Druckwurzel (LFH-22): Mechanik in `druck/druck.css`, Eigenheiten in
    // `kommunikationsplanPrint.css`.
    <div className="kommunikationsplan-print-root" data-lfh="druckwurzel">
      <EinsatzSeite
        titel="Kommunikationsplan"
        meta={umfang}
        dataUpdatedAt={datenstand}
        beschreibung="Sachgebiet S6 · Verbindungen außerhalb des Funks: Telefon, Fax, E-Mail, Melder"
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: <Link to={stabPfad(einsatzId)}>Stab</Link> },
              { title: 'Kommunikationsplan' },
            ]}
          />
        }
        aktionen={
          darfSchreiben ? (
            <Button
              type="primary"
              disabled={ohneVerbindung || stellen.zustand !== 'daten'}
              title={sperrGrund}
              onClick={() => oeffne({ art: 'stelle' })}
            >
              Stelle hinzufügen
            </Button>
          ) : undefined
        }
      >
        <Druckkopf
          dokumentart="Kommunikationsplan"
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
          ]}
        />

        {/* ── Lücke „Leitstelle“ ── im ersten Bild. Ohne geladene Stellen „—“ mit Grund. */}
        {(luecke.fehlt || luecke.zustand !== 'daten') && luecke.zustand !== 'laden' && (
          <Paneel titel="Lücken" style={{ marginBlockEnd: token.margin }}>
            <PaneelZeile style={{ borderBlockEnd: 'none' }}>
              <Flex wrap align="baseline" gap={token.marginXS} data-lfh="kommunikationsplan-luecke">
                {luecke.zustand === 'daten' ? (
                  <span>Leitstelle: keine Verbindung erfasst</span>
                ) : (
                  <>
                    <span>Leitstelle</span>
                    <span style={monoStil(14, 500)}>—</span>
                    <Gedaempft>{ZUSTAND_GRUND[luecke.zustand]}</Gedaempft>
                  </>
                )}
              </Flex>
            </PaneelZeile>
          </Paneel>
        )}

        <Space
          className="kommunikationsplan-no-print"
          wrap
          style={{ marginBlockEnd: token.margin }}
        >
          <DruckKnopf />
        </Space>
        {entfernFehler != null && (
          <div className="kommunikationsplan-no-print" style={{ marginBlockEnd: token.margin }}>
            <SpeicherFehler fehler={entfernFehler} titel="Nicht entfernt" />
          </div>
        )}

        <Datensicht
          bezeichnung="Kommunikationsplan"
          form="tabelle"
          spalten={spalten}
          // Im Druck flach: alles steht da, und kein Aufklappsymbol landet auf dem Papier.
          daten={druckt ? flach : zeilen}
          zeilenSchluessel="key"
          ladend={stellen.zustand === 'laden'}
          baum={
            druckt
              ? undefined
              : {
                  kinder: 'children',
                  aufgeklappt,
                  onAufgeklappt: (offen) =>
                    setZugeklappt(new Set(aufklappbar.filter((k) => !offen.includes(k)))),
                }
          }
          karte={{
            art: 'plan',
            titel: {
              spalte: 'stelle',
              ziel: (p) =>
                p.zeile && (p.zeile.art === 'abschnitt' || p.zeile.art === 'einheit')
                  ? p.zeile.ziel
                  : null,
            },
            sekundaer: ['besetzung', 'verbindungen'],
          }}
        />
      </EinsatzSeite>

      {dialog?.art === 'stelle' && (
        <StelleAnlegenModal
          stellen={stellen.daten}
          laeuft={stelleAnlegen.isPending}
          fehler={stelleAnlegen.error}
          onAnlegen={(body) => stelleAnlegen.mutateAsync(body)}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'verbindung' && (
        <VerbindungModal
          kennung={dialog.kennung}
          basis={dialog.basis}
          laeuft={verbindungAnlegen.isPending || verbindungAendern.isPending}
          fehler={verbindungAnlegen.error ?? verbindungAendern.error}
          onAnlegen={(body) => verbindungAnlegen.mutateAsync({ sid: dialog.stelle.id, body })}
          onAendern={(patch) => verbindungAendern.mutateAsync({ vid: dialog.basis!.id!, patch })}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'bezeichnung' && (
        <BezeichnungModal
          stelle={dialog.stelle}
          kennung={dialog.kennung}
          laeuft={umbenennen.isPending}
          fehler={umbenennen.error}
          onSpeichern={(bezeichnung) =>
            umbenennen.mutateAsync({ sid: dialog.stelle.id, bezeichnung })
          }
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'entfernen' && (
        <StelleEntfernenRueckfrage
          kennung={dialog.kennung}
          anzahl={dialog.stelle.verbindungen.length}
          laeuft={stelleEntfernen.isPending}
          onEntfernen={() => stelleEntfernen.mutate(dialog.stelle.id, { onSettled: schliessen })}
          onSchliessen={schliessen}
        />
      )}
    </div>
  );
}
