import { Input, Space } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import { abstand } from '../theme/tokens';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';

/**
 * Filterleiste des Einsatztagebuchs.
 *
 * **Zwei Quellen für einen Filter — bewusst geduldet (LFH-331).** Die Leiste hält in `werte`
 * eine eigene Kopie, ihre Felder sind unkontrolliert: den sichtbaren Stand kennt allein das
 * DOM. `EtbPage` hält denselben Filter ein zweites Mal für den Query-Key. Beide laufen nicht
 * auseinander, weil `aktualisiere` sie bei jeder Änderung zusammenführt.
 *
 * **Folge für „Filter zurücksetzen":** ein Reset nur des Seitenzustands ließe die sichtbaren
 * Eingaben stehen, und der nächste Tastendruck mischte die alte Kopie wieder ein. Der Aufrufer
 * setzt die Leiste deshalb per `key` neu auf (`pages/EtbPage.tsx`).
 *
 * **Warum nicht kontrolliert:** die Umkehr von {@link alsBackendZeit} existiert
 * (`anzeige/zeitEingabe.ts`), aber eine laufende Zwei-Wege-Bindung bleibt unerwünscht. Die Leiste
 * nimmt ihren ANFANGSSTAND aus `startWerte` (einmalig, über `defaultValue`) und ist danach die
 * Quelle des sichtbaren Standes.
 *
 * **Die Entprellung liegt HIER und nicht in der Seite.** Nur die Leiste unterscheidet die
 * Achsen: `q` wächst zeichenweise, `von`/`bis` springen. Der sichtbare Text hängt NICHT an der
 * Frist; verzögert wird allein die Meldung nach außen.
 *
 * **Der Typ gehört der Segmentleiste im Seitenkopf**, nicht hierher. Die Leiste meldet deshalb
 * nur IHRE Schlüssel (`q`, `von`, `bis`) — meldete sie den ganzen Filter, überschriebe ein
 * Nachläufer der Suchfrist den eben gewählten Typ. Zusammengeführt wird in der Seite gegen den
 * AKTUELLEN Filter (`zeitachseModell.ts`, `filterZusammenfuehren`).
 */

/** Die Schlüssel, die diese Leiste führt. Ein geleerter Wert kommt als `undefined`. */
export type LeistenFilter = Pick<EtbFilterWerte, 'q' | 'von' | 'bis'>;

interface Props {
  /** Stand der drei eigenen Schlüssel — vollständig, geleerte als `undefined`. */
  onChange: (werte: LeistenFilter) => void;
  /**
   * Anfangsstand, üblicherweise aus der URL (`parseEtbFilter`). Wirkt einmalig beim
   * Aufbau — die Leiste ist danach die Quelle des sichtbaren Standes.
   */
  startWerte?: EtbFilterWerte;
  /**
   * Kontrollierte Filter der SEITE, die in derselben Zeile stehen sollen (LFH-616: die Einheit).
   * Die Leiste meldet sie nicht, ihre Quelle ist die URL wie beim Typ.
   */
  zusatz?: ReactNode;
}

/** Frist der Volltext-Entprellung. */
const ENTPRELLUNG_MS = 300;

export default function EtbFilterleiste({ onChange, startWerte, zusatz }: Props) {
  const [werte, setWerte] = useState<LeistenFilter>({
    q: startWerte?.q,
    von: startWerte?.von,
    bis: startWerte?.bis,
  });
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

  function aktualisiere(teil: Partial<LeistenFilter>, verzoegert = false) {
    // Leere Strings werden zu `undefined`: die Seite entfernt den Schlüssel dann, statt
    // einen leeren Query-Parameter zu schreiben. Die Schlüssel bleiben dabei im Objekt —
    // nur so erfährt die Seite, dass ein Wert GELEERT wurde.
    const neu: LeistenFilter = { ...werte, ...teil };
    (Object.keys(neu) as (keyof LeistenFilter)[]).forEach((k) => {
      if (neu[k] === '') neu[k] = undefined;
    });
    setWerte(neu);
    // Auch der SOFORT-Weg löscht eine laufende Frist: sonst überschriebe ein
    // Nachläufer aus dem Suchfeld gleich darauf das eben gewählte Datum mit einem
    // Stand, der es noch nicht kennt.
    if (frist.current) clearTimeout(frist.current);
    if (verzoegert) frist.current = setTimeout(() => onChange(neu), ENTPRELLUNG_MS);
    else onChange(neu);
  }

  return (
    <Space wrap data-lfh="etb-filterleiste" style={{ marginBottom: abstand.lg }}>
      <Input.Search
        placeholder="Volltextsuche"
        allowClear
        defaultValue={startWerte?.q}
        style={{ width: 220 }}
        onChange={(e) => aktualisiere({ q: e.target.value }, true)}
      />
      {/* Zeiten in der Anzeigezone — dieselbe, in der der Druckkopf sie nennt (LFH-692). */}
      <ZeitpunktEingabe
        placeholder="von"
        defaultValue={alsZeitpunkt(startWerte?.von)}
        onChange={(d) => aktualisiere({ von: d ? alsBackendZeit(d) : undefined })}
      />
      <ZeitpunktEingabe
        placeholder="bis"
        defaultValue={alsZeitpunkt(startWerte?.bis)}
        onChange={(d) => aktualisiere({ bis: d ? alsBackendZeit(d) : undefined })}
      />
      {zusatz}
    </Space>
  );
}
