import { Button, Card, Tag, Typography } from 'antd';
import { useViewport } from '../../components/useViewport';
import type { BrEinheitKurz, BrFahrzeugKurz, Einheit, EinsatzFahrzeug } from '../../api/types';

interface Props {
  /** Alle Einheiten des Einsatzes (clientseitig gefiltert). */
  alleEinheiten: Einheit[];
  /** Alle Einsatz-Fahrzeuge des Einsatzes (clientseitig gefiltert). */
  alleFahrzeuge: EinsatzFahrzeug[];
  /** Aktuell im BR bereitgestellte Einheiten — werden aus der Anzeige ausgeblendet. */
  brEinheiten: BrEinheitKurz[];
  /** Aktuell im BR bereitgestellte Fahrzeuge — werden aus der Anzeige ausgeblendet. */
  brFahrzeuge: BrFahrzeugKurz[];
  schreibgeschuetzt: boolean;
  onZuweisenEinheit: (einheit: Einheit) => void;
  onZuweisenFahrzeug: (fahrzeug: EinsatzFahrzeug) => void;
}

/**
 * Sidebar „Kräfte ohne BR": zeigt Einheiten und einheitenlose Fahrzeuge mit
 * `aktueller_br_id == null` (in keinem BR bereitgestellt). Mitglieder des
 * aktuellen BR werden zusätzlich ausgeblendet — Defense-in-Depth, falls der
 * Listen-Cache und der BR-Detail-Cache kurzzeitig auseinanderlaufen.
 */
export default function KraefteOhneBrSidebar({
  alleEinheiten,
  alleFahrzeuge,
  brEinheiten,
  brFahrzeuge,
  schreibgeschuetzt,
  onZuweisenEinheit,
  onZuweisenFahrzeug,
}: Props) {
  const { abBreite } = useViewport();
  const breit = abBreite('md');
  const brEinheitIds = new Set(brEinheiten.map((e) => e.id));
  const brFahrzeugIds = new Set(brFahrzeuge.map((f) => f.id));

  // Einheiten in keinem BR (aktueller_br_id == null) und nicht im aktuellen BR
  const freieEinheiten = alleEinheiten.filter(
    (e) => e.aktueller_br_id == null && !brEinheitIds.has(e.id),
  );

  // Einheitenlose Fahrzeuge in keinem BR und nicht im aktuellen BR
  const freiFahrzeuge = alleFahrzeuge.filter(
    (f) => f.einheit_id == null && f.aktueller_br_id == null && !brFahrzeugIds.has(f.id),
  );

  const leer = freieEinheiten.length === 0 && freiFahrzeuge.length === 0;

  return (
    // Unter `md` volle Breite und gestapelt (LFH-341 · H40) — dieselbe Form wie bei
    // Gefahrengebietsliste und Gliederungsbaum. Die Zuweisung läuft hier ohnehin über
    // den „zuweisen"-Knopf, nicht über einen Drag: der Umbruch kostet keinen Bedienweg.
    <Card
      data-testid="kraefte-ohne-br"
      title="Kräfte ohne BR"
      size="small"
      style={breit ? { width: 240, minHeight: 400 } : { width: '100%' }}
    >
      {leer && (
        <Typography.Text type="secondary">keine freien Kräfte</Typography.Text>
      )}

      {freieEinheiten.map((e) => (
        <div key={`einheit-${e.id}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <Tag style={{ flex: 1, minWidth: 0 }}>{e.name}</Tag>
          {!schreibgeschuetzt && (
            <Button type="primary" onClick={() => onZuweisenEinheit(e)}>
              zuweisen
            </Button>
          )}
        </div>
      ))}

      {freiFahrzeuge.map((f) => (
        <div key={`fahrzeug-${f.id}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <Tag style={{ flex: 1, minWidth: 0 }}>{f.funkrufname}</Tag>
          {!schreibgeschuetzt && (
            <Button type="primary" onClick={() => onZuweisenFahrzeug(f)}>
              zuweisen
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}
