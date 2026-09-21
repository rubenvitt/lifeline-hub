import { Button, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import { useRollen } from '../../components/instrument';
import type { Datenzustand } from './lagebild';

/**
 * Laden · Fehler · Leer im Körper eines Dashboard-Paneels — drei Zustände, drei
 * Erscheinungen (LFH-331 · B3). Der Sweep-Befund lautete „Fehler sieht aus wie leer": eine
 * tote Abfrage rendert denselben Leerzustand wie „nichts vorhanden", und wer in dem Moment
 * ans Funkgerät geht, meldet eine falsche Lage. Der Wortlaut ist der der früheren Kacheln
 * und bleibt es, weil die Tests ihn pinnen.
 *
 * Lokal gebaut: die Instrument-Bausteine kennen keinen Paneel-Leib-Zustand (gemeldet im
 * Bericht). Die Knöpfe sind antd-`Button` und erben `controlHeight` vom `ConfigProvider`.
 */
export default function PaneelZustand({
  zustand,
  titel,
  leerText,
  leerAktion,
  onLeerAktion,
  onNeuladen,
  children,
}: {
  zustand: Datenzustand;
  /** Paneeltitel — benennt den Ladezustand für Vorlesende. */
  titel: string;
  leerText: string;
  leerAktion: string;
  onLeerAktion: () => void;
  onNeuladen: () => void;
  children: ReactNode;
}) {
  const { token, rollen } = useRollen();
  const polster = { padding: token.padding } as const;

  if (zustand === 'laden') {
    return (
      <div aria-busy="true" aria-label={`${titel} wird geladen`} style={polster}>
        <Skeleton active title={false} paragraph={{ rows: 3 }} />
      </div>
    );
  }
  if (zustand === 'fehler') {
    return (
      <div role="alert" style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ color: rollen.alarm, fontSize: 13 }}>Daten nicht abrufbar</b>
        <span style={{ color: rollen.gedaempft, fontSize: 12 }}>
          Stand unbekannt — nicht als Lage melden. Letzter Abruf fehlgeschlagen.
        </span>
        <span>
          <Button onClick={onNeuladen}>Erneut abrufen</Button>
        </span>
      </div>
    );
  }
  if (zustand === 'leer') {
    return (
      <div style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ color: rollen.gedaempft, fontSize: 12 }}>{leerText}</span>
        <span>
          <Button onClick={onLeerAktion}>{leerAktion}</Button>
        </span>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Link-Knopf „… ↗" für den Paneelkopf. Der Pfeil ist Zeichen (Entscheidung 2 des
 * Auftraggebers) und `aria-hidden`: der zugängliche Name ist das Wort.
 */
export function PaneelLink({ label, onKlick }: { label: string; onKlick: () => void }) {
  const { token } = useRollen();
  return (
    <Button type="link" onClick={onKlick} style={{ paddingInline: token.paddingXS, fontSize: 12 }}>
      {label}
      <span aria-hidden="true" style={{ marginInlineStart: token.marginXXS }}>
        ↗
      </span>
    </Button>
  );
}
