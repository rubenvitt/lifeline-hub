import { Descriptions, Space, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import type { Stab } from '../api/types';
import StatusTag from '../components/StatusTag';
import { etbPfad } from '../routing/deeplinks';
import { kuerzeEntschluss } from './lagebesprechungAbschluss';
import { lagebesprechungZustand } from './lagebesprechungZustand';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * „Jetzt" im 30-s-Takt. Kein geteilter Uhr-Hook im Repo (einziges `setInterval` außerhalb der
 * Tests ist der Autosave in `entwurf/useEntwurfVerlustschutz.ts`), und eine Anzeige braucht
 * keinen — nur `jetzt` ist State, die Rechnung bleibt rein.
 */
function useJetzt(taktMs: number): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    const uhr = setInterval(() => setJetzt(dayjs()), taktMs);
    return () => clearInterval(uhr);
  }, [taktMs]);
  return jetzt;
}

/**
 * Kopfblock der Sektion „Lagebesprechung" (Spec 10): Nächste · Letzte · Anzahl.
 *
 * Der Countdown tickt alle 30 s OHNE Toast und ohne Blinken (EEMUA-191-Budget): es ändert sich
 * nur der Wortlaut im `StatusTag`, die Tabelle wird nicht neu aufgebaut. Der Termin kommt aus
 * `StabAnzeige`, nicht aus dem Einsatzkopf — der steht im NICHT_LIVE-Fach (Spec Entsch. 11).
 *
 * `column={1}` fest wie auf allen Detail-Vollseiten des Bestands; `size="small"` ist an einer
 * nicht-interaktiven Fläche ein Abstandsmaß, keine Treffläche.
 */
export default function LagebesprechungStand({
  einsatzId,
  stab,
}: {
  einsatzId: number;
  stab: Stab;
}) {
  const { token } = theme.useToken();
  const jetzt = useJetzt(30_000);
  const termin = stab.naechste_lagebesprechung_at;
  const letzte = stab.letzte_lagebesprechung;

  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="Nächste">
        <Space wrap>
          {termin && <ZeitAnzeige wert={termin} />}
          <StatusTag darstellung={lagebesprechungZustand(termin, jetzt)} />
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="Letzte">
        {letzte ? (
          <Space wrap>
            <span>Nr. {letzte.lfd_nr}</span>
            <ZeitAnzeige wert={letzte.abgehalten_at} />
            <span title={letzte.entschluss}>{kuerzeEntschluss(letzte.entschluss)}</span>
            {/* Handgebautes Bedienziel: ein `<a>` erbt keine Steuerhöhe (LFH-396). */}
            <Link
              to={etbPfad(einsatzId, { eintrag: letzte.etb_eintrag_id })}
              style={stabZeilenzielStil(token)}
              aria-label={`ETB-Eintrag zu Lagebesprechung Nr. ${letzte.lfd_nr}`}
            >
              ETB-Eintrag
            </Link>
          </Space>
        ) : (
          'noch keine'
        )}
      </Descriptions.Item>
      <Descriptions.Item label="Anzahl">{stab.anzahl_lagebesprechungen}</Descriptions.Item>
    </Descriptions>
  );
}
