import { DatePicker, Input, Space } from 'antd';
import { Select } from '../components/Select';
import { useEffect, useRef, useState } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import { etbTyp } from '../theme/statusFarben';
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
 */

interface Props {
  onChange: (werte: EtbFilterWerte) => void;
  /**
   * Anfangsstand, üblicherweise aus der URL (`parseEtbFilter`). Wirkt einmalig beim
   * Aufbau — die Leiste ist danach die Quelle des sichtbaren Standes.
   */
  startWerte?: EtbFilterWerte;
}

const TYP_OPTIONEN = (Object.keys(etbTyp) as EtbTyp[]).map((t) => ({
  value: t,
  label: etbTyp[t].label,
}));

/** Frist der Volltext-Entprellung. ~300 ms ist die Vorgabe aus dem Befund M80. */
const ENTPRELLUNG_MS = 300;

export default function EtbFilterleiste({ onChange, startWerte }: Props) {
  const [werte, setWerte] = useState<EtbFilterWerte>(startWerte ?? {});
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

  function aktualisiere(teil: Partial<EtbFilterWerte>, verzoegert = false) {
    const neu = { ...werte, ...teil };
    // Leere Strings/undefined entfernen, damit keine leeren Query-Parameter entstehen.
    (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
      if (neu[k] === undefined || neu[k] === '') delete neu[k];
    });
    setWerte(neu);
    // Auch der SOFORT-Weg löscht eine laufende Frist: sonst überschriebe ein
    // Nachläufer aus dem Suchfeld gleich darauf den eben gewählten Typ mit einem
    // Stand, der ihn noch nicht kennt.
    if (frist.current) clearTimeout(frist.current);
    if (verzoegert) frist.current = setTimeout(() => onChange(neu), ENTPRELLUNG_MS);
    else onChange(neu);
  }

  return (
    <Space wrap style={{ marginBottom: abstand.lg }}>
      <Input.Search
        placeholder="Volltextsuche"
        allowClear
        defaultValue={startWerte?.q}
        style={{ width: 220 }}
        onChange={(e) => aktualisiere({ q: e.target.value }, true)}
      />
      <Select
        placeholder="Typ"
        allowClear
        defaultValue={startWerte?.typ}
        style={{ width: 150 }}
        options={TYP_OPTIONEN}
        onChange={(v?: EtbTyp) => aktualisiere({ typ: v })}
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
    </Space>
  );
}
