import { useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { Augenbraue, Paneel, monoStil, useRollen } from '../../components/instrument';
import { useViewport } from '../../components/useViewport';
import { gruppiereFreieKraefte } from './freieKraefte';
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
  const { token, rollen } = useRollen();
  const [suche, setSuche] = useState('');
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
  const gruppen = gruppiereFreieKraefte(freieEinheiten, freiFahrzeuge, suche);

  return (
    // Unter `md` volle Breite und gestapelt (LFH-341 · H40) — dieselbe Form wie bei
    // Gefahrengebietsliste und Gliederungsbaum. Die Zuweisung läuft hier ohnehin über
    // den „zuweisen"-Knopf, nicht über einen Drag: der Umbruch kostet keinen Bedienweg.
    <div
      data-testid="kraefte-ohne-br"
      style={breit ? { width: 240, minHeight: 400, display: 'flex' } : { width: '100%' }}
    >
      <Paneel
        titel="Kräfte ohne BR"
        meta={freieEinheiten.length + freiFahrzeuge.length}
        koerperPolster
        style={{ flex: '1 1 auto' }}
      >
        <Input
          allowClear
          placeholder="Kräfte suchen"
          aria-label="Kräfte suchen"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          style={{ marginBottom: token.marginSM }}
        />
        {/* Eigener Scroll mit begrenzter Höhe (M58): die Höhenkette endet hier an der Karte selbst,
          nicht am Layout (Falle aus LFH-343 · H51) — deshalb ein Maß in dvh direkt am Container. */}
        <div style={{ maxHeight: 'min(60dvh, 560px)', overflowY: 'auto' }}>
          {leer && <Typography.Text type="secondary">keine freien Kräfte</Typography.Text>}
          {!leer && gruppen.length === 0 && (
            <Typography.Text type="secondary">keine Treffer</Typography.Text>
          )}
          {gruppen.map((g) => (
            <div key={g.titel} style={{ marginBottom: token.marginSM }}>
              <Augenbraue als="div" style={{ marginBottom: token.marginXXS }}>
                {g.titel}
              </Augenbraue>
              {g.einheiten.map((e) => (
                <div
                  key={`einheit-${e.id}`}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 4,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: rollen.text }}>
                    {e.name}
                  </span>
                  {!schreibgeschuetzt && (
                    <Button type="primary" onClick={() => onZuweisenEinheit(e)}>
                      zuweisen
                    </Button>
                  )}
                </div>
              ))}
              {g.fahrzeuge.map((f) => (
                <div
                  key={`fahrzeug-${f.id}`}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 4,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, ...monoStil(13), color: rollen.text }}>
                    {f.funkrufname}
                  </span>
                  {!schreibgeschuetzt && (
                    <Button type="primary" onClick={() => onZuweisenFahrzeug(f)}>
                      zuweisen
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Paneel>
    </div>
  );
}
