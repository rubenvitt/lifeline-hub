import { DatePicker, Input, Space } from 'antd';
import { Select } from '../components/Select';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import { etbTyp } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';

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
 * **Warum nicht kontrolliert, was die Doppelung beseitigt hätte:** ein `value`-Prop
 * verlangte die Umkehr von {@link alsBackendZeit} — aus dem UTC-String wieder ein
 * `dayjs`-Objekt in Ortszeit. Deren Fehlermodus ist eine STILLE Verschiebung um den
 * Zonenversatz: kein roter Test, kein Fehlerbild, nur ein falscher Zeitraum in der
 * Führungsunterlage. Das Remount hat diesen Fehlermodus nicht. Wer die Leiste später doch
 * kontrolliert, braucht dafür zuerst einen Test über die Zeitachse.
 */

interface Props {
  onChange: (werte: EtbFilterWerte) => void;
}

const TYP_OPTIONEN = (Object.keys(etbTyp) as EtbTyp[]).map((t) => ({
  value: t,
  label: etbTyp[t].label,
}));

/** Wandelt einen dayjs-Zeitpunkt ins SQLite-/Backend-Format (UTC). */
function alsBackendZeit(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

export default function EtbFilterleiste({ onChange }: Props) {
  const [werte, setWerte] = useState<EtbFilterWerte>({});

  function aktualisiere(teil: Partial<EtbFilterWerte>) {
    const neu = { ...werte, ...teil };
    // Leere Strings/undefined entfernen, damit keine leeren Query-Parameter entstehen.
    (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
      if (neu[k] === undefined || neu[k] === '') delete neu[k];
    });
    setWerte(neu);
    onChange(neu);
  }

  return (
    <Space wrap style={{ marginBottom: abstand.lg }}>
      <Input.Search
        placeholder="Volltextsuche"
        allowClear
        style={{ width: 220 }}
        onChange={(e) => aktualisiere({ q: e.target.value })}
      />
      <Select
        placeholder="Typ"
        allowClear
        style={{ width: 150 }}
        options={TYP_OPTIONEN}
        onChange={(v?: EtbTyp) => aktualisiere({ typ: v })}
      />
      <DatePicker
        showTime
        placeholder="von"
        onChange={(d) => aktualisiere({ von: d ? alsBackendZeit(d) : undefined })}
      />
      <DatePicker
        showTime
        placeholder="bis"
        onChange={(d) => aktualisiere({ bis: d ? alsBackendZeit(d) : undefined })}
      />
    </Space>
  );
}
