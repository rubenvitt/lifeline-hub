import {
  IconGebaeudegruppe,
  IconPersonen,
  IconPfote,
  IconSchild,
  IconSpross,
  type Icon,
} from '../../icons';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button, Dropdown, Space, Table, Tooltip, Typography } from 'antd';
import type { TableColumnsType, TableRef } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import { monoStil, useRollen } from '../../components/instrument';
import type { BewertungEingabe } from '../../api/gefahren';
import { warnstufeFlaeche } from '../../theme/statusFarben';
import { zellFlaechenStil } from './zellStil';
import {
  GEFAHRENTYPEN_ALPHABETISCH,
  SCHUTZOBJEKTE,
  WARNSTUFEN,
  kombinationGueltig,
} from './gefahrenSchema';
import GefahrenZelleDetails from './GefahrenZelleDetails';
import GefahrenErlaeuterungen from './GefahrenErlaeuterungen';
import { MIT_ERLAEUTERUNG, hatErlaeuterung, zellTitel } from './erlaeuterungen';
import { ErlaeuterungsMarke, ErlaeuterungsZeichen } from './ErlaeuterungsMarke';
import { useKopfFreiraum } from '../../components/KatalogTabelle';
import { useRahmenOben } from '../../components/rahmenOben';
import { useDruckModus } from '../../components/druck/useDruckModus';
import './gefahrenMatrix.css';

/**
 * Bevorzugte Breite der fixierten Spalte „Gefahr". Mit `scroll={{ x: 'max-content' }}` ist sie nur
 * eine Mindestbreite — deshalb wird der Fokusabstand gemessen, nicht hieraus gelesen.
 */
const GEFAHR_SPALTE_BREITE = 180;

/** CSS-Variable des Fokusabstands zur fixierten Spalte (`gefahrenMatrix.css`). */
export const SPALTEN_FREIRAUM = '--lfh-gefahr-spalte';

/**
 * Schreibt die gemessene Breite der fixierten Spalte als {@link SPALTEN_FREIRAUM} an die
 * Tabellenwurzel (WCAG 2.4.11): beim Tabben nach links richtet der Scrollcontainer das Ziel am
 * linken Rand aus, also unter der fixierten Spalte. Gemessen statt aus {@link
 * GEFAHR_SPALTE_BREITE}, weil die Spalte mit der Dichte breiter wird. Muster: `setzeKopfFreiraum`
 * in `components/KatalogTabelle.tsx`.
 */
export function setzeSpaltenFreiraum(wurzel: HTMLElement): void {
  const spalte = wurzel.querySelector<HTMLElement>('th.ant-table-cell-fix-start');
  wurzel.style.setProperty(SPALTEN_FREIRAUM, `${spalte?.offsetWidth ?? 0}px`);
}

/** Hält {@link SPALTEN_FREIRAUM} aktuell. Beobachtet werden Wurzel UND Kopfzelle: die Spalte
 *  wächst mit der Dichte, ohne dass sich die Breite der Wurzel ändern muss. */
function useSpaltenFreiraum(tabelle: RefObject<TableRef | null>): void {
  useEffect(() => {
    const wurzel = tabelle.current?.nativeElement;
    if (!wurzel) return;
    const aktualisiere = () => setzeSpaltenFreiraum(wurzel);
    aktualisiere();
    const beobachter = new ResizeObserver(aktualisiere);
    beobachter.observe(wurzel);
    const kopfzelle = wurzel.querySelector('th.ant-table-cell-fix-start');
    if (kopfzelle) beobachter.observe(kopfzelle);
    return () => beobachter.disconnect();
  }, [tabelle]);
}

/**
 * Wie weit die Seite nach oben rollen muss, damit ein fokussiertes Ziel nicht unter der stehenden
 * Kopfzeile liegt (negativ = nach oben), oder 0. Rein, damit die Regel ohne Layout prüfbar ist.
 */
export function kopfUeberdeckung(
  ziel: Pick<DOMRect, 'top' | 'bottom'>,
  kopf: Pick<DOMRect, 'top' | 'bottom'>,
): number {
  return ziel.top < kopf.bottom && ziel.bottom > kopf.top ? ziel.top - kopf.bottom : 0;
}

