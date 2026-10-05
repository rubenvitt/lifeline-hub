import {
  IconGebaeudegruppe,
  IconPersonen,
  IconPfote,
  IconSchild,
  IconSpross,
  type Icon,
} from '../../icons';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, Dropdown, Space, Table, Tooltip, Typography, theme } from 'antd';
import type { GlobalToken, TableColumnsType, TableRef } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import { monoStil } from '../../components/instrument';
import type { BewertungEingabe } from '../../api/gefahren';
import { flaechenFarbe, warnstufeBalkenFarbe, warnstufeFlaeche } from '../../theme/statusFarben';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig } from './gefahrenSchema';
import GefahrenZelleDetails from './GefahrenZelleDetails';
import { useKopfFreiraum } from '../../components/KatalogTabelle';
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

/** Balken einer Matrixzelle — rein; ohne Warnstufe kein Balken. */
export function zellBalkenStil(farbe: string | null): { boxShadow?: string } {
  return farbe == null ? {} : { boxShadow: `inset 0 -3px 0 0 ${farbe}` };
}

/**
 * Fläche + Balken einer Matrixzelle zur Warnstufe — eine Stelle für Matrix und Palettenauszug. Der
 * Balken sitzt 3 px unten als Innenschatten (kein Layout, die Zeilenhöhe springt beim Umbewerten
 * nicht) und trägt die Skala niedrig → akut; die Fläche darunter die zwei Intensitäten aus dem
 * Flächenvertrag. Zweiter Kanal bleibt das Kürzel.
 */
export function zellFlaechenStil(
  stufe: Warnstufe,
  token: GlobalToken,
): { backgroundColor: string; boxShadow?: string } {
  return {
    backgroundColor: flaechenFarbe(stufe, token),
    ...zellBalkenStil(warnstufeBalkenFarbe(stufe, token)),
  };
}

/**
 * Die beiden Zellzustände ohne Warnstufe (LFH-969) — EINE Quelle für Matrix, Auszug und Legende,
 * damit dieselbe Zelle überall dasselbe Zeichen trägt. „–" heißt ausschließlich „keine": das ist
 * eine Meldung. Eine gültige Zelle ohne Bewertung ist eine Lücke und bleibt leer, sonst sähe eine
 * offene Beurteilung aus wie eine Entwarnung. `legende` ist das Wort für das Zeichen in der Legende,
 * weil sich ein leeres Zeichen nicht vorzeigen lässt; „unbewertet" wie im Lage-Dashboard.
 */
export const ZELLE_UNBEWERTET = {
  label: 'nicht bewertet',
  kuerzel: '',
  legende: 'leer',
  begriff: 'unbewertet',
} as const;

/** Ungültige Kombination: Text als zweiter Kanal, kein Knopf (WCAG 1.4.1). */
export const ZELLE_NICHT_ANWENDBAR = { label: 'nicht anwendbar', kuerzel: 'n. a.' } as const;

/** Wert für `data-warnstufe` einer gültigen Zelle ohne Bewertung. */
export const DATEN_UNBEWERTET = 'unbewertet';

/** Zähler über der Matrix: Einzahl, Mehrzahl, und die volle Matrix als eigener Satz. */
export function unbewertetText(anzahl: number): string {
  if (anzahl === 0) return 'Alle Felder bewertet';
  return `${anzahl} ${anzahl === 1 ? 'Feld' : 'Felder'} ${ZELLE_UNBEWERTET.begriff}`;
}

/** Die eine Schreibweise der Zell-Identität — auch für den Schlüssel der laufenden Mutation. */
export function zellSchluessel(typ: Gefahrentyp, objekt: Schutzobjekt): string {
  return `${typ}×${objekt}`;
}

export interface GefahrenMatrixProps {
  matrix: GefahrBewertung[];
  darfSchreiben: boolean;
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
}

