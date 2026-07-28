import { Table, type TableProps } from 'antd';
import { useEffect, useMemo } from 'react';

/**
 * Geteiltes Tabellen-Primitiv der Katalog-/Verwaltungsseiten (LFH-329 · B1).
 *
 * Erfüllt Gate 2 der Bedien-Leitlinie („Tabelle nur, wenn verglichen wird — dann
 * vollständig") an genau EINER Stelle statt an dreizehn. Drei Merkmale setzt das
 * Primitiv unbedingt, sie gehören ihm und nicht dem Aufrufer:
 *
 * 1. **Waagerechter Scrollcontainer über die Spaltenbreite.** Auf schmalem Schirm wird
 *    die Tabelle angepasst, nicht in Karten aufgelöst (A1, Festlegung 2) — sie scrollt
 *    in sich und drückt die Seite nicht breit.
 * 2. **Stehende Kopfzeile.** Beim Scrollen bleibt die Spaltenbedeutung lesbar. Antd zieht
 *    Kopf und Körper dafür in zwei `<table>`-Elemente auseinander und schiebt eine
 *    verborgene Messzeile als erste Körperzeile ein — wer Zeilen im Test greift, muss
 *    daher auf die Datenzeile (`tr.ant-table-row`) verengen.
 * 3. **Fixierte Identifierspalte.** Die erste Spalte bleibt beim waagerechten Scrollen
 *    stehen. Fixiert wird ausdrücklich die MENSCHENLESBARE Kennung (Funkrufname,
 *    Bezeichnung, Ordnungsnummer), nie die Datenbank-Kennung — dagegen steht die
 *    DEV-Warnung unten.
 *
 * Alles Übrige (Zeilenschlüssel, Ladezustand, Blätterung, Leertext) bleibt beim Aufrufer:
 * die dreizehn Katalogseiten setzen es heute selbst und behalten es, was den
 * Migrations-Diff je Datei auf zwei Zeilen hält.
 *
 * Kein Spaltenschalter: die dreizehn Tabellen tragen höchstens sieben Spalten, alle
 * sichtbar. Die vierte Gate-2-Anforderung steht deshalb mit Verdikt „offen" in der
 * Prüfliste Einsatztauglichkeit dieser Familie.
 */
export type KatalogTabelleProps<T> = Omit<TableProps<T>, 'scroll' | 'sticky'>;

type Spalte<T> = NonNullable<TableProps<T>['columns']>[number];

/**
 * Der bewertbare Schlüssel eines Spaltenbezugs. Antd erlaubt neben `'name'` auch die
 * Pfadform `['meta', 'id']`; bewertet wird dann das letzte Glied, weil es das
 * angezeigte Feld benennt. Alles Nicht-Textliche (Zahl-Index) ist nicht bewertbar.
 */
function bezugsSchluessel<T>(spalte: Spalte<T> | undefined): string | undefined {
  if (!spalte || 'children' in spalte || !('dataIndex' in spalte)) return undefined;
  const bezug = spalte.dataIndex;
  const glied = Array.isArray(bezug) ? bezug[bezug.length - 1] : bezug;
  return typeof glied === 'string' ? glied : undefined;
}

export default function KatalogTabelle<T extends object>({
  columns,
  ...rest
}: KatalogTabelleProps<T>) {
  /**
   * Fixiert wird die ERSTE Spalte, nicht eine per Prop benannte: in allen dreizehn
   * Aufrufstellen ist sie bereits die menschenlesbare Kennung, ein Pflicht-Prop wäre
   * dort reine Zeremonie und würde driften. Nicht angetastet wird sie, wenn der
   * Aufrufer selbst eine Seite gewählt hat oder wenn dort eine Spaltengruppe steht —
   * eine Gruppe ist keine Blattspalte, ihre Fixierung wäre wirkungslos.
   */
  const fixierteSpalten = useMemo(() => {
    const erste = columns?.[0];
    if (!columns || !erste || erste.fixed !== undefined || 'children' in erste) return columns;
    return [{ ...erste, fixed: 'left' as const }, ...columns.slice(1)];
  }, [columns]);

  const identifier = bezugsSchluessel(columns?.[0]);
  useEffect(() => {
    if (!import.meta.env.DEV || identifier !== 'id') return;
    console.warn(
      '[KatalogTabelle] Die fixierte erste Spalte zeigt auf die Datenbank-Kennung. ' +
        'Die Bedien-Leitlinie verlangt dort eine menschenlesbare Kennung — ' +
        'Funkrufname, Bezeichnung oder Ordnungsnummer.',
    );
  }, [identifier]);

  return <Table<T> {...rest} columns={fixierteSpalten} scroll={{ x: 'max-content' }} sticky />;
}