/**
 * Rückwärts in die ERSTE Zeile getabbt, rollt der Browser die Seite nicht (LLH-1102): Chromium
 * beschneidet den Fokusrand (`scroll-margin-top`, `gefahrenMatrix.css`) an der Oberkante des
 * waagerechten Scrollcontainers `.ant-table-body`, und die erste Zeile beginnt genau dort. Die
 * Zelle zählt damit als sichtbar und blieb unter der stehenden Kopfzeile (`e2e/fokus-verdeckung`,
 * 1024 × 768 Handschuh; bei 390 px schon vorher). Solange der Knopf in einer gepolsterten Zelle
 * saß, ragte er nur halb darunter. Nach jedem Fokuswechsel in den Zellen wird deshalb gemessen
 * und die Seite um die Überdeckung zurückgerollt.
 */
function useFokusUnterKopf(tabelle: RefObject<TableRef | null>): void {
  useEffect(() => {
    const wurzel = tabelle.current?.nativeElement;
    if (!wurzel) return;
    const beiFokus = (e: FocusEvent) => {
      const ziel = e.target as HTMLElement;
      if (!ziel.closest('.ant-table-tbody')) return;
      const kopf = wurzel.querySelector('.ant-table-sticky-holder, .ant-table-header');
      if (!kopf) return;
      const versatz = kopfUeberdeckung(ziel.getBoundingClientRect(), kopf.getBoundingClientRect());
      if (versatz < 0) window.scrollBy({ top: versatz, behavior: 'instant' });
    };
    wurzel.addEventListener('focusin', beiFokus);
    return () => wurzel.removeEventListener('focusin', beiFokus);
  }, [tabelle]);
}

interface ZeilenDaten {
  typ: Gefahrentyp;
  label: string;
}

/**
 * Welche Zelle der Detail-Dialog meint — die Kennung statt des Datensatzes, Begründung am Zustand
 * in {@link GefahrenMatrix}.
 */
interface Zellkennung {
  typ: Gefahrentyp;
  objekt: Schutzobjekt;
}

/**
 * Symbol + Kurzform je Schutzobjekt; das Kurzwort ist der zweite Kanal. Exportiert für den
 * Matrixauszug der Palettenvorschau.
 */
export const SPALTENKOPF: Record<Schutzobjekt, { icon: Icon; kurz: string }> = {
  menschen: { icon: IconPersonen, kurz: 'Mensch' },
  tiere: { icon: IconPfote, kurz: 'Tier' },
  umwelt: { icon: IconSpross, kurz: 'Umwelt' },
  sachwerte: { icon: IconGebaeudegruppe, kurz: 'Sache' },
  einsatzkraefte: { icon: IconSchild, kurz: 'Kraft' },
};

// Fläche und Balken einer Zelle stehen in `zellStil.ts` (LLH-1110: auch das Stufen-Etikett
// außerhalb der Matrix liest sie, ohne die Matrix zu importieren).
export { zellBalkenStil, zellFlaechenStil } from './zellStil';

/**
 * Zellzustände ohne gesetzte Stufe — EINE Quelle für Matrix, Auszug und Legende, damit dieselbe
 * Zelle überall dasselbe Zeichen trägt.
 *
 * „keine“ ist die Vorgabe (LLH-1090, Spec `gefahrenmatrix`, fortgeschrieben aus LFH-969): eine
 * gültige Zelle ohne Bewertung zeigt „–“ wie eine ausdrücklich auf „keine“ gesetzte, mit demselben
 * Namen und derselben Kennung. Die Sorge von LFH-969 („sonst sähe eine offene Beurteilung aus wie
 * eine Entwarnung“) trägt jetzt die Beurteilung am Gefahrengebiet („nicht beurteilt“,
 * `GefahrenBeurteilung`), nicht mehr eine leere Zelle.
 */
export function zellStufe(zelle: GefahrBewertung | undefined): Warnstufe {
  return zelle?.warnstufe ?? 'keine';
}

/** Zelle, solange die Matrix lädt: noch keine Aussage, auch nicht „keine“. */
const ZELLE_LAEDT = { label: 'lädt', kuerzel: '' } as const;