/** Das 13×5-Raster eines Gefahrengebiets. */
export default function GefahrenMatrix({
  matrix,
  darfSchreiben,
  laufendeZelle,
  onSetzen,
  onDetailsSpeichern,
}: GefahrenMatrixProps) {
  const { token } = theme.useToken();
  // Freiraum unter der stehenden Kopfzeile beim Rückwärtstabben.
  const tabelleRef = useRef<TableRef>(null);
  useKopfFreiraum(tabelleRef);
  // Freiraum neben der fixierten Spalte beim Tabben nach links.
  useSpaltenFreiraum(tabelleRef);
  /**
   * Im Zustand steht die Kennung der Zelle, nicht ihr Datensatz. Eine Momentaufnahme vom Menüklick
   * würde von keinem Nachladen erreicht; der Detail-PUT schickt aber `warnstufe` mit und drehte
   * eine inzwischen gesetzte Stufe still zurück (zweiter Bediener, oder Stufe setzen und sofort
   * „Details …" öffnen).
   */
  const [detailKennung, setDetailKennung] = useState<Zellkennung | null>(null);

  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);

  const spalten: TableColumnsType<ZeilenDaten> = [
    {
      title: 'Gefahr',
      dataIndex: 'label',
      key: 'label',
      fixed: 'left',
      width: GEFAHR_SPALTE_BREITE,
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
          // Ohne Bewertung keine Fläche und kein Balken — und eine eigene Kennung, nicht „keine".
          const stufe = zelleVon(zeile.typ, obj.wert)?.warnstufe;
          return {
            'data-warnstufe': stufe ?? DATEN_UNBEWERTET,
            style: {
              ...(stufe ? zellFlaechenStil(stufe, token) : {}),
              textAlign: 'center' as const,
            },
          };
        },
        render: (_: unknown, zeile: ZeilenDaten) => {
          if (!kombinationGueltig(zeile.typ, obj.wert)) {
            // Zweiter Kanal für „ungültig" ist Text, nicht Blässe (WCAG 1.4.1). Kein Knopf — ein
            // deaktivierter Auslöser gäbe vor, es gäbe hier eine Entscheidung.
            return (
              <Typography.Text
                type="secondary"
                aria-label={`${zeile.label} × ${obj.label}: ${ZELLE_NICHT_ANWENDBAR.label}`}
              >
                {ZELLE_NICHT_ANWENDBAR.kuerzel}
              </Typography.Text>
            );
          }
          const zelle = zelleVon(zeile.typ, obj.wert);
          // Kein Rückfall auf „keine" (LFH-969): die Lücke ist ein eigener Zustand.
          const anzeige = zelle ? warnstufeFlaeche[zelle.warnstufe] : ZELLE_UNBEWERTET;
          const schluessel = zellSchluessel(zeile.typ, obj.wert);
          const items = [
            ...WARNSTUFEN.map((w) => ({
              key: w.wert,
              label: `${warnstufeFlaeche[w.wert].kuerzel} · ${w.label}`,
            })),
            ...(zelle
              ? [{ type: 'divider' as const }, { key: 'details', label: 'Details …' }]
              : []),
          ];
          return (
            <Dropdown
              trigger={['click']}
              // `autoFocus` steht am Dropdown: `MenuProps` kennt es nicht.
              autoFocus
              disabled={!darfSchreiben || laufendeZelle === schluessel}
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
                // Der Name trägt Zeilenkennung und Stufe: 58 gleichnamige Knöpfe wären unbrauchbar.
                aria-label={`Bewertung ${zeile.label} × ${obj.label}: ${anzeige.label}`}
                // Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider. `minWidth` = Höhe
                // hält die Zelle quadratisch und die Matrix im Breitenbudget.
                style={{ minWidth: token.controlHeight }}
              >
                {anzeige.kuerzel}
              </Button>
            </Dropdown>
          );
        },
      };
    }),
  ];
  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  // Je Render frisch aus `matrix` abgeleitet — so erreicht ein Nachladen den offenen Dialog.
  const detailZelle = detailKennung
    ? (zelleVon(detailKennung.typ, detailKennung.objekt) ?? null)
    : null;
  const detailSchluessel = detailKennung
    ? zellSchluessel(detailKennung.typ, detailKennung.objekt)
    : null;
  const detailTitel = detailKennung
    ? `${GEFAHRENTYPEN.find((g) => g.wert === detailKennung.typ)?.label ?? detailKennung.typ}` +
      ` × ${SCHUTZOBJEKTE.find((s) => s.wert === detailKennung.objekt)?.label ?? detailKennung.objekt}`
    : '';

  const unbewertet = GEFAHRENTYPEN.reduce(
    (summe, g) =>
      summe +
      SCHUTZOBJEKTE.filter((o) => kombinationGueltig(g.wert, o.wert) && !zelleVon(g.wert, o.wert))
        .length,
    0,
  );

  return (
    <>
      {/* Legende und Zähler (LFH-969): ohne sie wäre „–" neben einer leeren Zelle ein Rätsel. Als
          Text, nicht als Tooltip — den gibt es auf Touch nicht. */}
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
          {[
            ...WARNSTUFEN.map((w) => {
              const { kuerzel, label } = warnstufeFlaeche[w.wert];
              return `${kuerzel} ${label}`;
            }),
            `${ZELLE_UNBEWERTET.legende} ${ZELLE_UNBEWERTET.begriff}`,
            `${ZELLE_NICHT_ANWENDBAR.kuerzel} ${ZELLE_NICHT_ANWENDBAR.label}`,
          ].join(' · ')}
        </Typography.Text>
        <Typography.Text style={monoStil(token.fontSize)}>
          {unbewertetText(unbewertet)}
        </Typography.Text>
      </div>
      <Table<ZeilenDaten>
        rowKey="typ"
        columns={spalten}
        dataSource={zeilen}
        pagination={false}
        // Stehende Kopfzeile — Restposten der Ausnahme in `katalogTabelle.guard.test.ts`.
        sticky
        scroll={{ x: 'max-content' }}
        ref={tabelleRef}
        className="gefahren-matrix"
      />
      <GefahrenZelleDetails
        offen={detailKennung !== null}
        // Die stabile Kennung trennt „anderer Datensatz" von „derselbe, frisch geladen"; nur
        // Ersteres belegt das Formular neu (siehe `GefahrenZelleDetails`).
        kennung={detailSchluessel}
        zelle={detailZelle}
        titel={detailTitel}
        laeuft={detailSchluessel !== null && laufendeZelle === detailSchluessel}
        // `onDetailsSpeichern`, nicht `onSetzen`: die Hülle leert nur, wenn der PUT angenommen
        // wurde. `warnstufe` kommt aus der abgeleiteten Zelle, nicht aus dem Zustand; `'keine'`
        // greift nur, wenn die Zelle inzwischen aus der Matrix verschwunden ist.
        onSpeichern={(beschreibung, gemeldetVon) =>
          onDetailsSpeichern({
            gefahrentyp: detailKennung!.typ,
            schutzobjekt: detailKennung!.objekt,
            warnstufe: detailZelle?.warnstufe ?? 'keine',
            beschreibung,
            gemeldet_von: gemeldetVon,
          })
        }
        onSchliessen={() => setDetailKennung(null)}
      />
    </>
  );
}
