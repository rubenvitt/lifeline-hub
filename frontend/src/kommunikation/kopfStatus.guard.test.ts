/**
 * Der Seitenkopf von Befehl und Lagebericht liest die Statusachse (`StatusBadge` über
 * `LAGEBERICHT_STATUS`/`BEFEHL_STATUS`), statt Farbe und Wort abzuschreiben — zwei
 * Farbbehandlungen desselben Enums wären der Fehlerfall.
 *
 * Die Phasenachse (`kommunikation/phase.ts`) bleibt AUSSERHALB des Statusfarb-Vertrags:
 * `PHASE_META` trägt keine `StatusDarstellung`, ein Umzug wäre eine Umschreibung samt acht
 * Konsumenten. Der Kartenguard erfasst sie deshalb nicht — die Grenze zwischen „steht im
 * Vertrag" und „gehört in den Vertrag".
 *
 * Quelltext-Pin, weil die Zusicherung eine ABWESENHEIT ist („kein handgeschriebenes Preset,
 * kein abgeschriebener Wortlaut"), die im DOM nicht belegbar ist. Die Wirkung prüfen die
 * Komponententests in `pages/*DetailPage.test.tsx`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hier = dirname(fileURLToPath(import.meta.url));
const src = join(hier, '..');
const lies = (relativ: string) => readFileSync(join(src, relativ), 'utf-8');

/** Datei → der Achsen-Zugriff, den ihr Kopf tragen muss. Handgeschriebene Literale, sonst
    prüfte der Guard die Achse gegen sich selbst. */
const KOEPFE = [
  ['pages/LageberichtDetailPage.tsx', 'LAGEBERICHT_STATUS[bericht.status]'],
  ['pages/BefehlDetailPage.tsx', 'BEFEHL_STATUS[befehl.status]'],
] as const;

/**
 * Die Etikettengruppe des Kopfes — und NUR sie, damit ein späteres Etikett weiter unten den
 * Guard nicht aus dem falschen Grund rot färbt. Findet der Schnitt den Anker nicht, WIRFT er:
 * eine leere Menge machte jede Abwesenheits-Aussage trivial wahr.
 *
 * BLINDFLECK: ein verschachteltes `<Space>` in der Gruppe schließt den Schnitt zu früh. Davor
 * fällt es laut auf, dahinter bliebe ein `<Tag color=…>` unsichtbar; heute trägt der Kopf kein
 * zweites `Space`.
 */
function etikettengruppe(inhalt: string, datei: string): string {
  const auf = inhalt.indexOf('<Space size={6} wrap');
  if (auf === -1) throw new Error(`${datei}: keine Etikettengruppe im Kopf gefunden`);
  const zu = inhalt.indexOf('</Space>', auf);
  if (zu === -1) throw new Error(`${datei}: Etikettengruppe nicht geschlossen`);
  return inhalt.slice(auf, zu);
}

describe('Seitenkopf-Status der Kommunikationsmodule (LFH-493)', () => {
  it.each(KOEPFE)('%s trägt kein Preset-`color` mehr am Etikett', (datei) => {
    const gruppe = etikettengruppe(lies(datei), datei);
    // `[^>]*` statt `\s+`: beide Attributreihenfolgen (`color` vor oder nach `style`) kommen vor.
    expect(gruppe, `${datei}: kein handgeschriebenes Tag-Preset`).not.toMatch(
      /<Tag(?=[\s>])[^>]*\scolor=/,
    );
    // Der Schnitt hat wirklich die Gruppe erwischt — sonst prüfte die Zeile darüber eine leere
    // Zeichenkette. Anker ist die Fassungsangabe `v{….version}` neben dem Statusetikett.
    expect(gruppe, `${datei}: der Schnitt enthält die Etiketten`).toMatch(/v\{\w+\.version\}/);
  });

  it.each(KOEPFE)('%s schreibt den Wortlaut nicht ab, sondern liest ihn', (datei, zugriff) => {
    const gruppe = etikettengruppe(lies(datei), datei);
    // „Freigegeben" als Literal ist die belastbare Gegenprobe („Entwurf" steht auch in „Entwurf
    // speichern"). Alle drei Quote-Stile, sonst liefe `"Freigegeben"` vorbei.
    expect(gruppe, `${datei}: Statuslabel nicht abgeschrieben`).not.toMatch(
      /['"`]Freigegeben['"`]/,
    );
    expect(gruppe, `${datei}: liest die Achse`).toContain(zugriff);
    const badges = gruppe.match(/<StatusBadge/g) ?? [];
    expect(badges, `${datei}: genau ein Statusetikett im Kopf`).toHaveLength(1);
  });
});
