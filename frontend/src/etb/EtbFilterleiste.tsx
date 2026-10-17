import { Input, theme } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import { abstand } from '../theme/tokens';

/**
 * Filterleiste des Einsatztagebuchs (LLH-1065, Spec `etb-filterleiste`, „Eine Filterleiste über
 * der Zeitachse“).
 *
 * **Eine Leiste, zwei Gruppen.** Ab `md` stehen alle Filter hier, in dieser Ordnung: `vorn`
 * (Typ-Segmente und der Umschaltknopf „System“, beides Typfilter), dann `mitte` (Zeitraum,
 * Einheit) und zuletzt der Volltext, der den Rest nimmt. Die erste Gruppe bricht nicht in sich;
 * reicht die Breite nicht (Bilanzspalte, Modulpanel, dichtere Stufen), steht die zweite Gruppe unter der
 * ersten. Unter `md` gibt die Seite kein `vorn` (der Typ rollt im Kopf) und klappt die Leiste
 * hinter „Filter (n)“.
 *
 * **Zwei Quellen für einen Filter — bewusst geduldet (LFH-331).** Die Leiste hält in `werte`
 * eine eigene Kopie ihres Suchfelds, das Feld ist unkontrolliert: den sichtbaren Stand kennt
 * allein das DOM. `EtbPage` hält denselben Filter ein zweites Mal für den Query-Key. Beide laufen
 * nicht auseinander, weil `aktualisiere` sie bei jeder Änderung zusammenführt.
 *
 * **Folge für „Filter zurücksetzen":** ein Reset nur des Seitenzustands ließe die sichtbare
 * Eingabe stehen, und der nächste Tastendruck mischte die alte Kopie wieder ein. Der Aufrufer
 * setzt die Leiste deshalb per `key` neu auf (`pages/EtbPage.tsx`).
 *
 * **Die Entprellung liegt HIER und nicht in der Seite:** `q` wächst zeichenweise. Der sichtbare
 * Text hängt NICHT an der Frist; verzögert wird allein die Meldung nach außen.
 *
 * **Typ, System, Zeitraum und Einheit gehören der Seite**, nicht dieser Leiste: sie sind
 * Sprungwerte aus der URL ohne Entprellung und stehen hier nur. Die Leiste meldet deshalb nur
 * IHREN Schlüssel (`q`) — meldete sie den ganzen Filter, überschriebe ein Nachläufer der Suchfrist
 * den eben gewählten Typ. Zusammengeführt wird in der Seite gegen den AKTUELLEN Filter
 * (`zeitachseModell.ts`, `filterZusammenfuehren`).
 */

/** Der Schlüssel, den diese Leiste führt. Ein geleerter Wert kommt als `undefined`. */
export type LeistenFilter = Pick<EtbFilterWerte, 'q'>;

interface Props {
  /** Stand des eigenen Schlüssels — geleert als `undefined`. */
  onChange: (werte: LeistenFilter) => void;
  /**
   * Anfangsstand, üblicherweise aus der URL (`parseEtbFilter`). Wirkt einmalig beim
   * Aufbau — die Leiste ist danach die Quelle des sichtbaren Standes.
   */
  startWerte?: EtbFilterWerte;
  /** Erste Gruppe: Typ-Segmente und der Umschaltknopf „System“ (ab `md`). */
  vorn?: ReactNode;
  /** Zweite Gruppe vor dem Volltext: Zeitraum und Einheit. */
  mitte?: ReactNode;
}

/** Frist der Volltext-Entprellung. */
const ENTPRELLUNG_MS = 300;

export default function EtbFilterleiste({ onChange, startWerte, vorn, mitte }: Props) {
  const { token } = theme.useToken();
  const [werte, setWerte] = useState<LeistenFilter>({ q: startWerte?.q });
  const frist = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Eine offene Frist beim Abbau löschen: die Leiste wird per `key` neu aufgesetzt
  // („Filter zurücksetzen"), und ein Nachläufer meldete danach den alten Suchbegriff
  // an eine Seite, die gerade geräumt hat.
  useEffect(
    () => () => {
      if (frist.current) clearTimeout(frist.current);
    },
    [],
  );

  function aktualisiere(teil: Partial<LeistenFilter>) {
    // Ein leerer String wird zu `undefined`: die Seite entfernt den Schlüssel dann, statt
    // einen leeren Query-Parameter zu schreiben. Der Schlüssel bleibt dabei im Objekt —
    // nur so erfährt die Seite, dass ein Wert GELEERT wurde.
    const neu: LeistenFilter = { ...werte, ...teil };
    if (neu.q === '') neu.q = undefined;
    setWerte(neu);
    if (frist.current) clearTimeout(frist.current);
    frist.current = setTimeout(() => onChange(neu), ENTPRELLUNG_MS);
  }

  const gruppe = { display: 'flex', alignItems: 'center', gap: token.marginXS, minWidth: 0 };
  return (
    <div
      data-lfh="etb-filterleiste"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.margin,
        rowGap: token.marginXS,
        marginBottom: abstand.lg,
      }}
    >
      {vorn != null && (
        <div data-lfh="etb-filter-typ" style={{ ...gruppe, maxWidth: '100%' }}>
          {vorn}
        </div>
      )}
      <div data-lfh="etb-filter-weitere" style={{ ...gruppe, flexWrap: 'wrap', flex: '1 1 420px' }}>
        {mitte}
        <Input.Search
          placeholder="Volltextsuche"
          aria-label="Volltextsuche"
          allowClear
          defaultValue={startWerte?.q}
          style={{ flex: '1 1 180px', minWidth: 180 }}
          onChange={(e) => aktualisiere({ q: e.target.value })}
        />
      </div>
    </div>
  );
}