/**
 * Ungültige Kombination: kein Text, kein Knopf (ein gesperrter Auslöser gäbe vor, es gäbe hier
 * eine Entscheidung). Zweiter Kanal neben der fehlenden Bedienung ist das Muster
 * ({@link schraffurStil}, WCAG 1.4.1), für Hilfstechnik der Name.
 */
export const ZELLE_NICHT_ANWENDBAR = { label: 'nicht anwendbar' } as const;

/**
 * Schraffur einer nicht anwendbaren Zelle und ihres Legendenfelds — eine Stelle für Matrix,
 * Legende und Palettenauszug. Die Linien tragen die Farbe in `color` (danach misst
 * `e2e/gefahrenmatrix-kontrast.spec.ts` gegen den Grund, ≥ 3 : 1 nach WCAG 1.4.11) und im Verlauf.
 * Aufrufer geben `rollen.steuerRahmen`: die Rolle hält auf jeder Fläche 3 : 1.
 */
export function schraffurStil(farbe: string): CSSProperties {
  return {
    color: farbe,
    backgroundImage: `repeating-linear-gradient(135deg, ${farbe} 0 1px, transparent 1px 6px)`,
  };
}

/** Die eine Schreibweise der Zell-Identität — auch für den Schlüssel der laufenden Mutation. */
export function zellSchluessel(typ: Gefahrentyp, objekt: Schutzobjekt): string {
  return `${typ}×${objekt}`;
}

export interface GefahrenMatrixProps {
  matrix: GefahrBewertung[];
  darfSchreiben: boolean;
  /**
   * Die Matrix ist noch nicht geladen (LFH-969). Dann zeigt keine Zelle eine Stufe, auch nicht die
   * Vorgabe „keine“, und alle Zellen sind gesperrt: ein Klick schriebe sonst über Details, die
   * noch unterwegs sind.
   */
  laedt?: boolean;
  /**
   * Die Zelle, deren PUT unterwegs ist (`zellSchluessel`), oder `null` — gesperrt wird nur sie,
   * nicht alle 58.
   */
  laufendeZelle: string | null;
  /** Stufenwechsel aus dem Menü. Kein Formularzustand zu schützen → `mutate` genügt. */
  onSetzen: (daten: BewertungEingabe) => void;
  /**
   * Speichern aus dem Detail-Dialog. Muss bei Ablehnung ablehnen (`mutateAsync`): ein abgelehntes
   * Detail-Speichern kostete sonst den getippten Wortlaut, weil die Hülle leert und schließt.
   */
  onDetailsSpeichern: (daten: BewertungEingabe) => Promise<unknown>;
  /** Grund eines abgelehnten Detail-Speicherns — steht IM Dialog, nicht als Toast (LFH-966). */
  detailsFehler?: unknown;
  /** Der Detail-Dialog schließt: der Aufrufer räumt seinen Fehler, der nächste öffnet leer. */
  onDetailsSchliessen?: () => void;
}

/**
 * Das 13×5-Raster eines Gefahrengebiets, verdichtet (LLH-1102, Spec `gefahrenmatrix`): Zeilen
 * alphabetisch, Zeilenhöhe = Steuerhöhe der Stufe, die ganze Zelle ist das Bedienziel.
 */
