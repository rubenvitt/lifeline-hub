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
 * Die Linie ist nicht neu: `einsatz/einsatzStatus.ts` trägt den Vertragstyp
 * `StatusDarstellung` und liegt trotzdem bewusst außerhalb von `statusFarben.ts` — mit
 * derselben Begründung (dessen Abdeckungsguard zählt gegen ein `toHaveLength`, ein
 * Eintrag mehr ist eine Vertragsänderung, kein Nebenprodukt). Dies ist die zweite
 * Anwendung, nicht eine Ausrede für diesen einen Fall.
 *
 * WAS DIE UMSTELLUNG FARBLICH BEWIRKT — gemessen, nicht per Analogie behauptet: `PHASE_META`
 * führt antds STATUS-Farben (`default`/`processing`/`success`/`error`), keine Presets.
 * `antd/lib/tag/style/statusCmp.js` löst `ant-tag-success` über
 * `colorSuccess`/`colorSuccessBg`/`colorSuccessBorder` auf, und `theme/tokens.ts`
 * (`antdToken`) setzt `colorSuccess: farben.normal`. Der Kopf ist damit VON antds eigener
 * Green-Palette (`presetCmp.js`, in `tokens.ts` nirgends vertreten) AUF die Rollenpalette
 * gewandert. `PHASE_META.offen = 'default'` bekommt zwar die Klasse, aber keine Regel in
 * `statusCmp` und fällt auf die Basis-Gestaltung des Tags zurück — ebenfalls Projekt-Tokens.
 * Nicht behauptet wird, das repariere den Nachtmodus: beide Paletten folgen dem Algorithmus,
 * geändert hat sich WELCHE.
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
 *
 * SEIN BLINDFLECK, und der gehört zum Vertrag wie bei `queryKeyScan.ts`: ein
 * VERSCHACHTELTES `<Space>` innerhalb der Gruppe schließt den Schnitt zu früh. Steht es
 * VOR den Etiketten, fällt das laut auf (der `<Tag>`-Nachweis unten wird rot); steht es
 * DAHINTER, bliebe ein `<Tag color=…>` im abgeschnittenen Rest unsichtbar. Ein
 * Klammerzähler wäre die Antwort darauf — heute ist der Fall hypothetisch, der Kopf
 * trägt genau drei Etiketten und kein zweites `Space`.
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
    // `[^>]*` statt `\s+`: `<Tag style={{…}} color="green">` matchte sonst nicht, und
    // Prettier sortiert JSX-Attribute nicht um. Beide Reihenfolgen kommen im Bestand vor
    // (`meldungen/MeldungKarte.tsx` color-first, `erinnerung/ErinnerungKarte.tsx` style-first).
    expect(gruppe, `${datei}: kein handgeschriebenes Tag-Preset`).not.toMatch(
      /<Tag(?=[\s>])[^>]*\scolor=/,
    );
    // Der Schnitt hat wirklich die Gruppe erwischt — sonst prüfte die Zeile darüber
    // eine leere Zeichenkette gegen eine Abwesenheit und wäre immer grün. Zugleich die
    // Gegenprobe gegen das bloße Entfernen der Etikettengruppe.
    expect(gruppe, `${datei}: der Schnitt enthält die Etiketten`).toContain('<Tag>');
  });

  it.each(KOEPFE)('%s schreibt den Wortlaut nicht ab, sondern liest ihn', (datei, zugriff) => {
    const gruppe = etikettengruppe(lies(datei), datei);
    // „Freigegeben" als Literal ist die belastbare Gegenprobe; „Entwurf" trägt daneben
    // die Knopfbeschriftung „Entwurf speichern" und taugt dafür nicht.
    // Alle drei Quote-Stile: `toContain("'…'")` liefe an `"Freigegeben"` vorbei.
    expect(gruppe, `${datei}: Statuslabel nicht abgeschrieben`).not.toMatch(
      /['"`]Freigegeben['"`]/,
    );
    expect(gruppe, `${datei}: liest die Achse`).toContain(zugriff);
    const badges = gruppe.match(/<StatusBadge/g) ?? [];
    expect(badges, `${datei}: genau ein Statusetikett im Kopf`).toHaveLength(1);
  });
});
