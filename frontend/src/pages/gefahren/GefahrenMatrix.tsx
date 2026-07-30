import { useState } from 'react';
import { Button, Dropdown, Space, Table, Tooltip, Typography, theme } from 'antd';
import { TbBuildingCommunity, TbPaw, TbPlant2, TbShieldHalf, TbUsers } from 'react-icons/tb';
import type { IconType } from 'react-icons';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import type { BewertungEingabe } from '../../api/gefahren';
import { flaechenFarbe, warnstufeFlaeche } from '../../theme/statusFarben';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig } from './gefahrenSchema';
import GefahrenZelleDetails from './GefahrenZelleDetails';

interface ZeilenDaten { typ: Gefahrentyp; label: string; }

/** Symbol + Kurzform je Schutzobjekt. Der Kopf trug vorher das volle Wort und war mit
 *  ~85 px nie breitenbestimmend — die Zelle ist es. Das Symbol ist deshalb Gewinn an
 *  Lesbarkeit, nicht an Breite; das Kurzwort bleibt als zweiter Kanal daneben stehen. */
const SPALTENKOPF: Record<Schutzobjekt, { icon: IconType; kurz: string }> = {
  menschen: { icon: TbUsers, kurz: 'Mensch' },
  tiere: { icon: TbPaw, kurz: 'Tier' },
  umwelt: { icon: TbPlant2, kurz: 'Umwelt' },
  sachwerte: { icon: TbBuildingCommunity, kurz: 'Sache' },
  einsatzkraefte: { icon: TbShieldHalf, kurz: 'Kraft' },
};

/** EINE Schreibweise für die Zell-Identität. Die Seite bildet den Schlüssel der
 *  laufenden Mutation mit derselben Funktion — zwei Schreibweisen und die Sperre
 *  greift stillschweigend nie. */
export function zellSchluessel(typ: Gefahrentyp, objekt: Schutzobjekt): string {
  return `${typ}×${objekt}`;
}

export interface GefahrenMatrixProps {
  matrix: GefahrBewertung[];
  darfSchreiben: boolean;
  /**
   * Die Zelle, deren PUT unterwegs ist (`zellSchluessel`), oder `null`.
   *
   * Vorher stand hier `pending: boolean` und sperrte alle 58 bedienbaren Zellen —
   * in einer Maske, die im Minutentakt bedient wird, ein Vollstopp pro Klick.
   */
  laufendeZelle: string | null;
  /** Stufenwechsel aus dem Menü. Kein Formularzustand zu schützen → `mutate` genügt. */
  onSetzen: (daten: BewertungEingabe) => void;
  /**
   * Speichern aus dem Detail-Dialog. **Muss bei Ablehnung ablehnen** — also
   * `mutateAsync`, nicht `mutate` (`components/Erfassung.tsx:121-124`).
   *
   * Zwei Wege statt einem, weil sie verschieden enden: ein abgelehnter Stufenwechsel
   * kostet nichts, ein abgelehntes Detail-Speichern kostet den getippten Wortlaut. Gäbe
   * es hier nur `onSetzen` (`=> void`), löste die Hülle sofort auf, leerte die Felder
   * und schlösse den Dialog — auch bei 422. Genau der Fehler, gegen den die Hülle
   * gebaut wurde.
   */
  onDetailsSpeichern: (daten: BewertungEingabe) => Promise<unknown>;
}

/** Das 13×5-Raster eines Gefahrengebiets. Einziger Konsument ist `GefahrenPage`;
 *  der frühere Hinweis auf einen „Karten-Drawer" beschrieb keinen. */
