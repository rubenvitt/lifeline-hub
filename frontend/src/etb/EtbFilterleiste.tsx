import { DatePicker, Input, Space } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import { abstand } from '../theme/tokens';
import { alsBackendZeit, alsOrtszeit } from './filterZeit';

/**
 * Filterleiste des Einsatztagebuchs.
 *
 * **Zwei Quellen für einen Filter — bewusst geduldet, nicht übersehen (LFH-331 · B3).**
 * Diese Leiste hält in `werte` eine eigene Kopie des Filters, und ihre vier Felder sind
 * unkontrolliert: den sichtbaren Stand kennt allein das DOM. `EtbPage` hält denselben
 * Filter ein zweites Mal, weil er in den Query-Key geht. Beide Stände laufen nur deshalb
 * nicht auseinander, weil `aktualisiere` sie bei jeder Änderung zusammenführt.
 *
 * **Folge für „Filter zurücksetzen":** ein Reset, der nur den Seitenzustand räumt, ließe
 * die sichtbaren Eingaben stehen — und der nächste Tastendruck mischte die alte Kopie über
 * `{ ...werte, ...teil }` wieder ein. Der Aufrufer setzt die Leiste deshalb per `key` neu
 * auf (`pages/EtbPage.tsx`), statt sie zu kontrollieren.
 *
 * **Warum weiterhin nicht kontrolliert (LFH-342 · C7):** die Umkehr von
 * {@link alsBackendZeit} EXISTIERT jetzt — `etb/filterZeit.ts`, mit einem Test beidseits
 * beider Sommerzeit-Grenzen, weil ihr Fehlermodus eine STILLE Verschiebung um den
 * Zonenversatz ist: kein roter Test, kein Fehlerbild, nur ein falscher Zeitraum in der
 * Führungsunterlage. Damit ist der Grund entfallen, der die Hydrierung verhinderte — aber
 * nicht der Grund gegen die laufende Zwei-Wege-Bindung. Die Leiste nimmt ihren
 * ANFANGSSTAND aus `startWerte` (einmalig, über `defaultValue`) und bleibt danach die
 * Quelle des sichtbaren Standes. Das Remount per `key` bleibt der Weg, sie zurückzusetzen.
 *
 * **Die Entprellung liegt HIER und nicht in der Seite (Befund M80).** Nur die Leiste
 * unterscheidet die Achsen: `q` wächst zeichenweise, `typ`/`von`/`bis` springen. Eine
 * Entprellung in `EtbPage` verzögerte auch die Auswahl eines Typs — Wartezeit ohne Nutzen.
 * Der sichtbare Text hängt bewusst NICHT an der Frist; verzögert wird allein die Meldung
 * nach außen, sonst sähe die Bedienung aus wie ein hängendes Feld.
 *
 * **Der Typ gehört seit dem Neuentwurf (S4, 21.09.2026) NICHT mehr hierher**, sondern der
 * Segmentleiste im Seitenkopf. Damit liefen zwei Filterquellen mit verschiedener Frist
 * nebeneinander, und die Leiste meldet deshalb nur noch IHRE Schlüssel (`q`, `von`, `bis`)
 * — nie den ganzen Filter aus ihrer Kopie. Meldete sie den ganzen, überschriebe ein
 * Nachläufer der Suchfrist den eben gewählten Typ mit einem Stand, der ihn nicht kennt.
 * Zusammengeführt wird in der Seite gegen den AKTUELLEN Filter
 * (`zeitachseModell.ts`, `filterZusammenfuehren`).
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
   * Kontrollierte Filter der SEITE, die in derselben Zeile stehen sollen (LFH-616: die
   * Einheit). Sie sind hier nur zu Gast — die Leiste meldet sie nicht, ihre Quelle ist die
   * URL wie beim Typ oben; sonst liefe die Zwei-Quellen-Frage aus dem Dateikopf ein drittes
   * Mal.
   */
  zusatz?: ReactNode;
}

/** Frist der Volltext-Entprellung. ~300 ms ist die Vorgabe aus dem Befund M80. */
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
      <DatePicker
        showTime
        placeholder="von"
        defaultValue={alsOrtszeit(startWerte?.von)}
        onChange={(d) => aktualisiere({ von: d ? alsBackendZeit(d) : undefined })}
      />
      <DatePicker
        showTime
        placeholder="bis"
        defaultValue={alsOrtszeit(startWerte?.bis)}
        onChange={(d) => aktualisiere({ bis: d ? alsBackendZeit(d) : undefined })}
      />
      {zusatz}
    </Space>
  );
}
