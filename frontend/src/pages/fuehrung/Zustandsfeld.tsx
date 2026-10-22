import { Button, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import type { AbrufZustand } from '../../api/abrufZustand';
import { useRollen } from '../../components/instrument';
import { useModulWahl } from '../../einsatz/useModulWahl';

/**
 * Lade-, Fehler- und Leerzustand eines Paneels. `leer` gilt nur im Zustand `daten`: „lädt" und
 * „Stand unbekannt" sind kein Befund.
 */
export default function Zustandsfeld({
  zustand,
  leer,
  leerText,
  leerAktion,
  onNeuladen,
  children,
}: {
  zustand: AbrufZustand;
  leer: boolean;
  leerText: string;
  leerAktion?: { text: string; ziel: string };
  onNeuladen: () => void;
  children: ReactNode;
}) {
  const { token, rollen } = useRollen();
  const { waehle } = useModulWahl();
  const polster = { padding: token.padding } as const;
  if (zustand === 'laden') {
    // Die Form des Leerzustands (LFH-629): Satzzeile und, wo „leer“ eine Aktion trägt, ihr Platz
    // in Knopfhöhe. Nur der Satz allein war auf dem Handschirm 38 px niedriger als „leer“, und die
    // drei gestapelten Paneele schoben das letzte um über 100 px. Ob die Aktion kommt, steht beim
    // Rendern fest: der Körper der Seite wartet auf den Einsatz und damit auf das Schreibrecht.
    return (
      <div
        aria-busy="true"
        style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span style={{ fontSize: 12, color: rollen.gedaempft }}>wird abgerufen</span>
        {leerAktion && (
          <span>
            <Skeleton.Button active />
          </span>
        )}
      </div>
    );
  }
  if (zustand === 'gesperrt') {
    // Kein Ausfall (kein `alert`, kein Neuladen) und kein Leerzustand: der Grund steht da.
    return (
      <div style={{ ...polster, fontSize: 12, color: rollen.gedaempft }}>
        Modul nicht freigegeben.
      </div>
    );
  }
  if (zustand === 'fehler') {
    return (
      <div role="alert" style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: rollen.text2 }}>
          Stand unbekannt — Daten nicht abrufbar. Nicht als Lage melden.
        </span>
        <span>
          <Button onClick={onNeuladen}>Erneut abrufen</Button>
        </span>
      </div>
    );
  }
  if (leer) {
    return (
      <div style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: rollen.gedaempft }}>{leerText}</span>
        {leerAktion && (
          <span>
            <Button onClick={() => waehle(leerAktion.ziel)}>{leerAktion.text}</Button>
          </span>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
