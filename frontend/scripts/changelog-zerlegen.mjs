/**
 * Zerlegt die `CHANGELOG.md` in Einträge für die Neuigkeiten-Seite (Spec `neuigkeiten`).
 *
 * Die Datei liegt zur Build-Zeit ein. Jede Versionsüberschrift `## [version](link) (datum)` ist
 * ein Eintrag; der Text reicht bis zur nächsten. Der Kanal folgt aus dem Versionssuffix.
 *
 * Eine `## `-Zeile, die sich nicht als Versionsüberschrift lesen lässt, wirft: ein stiller
 * Fehlgriff würde sonst einen Eintrag verschlucken oder in den Text des vorigen mischen. Der
 * Aufrufer (`vite.config.ts`) lässt den Build dann rot werden.
 *
 * Eine Zeile in einem Codeblock ist nie Überschrift.
 *
 * Liegt neben `src/`, weil `tsc -b` für `vite.config.ts` sonst `.js` neben die Quelle schriebe
 * (vgl. `frontend/src/marke`).
 */

// Zwei Formen: `## [version](link) (datum)` (seit dem Vergleichslink) und `## version (datum)`
// (ältere Einträge ohne Link). Der Link fehlt dann, das Datum kann in beiden Formen fehlen.
const VERSIONSKOPF =
  /^## (?:\[([^\]]+)\]\(([^)]*)\)|([^\s[\]()]+))(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;

/** Kanal aus der Versionsnummer: `-alpha.N`, `-beta.N`, sonst stabil. */
export function kanalVon(version) {
  if (/-alpha\./.test(version)) return 'alpha';
  if (/-beta\./.test(version)) return 'beta';
  return 'stabil';
}

/**
 * @param {string} text Inhalt der CHANGELOG.md.
 * @returns {Array<{version: string, link: string, datum: string | null, kanal: string, text: string}>}
 *   In der Reihenfolge der Datei, also neueste zuerst.
 */
export function zerlegeChangelog(text) {
  const eintraege = [];
  let aktuell = null;
  let imCode = false;

  for (const zeile of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(zeile)) imCode = !imCode;

    if (!imCode && zeile.startsWith('## ')) {
      const treffer = VERSIONSKOPF.exec(zeile);
      if (!treffer) {
        throw new Error(`CHANGELOG: Versionsüberschrift nicht lesbar: "${zeile}"`);
      }
      const [, versionMitLink, link, versionOhneLink, datum] = treffer;
      const version = versionMitLink ?? versionOhneLink;
      aktuell = {
        version,
        link: link ?? null,
        datum: datum ?? null,
        kanal: kanalVon(version),
        zeilen: [],
      };
      eintraege.push(aktuell);
      continue;
    }

    if (aktuell) aktuell.zeilen.push(zeile);
  }

  return eintraege.map(({ zeilen, ...rest }) => ({ ...rest, text: zeilen.join('\n').trim() }));
}
