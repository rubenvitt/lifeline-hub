import type { CSSProperties } from 'react';
import { Flex, Progress, Typography } from 'antd';
import type { UploadFortschritt } from '../api/client';

/**
 * Stand einer laufenden Datei-Übertragung in einem Dialog (LFH-654; Prüfliste LFH-632, Zeile
 * 2 · 3, MIL-STD-1472 5.14.9: über 15 s nur mit Fortschrittsmeldung).
 *
 * Drei Zustände: `senden` mit Prozent aus den übertragenen Bytes, `senden` ohne Zahl (der
 * Browser kennt die Gesamtgröße nicht) und `pruefen` (letztes Byte beim Server, Virenscan und
 * Speichern laufen). Der Balken läuft in beiden ohne Zahl voll und `active`: eine Zahl, die es
 * nicht gibt, wird nicht erfunden.
 *
 * Ansage: das sichtbare Etikett ist KEINE Live-Region — sie spräche bei jedem
 * `progress`-Ereignis. Angesagt wird über eine eigene, unsichtbare Region in 10-%-Schritten und
 * beim Phasenwechsel; den genauen Wert trägt der Balken (`aria-valuenow`).
 */
export function sichtbarerText(stand: UploadFortschritt): string {
  if (stand.phase === 'pruefen') return 'Datei wird geprüft';
  if (stand.anteil == null) return 'Wird hochgeladen';
  return `Wird hochgeladen · ${prozent(stand.anteil)} %`;
}

export function ansageText(stand: UploadFortschritt): string {
  if (stand.phase === 'pruefen' || stand.anteil == null) return sichtbarerText(stand);
  return `Wird hochgeladen · ${Math.floor(prozent(stand.anteil) / 10) * 10} %`;
}

const prozent = (anteil: number) => Math.min(100, Math.max(0, Math.floor(anteil * 100)));

/** Nur für Vorlesewerkzeuge, ohne Fläche (kein Sprung, kein Fokusziel). */
const NUR_VORLESEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

export default function UploadFortschrittAnzeige({ stand }: { stand: UploadFortschritt | null }) {
  if (stand == null) return null;
  const text = sichtbarerText(stand);
  const zahl = stand.phase === 'senden' && stand.anteil != null ? prozent(stand.anteil) : null;
  return (
    <Flex vertical>
      <Typography.Text aria-hidden>{text}</Typography.Text>
      <Progress
        percent={zahl ?? 100}
        status="active"
        showInfo={false}
        aria-label={text}
        // Ohne Zahl kein Wert: antd setzte sonst `aria-valuenow="100"`.
        aria-valuenow={zahl ?? undefined}
      />
      <span aria-live="polite" style={NUR_VORLESEN}>
        {ansageText(stand)}
      </span>
    </Flex>
  );
}
