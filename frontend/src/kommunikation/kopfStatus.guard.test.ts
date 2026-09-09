/**
 * Der Seitenkopf liest die Statusachse, statt sie abzuschreiben (LFH-493, Nachzug N1
 * aus LFH-348 · C13).
 *
 * WAS HIER AUF DEM SPIEL STAND: beide Detailköpfe malten
 * `<Tag color={istEntwurf ? 'default' : 'green'}>{istEntwurf ? 'Entwurf' : 'Freigegeben'}</Tag>`
 * — eine zweite, handgeschriebene Farb- und Wortbehandlung desselben Enums, während die
 * zugehörigen Listen (`LageberichtePage`, `BefehlListe`) längst `StatusBadge` über
 * `LAGEBERICHT_STATUS`/`BEFEHL_STATUS` fuhren. „Zwei Farbbehandlungen desselben Enums wären
 * der Fehlerfall, nicht der Kompromiss" (CLAUDE.md, LFH-341 · C6) — hier waren es zwei.
 *
 * DIE ENTSCHEIDUNG, die das Ticket verlangte: die Phasenachse (`kommunikation/phase.ts`)
 * bleibt AUSSERHALB des A2-Statusfarb-Vertrags, der Kopf zieht auf `StatusBadge`. Sie in
 * `theme/statusFarben.ts` zu heben wäre der Bestands-Sweep, den dessen Kopfkommentar
 * `kommunikation/phase.ts` namentlich verbietet — und träfe acht Konsumenten in vier
 * Modulen samt `unbearbeitet`-Zweikanal (C8/H47). Das bleibt ein eigenes Ticket.
 *
 * WARUM QUELLTEXT-PIN: die eine Hälfte der Zusicherung ist eine ABWESENHEIT — „kein
 * handgeschriebenes Preset, kein abgeschriebener Wortlaut". Im DOM ist sie nicht
 * belegbar: der Entwurfs-Zustand rendert vorher wie nachher `color="default"`, die
 * Farbklasse ändert sich dort also gar nicht, und ein abgeschriebenes Label sieht im
 * Baum genauso aus wie ein gelesenes. Die WIRKUNG der Umstellung (Phasenfarbe statt
 * Preset-Grün) prüfen die beiden Komponententests in `pages/*DetailPage.test.tsx`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hier = dirname(fileURLToPath(import.meta.url));
const src = join(hier, '..');
const lies = (relativ: string) => readFileSync(join(src, relativ), 'utf-8');

/** Datei → der Achsen-Zugriff, den ihr Kopf tragen muss. Handgeschriebene Literale,
 *  nicht aus den Konstanten gebaut: sonst prüfte der Guard die Achse gegen sich selbst. */
const KOEPFE = [
  ['pages/LageberichtDetailPage.tsx', 'LAGEBERICHT_STATUS[bericht.status]'],
  ['pages/BefehlDetailPage.tsx', 'BEFEHL_STATUS[befehl.status]'],
] as const;

/**
 * Die Etikettengruppe des Kopfes — und NUR sie.
 *
 * Ein Guard über die ganze Datei behauptete „der Kopf ist die einzige Stelle mit einem
 * `<Tag>`", statt es zu prüfen: ein späteres Prioritäts- oder Vorlagen-Etikett weiter
 * unten im Rumpf färbte ihn rot, ohne dass am Statusetikett etwas falsch wäre — ein
 * Gate, das aus dem falschen Grund rot geht, kostet die Zeit dessen, der es debuggt.
 * Der Schnitt trägt die Begründung deshalb selbst und WIRFT, wenn er den Anker nicht
 * findet: eine stillschweigend leere Menge machte jede Abwesenheits-Aussage trivial wahr.
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
    expect(gruppe, `${datei}: kein handgeschriebenes Tag-Preset`).not.toMatch(/<Tag\s+color=/);
    // Der Schnitt hat wirklich die Gruppe erwischt — sonst prüfte die Zeile darüber
    // eine leere Zeichenkette gegen eine Abwesenheit und wäre immer grün.
    expect(gruppe, `${datei}: der Schnitt enthält die Etiketten`).toContain('<Tag>');
  });

  it.each(KOEPFE)('%s schreibt den Wortlaut nicht ab, sondern liest ihn', (datei, zugriff) => {
    const gruppe = etikettengruppe(lies(datei), datei);
    // „Freigegeben" als Literal ist die belastbare Gegenprobe; „Entwurf" trägt daneben
    // die Knopfbeschriftung „Entwurf speichern" und taugt dafür nicht.
    expect(gruppe, `${datei}: Statuslabel nicht abgeschrieben`).not.toContain("'Freigegeben'");
    expect(gruppe, `${datei}: liest die Achse`).toContain(zugriff);
    const badges = gruppe.match(/<StatusBadge/g) ?? [];
    expect(badges, `${datei}: genau ein Statusetikett im Kopf`).toHaveLength(1);
  });

  it.each(KOEPFE)('%s behält die zwei farblosen Geschwister-Etiketten', (datei) => {
    // Gegenprobe: den Guard könnte man sonst erfüllen, indem man die Tag-Gruppe ganz
    // entfernt. Vorlage und Fassungsnummer stehen weiter daneben — sie tragen keine
    // Statusaussage und deshalb bewusst kein `color`.
    const gruppe = etikettengruppe(lies(datei), datei);
    const schlicht = gruppe.match(/<Tag>/g) ?? [];
    expect(schlicht, `${datei}: Vorlage und Version bleiben stehen`).toHaveLength(2);
  });
});