export default function GefahrenMatrix({
  matrix,
  darfSchreiben,
  laedt = false,
  laufendeZelle,
  onSetzen,
  onDetailsSpeichern,
  detailsFehler,
  onDetailsSchliessen,
}: GefahrenMatrixProps) {
  const { token, rollen } = useRollen();
  // Freiraum unter der stehenden Kopfzeile beim Rückwärtstabben.
  const tabelleRef = useRef<TableRef>(null);
  useKopfFreiraum(tabelleRef);
  const rahmenOben = useRahmenOben();
  // Im Druck ohne stehende Kopfzeile (LLH-1364, wie `KatalogTabelle`): mit `sticky` läge der Kopf
  // in einer eigenen Tabelle, die keine Druckregel wieder mit dem Körper zusammenführt.
  const druckt = useDruckModus();
  // Freiraum neben der fixierten Spalte beim Tabben nach links.
  useSpaltenFreiraum(tabelleRef);
  // Erste Zeile rückwärts getabbt: nicht unter der Kopfzeile stehen lassen.
  useFokusUnterKopf(tabelleRef);
  /**
   * Im Zustand steht die Kennung der Zelle, nicht ihr Datensatz. Eine Momentaufnahme vom Menüklick
   * würde von keinem Nachladen erreicht; der Detail-PUT schickt aber `warnstufe` mit und drehte
   * eine inzwischen gesetzte Stufe still zurück (zweiter Bediener, oder Stufe setzen und sofort
   * „Erläuterung …" öffnen).
   */
  const [detailKennung, setDetailKennung] = useState<Zellkennung | null>(null);
  /**
   * Die Zelle, die ein Tipp in der Liste „Erläuterungen“ ohne Schreibrecht hervorhebt (LLH-1110),
   * als `zellSchluessel`. Bleibt bis zur nächsten Wahl stehen: kein Blinken, kein Zeitgeber.
   */
  const [hervorgehoben, setHervorgehoben] = useState<string | null>(null);

  // Die hervorgehobene Zelle in den Blick holen; „nearest“ rollt nur, wenn sie verdeckt ist.
  useEffect(() => {
    if (hervorgehoben == null) return;
    tabelleRef.current?.nativeElement
      ?.querySelector<HTMLElement>('[data-hervorgehoben="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [hervorgehoben]);

  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);

  const spalten: TableColumnsType<ZeilenDaten> = [
    {
      title: 'Gefahr',
      dataIndex: 'label',
      key: 'label',
      fixed: 'left',
      width: GEFAHR_SPALTE_BREITE,
      // Dichte Zeilen (LLH-1102): die Zeile ist so hoch wie die Steuerhöhe der Stufe. Senkrecht
      // keine Polsterung, sonst bestimmte die Kennungsspalte die Zeilenhöhe; waagerecht bleibt sie.
      onCell: () => ({ style: { paddingBlock: 0, height: token.controlHeight } }),
    },
    ...SCHUTZOBJEKTE.map((obj) => {
      const { icon: Icon, kurz } = SPALTENKOPF[obj.wert];
      return {
        key: obj.wert,
        title: (
          <Tooltip title={obj.label}>
            <Space size={token.marginXS}>
              <Icon aria-hidden size={16} />
              <span>{kurz}</span>
            </Space>
          </Tooltip>
        ),
        onCell: (zeile: ZeilenDaten) => {
          // Eine nicht anwendbare Zelle trägt keine Stufe; während des Ladens ist keine bekannt.
          const zelle = zelleVon(zeile.typ, obj.wert);
          const stufe =
            !kombinationGueltig(zeile.typ, obj.wert) || (!zelle && laedt)
              ? undefined
              : zellStufe(zelle);
          const flaeche: { backgroundColor?: string; boxShadow?: string } = stufe
            ? zellFlaechenStil(stufe, token)
            : {};
          // Hervorgehoben (LLH-1110): Ring 2 px `bedien` nach innen, zusammen mit dem Stufenbalken
          // — die Fläche bleibt die der Stufe.
          const ring =
            hervorgehoben === zellSchluessel(zeile.typ, obj.wert)
              ? `inset 0 0 0 2px ${rollen.bedien}`
              : null;
          return {
            'data-warnstufe': stufe,
            'data-hervorgehoben': ring ? 'true' : undefined,
            style: {
              ...flaeche,
              ...(ring ? { boxShadow: [ring, flaeche.boxShadow].filter(Boolean).join(', ') } : {}),
              // Die ganze Zelle ist das Bedienziel (LLH-1102): keine Polsterung, der Auslöser
              // füllt sie. Fläche und Balken bleiben an der Zelle, der Knopf ist durchsichtig.
              padding: 0,
              textAlign: 'center' as const,
            },
          };
        },
        render: (_: unknown, zeile: ZeilenDaten) => {
          if (!kombinationGueltig(zeile.typ, obj.wert)) {
            // Muster statt Wort, kein Knopf; die Kachel füllt die Zelle wie die Zellknöpfe, damit
            // das Raster ruhig bleibt (LLH-1090, LLH-1102).
            return (
              <span
                role="img"
                data-lfh="nicht-anwendbar"
                aria-label={`${zeile.label} × ${obj.label}: ${ZELLE_NICHT_ANWENDBAR.label}`}
                style={{
                  display: 'block',
                  width: '100%',
                  minWidth: token.controlHeight,
                  height: token.controlHeight,
                  ...schraffurStil(rollen.steuerRahmen),
                }}
              />
            );
          }
          const zelle = zelleVon(zeile.typ, obj.wert);
          // Ohne Zeile gilt „keine“ (LLH-1090); nur vor dem Laden ist nichts bekannt.
          const anzeige = !zelle && laedt ? ZELLE_LAEDT : warnstufeFlaeche[zellStufe(zelle)];
          const schluessel = zellSchluessel(zeile.typ, obj.wert);
          const mitErlaeuterung = zelle != null && hatErlaeuterung(zelle);
          // „Erläuterung …“ an jeder gültigen Zelle (LLH-1090/LLH-1110): eine Erläuterung zu
          // „keine“ ist gültig, der Dialog legt die Bewertung dann mit „keine“ an.
          const items = [
            ...WARNSTUFEN.map((w) => ({
              key: w.wert,
              label: `${warnstufeFlaeche[w.wert].kuerzel} · ${w.label}`,
            })),
            { type: 'divider' as const },
            { key: 'details', label: 'Erläuterung …' },
          ];
          return (
            <Dropdown
              trigger={['click']}
              // `autoFocus` steht am Dropdown: `MenuProps` kennt es nicht.
              autoFocus
              disabled={!darfSchreiben || laedt || laufendeZelle === schluessel}
              menu={{
                items,
                // Zuordnung am Menü, nicht je Eintrag: ein Riegel hat einen Ort, und das Synthetic
                // Event des Portals steigt nicht in einen klickbaren Elternteil.
                onClick: ({ key }) => {
                  if (key === 'details') {
                    setDetailKennung({ typ: zeile.typ, objekt: obj.wert });
                    return;
                  }
                  onSetzen({
                    gefahrentyp: zeile.typ,
                    schutzobjekt: obj.wert,
                    warnstufe: key as Warnstufe,
                    beschreibung: zelle?.beschreibung ?? null,
                    gemeldet_von: zelle?.gemeldet_von ?? null,
                  });
                },
              }}
            >
              <Button
                type="text"
                className="gefahren-zelle"
                // Der Name trägt Zeilenkennung und Stufe: 58 gleichnamige Knöpfe wären unbrauchbar.
                // Mit Erläuterung endet er auf „· mit Erläuterung“ (LLH-1110), die Marke ist für
                // Hilfstechnik verborgen.
                aria-label={`Bewertung ${zeile.label} × ${obj.label}: ${anzeige.label}${
                  mitErlaeuterung ? MIT_ERLAEUTERUNG : ''
                }`}
                // Keine Größen-Prop: die Höhe kommt aus der Staffel des ConfigProviders. Der Knopf
                // füllt die Zelle (LLH-1102): ein Tipp irgendwo in ihr trifft, auch neben das
                // Kürzel. `minWidth` = Höhe hält die kurze Achse, wenn die Spalte schmal wird;
                // Radius 0, damit die Fläche bis in die Ecken Ziel ist. Den Fokusring trägt
                // `gefahrenMatrix.css` nach innen.
                style={{
                  display: 'flex',
                  width: '100%',
                  minWidth: token.controlHeight,
                  height: token.controlHeight,
                  borderRadius: 0,
                  position: 'relative',
                }}
              >
                {anzeige.kuerzel}
                {mitErlaeuterung && <ErlaeuterungsMarke />}
              </Button>
            </Dropdown>
          );
        },
      };
    }),
  ];
  // Alphabetisch (LLH-1102): dieselbe Folge wie Lagebild, Palettenauszug und Schäden.
  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN_ALPHABETISCH.map((g) => ({
    typ: g.wert,
    label: g.label,
  }));

  // Je Render frisch aus `matrix` abgeleitet — so erreicht ein Nachladen den offenen Dialog.
  const detailZelle = detailKennung
    ? (zelleVon(detailKennung.typ, detailKennung.objekt) ?? null)
    : null;
  const detailSchluessel = detailKennung
    ? zellSchluessel(detailKennung.typ, detailKennung.objekt)
    : null;
  const detailTitel = detailKennung ? zellTitel(detailKennung.typ, detailKennung.objekt) : '';

  return (
    <>
      {/* Legende (LFH-969, LLH-1090): Kürzel und Muster mit ihrem Wort. Als Text, nicht als
          Tooltip — den gibt es auf Touch nicht. Ob die Matrix beurteilt ist, steht am Gebiet
          (`GefahrenBeurteilung`), nicht als Zellzählung. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: `${token.marginXXS}px ${token.margin}px`,
          marginBottom: token.marginXS,
        }}
      >
        <Typography.Text type="secondary" role="note" aria-label="Legende der Matrix">
          {WARNSTUFEN.map((w) => {
            const { kuerzel, label } = warnstufeFlaeche[w.wert];
            return `${kuerzel} ${label}`;
          }).join(' · ')}
          {' · '}
          <span
            aria-hidden="true"
            data-lfh="legende-schraffur"
            style={{
              display: 'inline-block',
              width: '1em',
              height: '1em',
              verticalAlign: '-0.15em',
              ...schraffurStil(rollen.steuerRahmen),
            }}
          />{' '}
          {ZELLE_NICHT_ANWENDBAR.label}
          {/* Die Marke einer Zelle mit Erläuterung (LLH-1110), als Zeichen mit ihrem Wort. */}
          {' · '}
          <ErlaeuterungsZeichen lfh="legende-erlaeuterung" /> mit Erläuterung
        </Typography.Text>
        {laedt && (
          <Typography.Text style={monoStil(token.fontSize)}>Bewertungen laden …</Typography.Text>
        )}
      </div>
      <Table<ZeilenDaten>
        rowKey="typ"
        columns={spalten}
        dataSource={zeilen}
        pagination={false}
        // Stehende Kopfzeile — Restposten der Ausnahme in `katalogTabelle.guard.test.ts`; sie steht
        // unter dem klebenden Rahmen (LFH-952, `frontend/AGENTS.md`, Rahmen).
        sticky={druckt ? false : { offsetHeader: rahmenOben }}
        scroll={{ x: 'max-content' }}
        ref={tabelleRef}
        className="gefahren-matrix"
      />
      {!laedt && (
        <GefahrenErlaeuterungen
          matrix={matrix}
          onWaehlen={(z) => {
            // Mit Schreibrecht ist die Erläuterung zu bearbeiten, ohne zu finden (LLH-1110).
            if (darfSchreiben) setDetailKennung({ typ: z.gefahrentyp, objekt: z.schutzobjekt });
            else setHervorgehoben(zellSchluessel(z.gefahrentyp, z.schutzobjekt));
          }}
        />
      )}
      <GefahrenZelleDetails
        offen={detailKennung !== null}
        // Die stabile Kennung trennt „anderer Datensatz" von „derselbe, frisch geladen"; nur
        // Ersteres belegt das Formular neu (siehe `GefahrenZelleDetails`).
        kennung={detailSchluessel}
        zelle={detailZelle}
        titel={detailTitel}
        laeuft={detailSchluessel !== null && laufendeZelle === detailSchluessel}
        // `onDetailsSpeichern`, nicht `onSetzen`: die Hülle leert nur, wenn der PUT angenommen
        // wurde. `warnstufe` kommt aus der abgeleiteten Zelle, nicht aus dem Zustand; ohne Zeile
        // gilt die Vorgabe „keine“.
        onSpeichern={(beschreibung, gemeldetVon) =>
          onDetailsSpeichern({
            gefahrentyp: detailKennung!.typ,
            schutzobjekt: detailKennung!.objekt,
            warnstufe: zellStufe(detailZelle ?? undefined),
            beschreibung,
            gemeldet_von: gemeldetVon,
          })
        }
        fehler={detailsFehler}
        onSchliessen={() => {
          setDetailKennung(null);
          onDetailsSchliessen?.();
        }}
      />
    </>
  );
}
