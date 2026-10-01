/**
 * Blendet Kommentarinhalt aus und behält die Zeilenzahl bei (Index = Zeile − 1).
 * Trägt den Block-Zustand über Zeilengrenzen, damit auch Fortsetzungszeilen fallen.
 *
 * Geteilt von den Farb-Guards (`theme/gate5.guard.test.ts`, `theme/cssFarbquelle.guard.test.ts`),
 * damit beide dieselbe Grenze haben: ein `//` blendet den Zeilenrest aus, auch in CSS und in
 * einem String. Das ergibt Falsch-Negative, nie Falsch-Positive.
 */
export function ohneKommentare(inhalt: string): string[] {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break; // Rest der Zeile liegt im Block
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen;
}