export default function GefahrenMatrix({
  matrix, darfSchreiben, laufendeZelle, onSetzen, onDetailsSpeichern,
}: GefahrenMatrixProps) {
  const { token } = theme.useToken();
  const [detailZelle, setDetailZelle] = useState<GefahrBewertung | null>(null);

  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
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
        onCell: (zeile: ZeilenDaten) => ({
          style: {
            backgroundColor: flaechenFarbe(
              zelleVon(zeile.typ, obj.wert)?.warnstufe ?? 'keine',
              token,
            ),
            textAlign: 'center' as const,
          },
        }),
        render: (_: unknown, zeile: ZeilenDaten) => {
          if (!kombinationGueltig(zeile.typ, obj.wert)) {
            // Zweiter Kanal für den gesperrten Zustand ist TEXT, nicht Blässe (WCAG 1.4.1):
            // eine ausgegraute Fläche ohne Wort ist von „noch nicht bewertet" nicht zu
            // unterscheiden. Kein Knopf — ein deaktivierter Auslöser gibt vor, es gäbe
            // hier eine Entscheidung.
            return (
              <Typography.Text type="secondary" aria-label={`${zeile.label} × ${obj.label}: nicht anwendbar`}>
                n. a.
              </Typography.Text>
            );
          }
          const zelle = zelleVon(zeile.typ, obj.wert);
          const aktuell: Warnstufe = zelle?.warnstufe ?? 'keine';
          const schluessel = zellSchluessel(zeile.typ, obj.wert);
          const items = [
            ...WARNSTUFEN.map((w) => ({
              key: w.wert,
              label: `${warnstufeFlaeche[w.wert].kuerzel} · ${w.label}`,
            })),
            ...(zelle ? [{ type: 'divider' as const }, { key: 'details', label: 'Details …' }] : []),
          ];
          return (
            <Dropdown
              trigger={['click']}
              // `autoFocus` steht AM DROPDOWN, nicht im `menu`-Objekt: antd führt es in
              // `DropdownProps`, `MenuProps` kennt es nicht (`antd/es/dropdown/dropdown.d.ts:35`).
              // Gleiche Schreibweise wie `etb/MetaChip.tsx:152`.
              autoFocus
              disabled={!darfSchreiben || laufendeZelle === schluessel}
              menu={{
                items,
                // Zuordnung AM MENÜ, nicht je Eintrag: ein Riegel hat dann einen Ort,
                // und das Synthetic Event des Portals steigt nicht in einen klickbaren
                // Elternteil (Muster und Falle aus LFH-365).
                onClick: ({ key }) => {
                  if (key === 'details') { setDetailZelle(zelle ?? null); return; }
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
                // Der Name trägt die ZEILENKENNUNG und die Stufe: 58 gleichnamige
                // Knöpfe wären für Screenreader und Test gleich unbrauchbar.
                aria-label={`Bewertung ${zeile.label} × ${obj.label}: ${warnstufeFlaeche[aktuell].label}`}
                // Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider
                // (30/48/72). `minWidth` = Höhe hält die Zelle quadratisch, damit die
                // Matrix in jeder Dichtestufe im Breitenbudget bleibt.
                style={{ minWidth: token.controlHeight }}
              >
                {warnstufeFlaeche[aktuell].kuerzel}
              </Button>
            </Dropdown>
          );
        },
      };
    }),
  ];
  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <>
      <Table<ZeilenDaten>
        rowKey="typ"
        columns={spalten}
        dataSource={zeilen}
        pagination={false}
        // Stehende Kopfzeile — der benannte Restposten der Guard-Ausnahme in
        // `katalogTabelle.guard.test.ts`. 13 Zeilen scrollen im Fükw nicht, auf dem
        // Handschirm schon.
        sticky
        scroll={{ x: 'max-content' }}
      />
      <GefahrenZelleDetails
        offen={detailZelle !== null}
        zelle={detailZelle}
        titel={
          detailZelle
            ? `${GEFAHRENTYPEN.find((g) => g.wert === detailZelle.gefahrentyp)?.label ?? detailZelle.gefahrentyp}`
              + ` × ${SCHUTZOBJEKTE.find((s) => s.wert === detailZelle.schutzobjekt)?.label ?? detailZelle.schutzobjekt}`
            : ''
        }
        laeuft={detailZelle !== null && laufendeZelle === zellSchluessel(detailZelle.gefahrentyp, detailZelle.schutzobjekt)}
        // `onDetailsSpeichern`, NICHT `onSetzen`: die Hülle darf die Felder nur leeren,
        // wenn der PUT angenommen wurde. Das zurückgegebene Promise ist die Zusage —
        // ein `async`-Wrapper um ein `=> void` wäre eine Zusage ohne Deckung.
        onSpeichern={(beschreibung, gemeldetVon) =>
          onDetailsSpeichern({
            gefahrentyp: detailZelle!.gefahrentyp,
            schutzobjekt: detailZelle!.schutzobjekt,
            warnstufe: detailZelle!.warnstufe,
            beschreibung,
            gemeldet_von: gemeldetVon,
          })
        }
        onSchliessen={() => setDetailZelle(null)}
      />
    </>
  );
}
