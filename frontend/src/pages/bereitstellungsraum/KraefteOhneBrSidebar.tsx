import { Button, Card, Tag, Typography } from 'antd';
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
 * Sidebar: Einheiten und einheitenlose Fahrzeuge, die nicht im aktuellen BR sind.
 *
 * Hinweis (Concern): Einheiten/Fahrzeuge in *anderen aktiven* BRs werden ebenfalls
 * angezeigt, da `aktueller_br_id` nicht im Listen-Response enthalten ist. Ein
 * Klick auf „zuweisen" führt dann zu 422, das als Fehlermeldung angezeigt wird.
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
  const brEinheitIds = new Set(brEinheiten.map((e) => e.id));
  const brFahrzeugIds = new Set(brFahrzeuge.map((f) => f.id));

  // Einheiten, die noch nicht im BR sind
  const freieEinheiten = alleEinheiten.filter((e) => !brEinheitIds.has(e.id));

  // Einheitenlose Fahrzeuge, die noch nicht im BR sind
  const freiFahrzeuge = alleFahrzeuge.filter(
    (f) => f.einheit_id == null && !brFahrzeugIds.has(f.id),
  );

  const leer = freieEinheiten.length === 0 && freiFahrzeuge.length === 0;

  return (
    <Card title="Kräfte ohne BR" size="small" style={{ width: 240, minHeight: 400 }}>
      {leer && (
        <Typography.Text type="secondary">keine freien Kräfte</Typography.Text>
      )}

      {freieEinheiten.map((e) => (
        <div key={`einheit-${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <Tag style={{ flex: 1 }}>{e.name}</Tag>
          {!schreibgeschuetzt && (
            <Button size="small" type="primary" onClick={() => onZuweisenEinheit(e)}>
              zuweisen
            </Button>
          )}
        </div>
      ))}

      {freiFahrzeuge.map((f) => (
        <div key={`fahrzeug-${f.id}`} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <Tag style={{ flex: 1 }}>{f.funkrufname}</Tag>
          {!schreibgeschuetzt && (
            <Button size="small" type="primary" onClick={() => onZuweisenFahrzeug(f)}>
              zuweisen
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}
