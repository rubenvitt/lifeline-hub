import { useState, type CSSProperties } from 'react';
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
 * Eine Zeile der Seitenleiste (Name + „zuweisen“), rein und exportiert (Muster `bedienzielStil`).
 * Der Zeilenabstand ist der Zielabstand zwischen zwei „zuweisen“-Knöpfen (LFH-968): `marginSM` =
 * 7 / 11 / 16 px hält komfortabel ≥ 8 und handschuh ≥ 16; die festen 6 px vorher hielten keins.
 */
export function kraftZeileStil(token: { marginXS: number; marginSM: number }) {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: token.marginXS,
    marginBottom: token.marginSM,
  } satisfies CSSProperties;
}

/**
 * Sidebar „Kräfte ohne BR": Einheiten und einheitenlose Fahrzeuge mit `aktueller_br_id == null`.
 * Mitglieder des aktuellen BR werden zusätzlich ausgeblendet, falls Listen- und Detail-Cache kurz
 * auseinanderlaufen.
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

  const freieEinheiten = alleEinheiten.filter(
    (e) => e.aktueller_br_id == null && !brEinheitIds.has(e.id),
  );

  const freiFahrzeuge = alleFahrzeuge.filter(
    (f) => f.einheit_id == null && f.aktueller_br_id == null && !brFahrzeugIds.has(f.id),
  );

  const leer = freieEinheiten.length === 0 && freiFahrzeuge.length === 0;
  const gruppen = gruppiereFreieKraefte(freieEinheiten, freiFahrzeuge, suche);

  return (
    // Unter `md` volle Breite und gestapelt; die Zuweisung läuft über den Knopf, nicht per Drag.
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
        {/* Eigener Scroll: die Höhenkette endet hier an der Karte, nicht am Layout (vgl. H51) —
            deshalb ein dvh-Maß direkt am Container. */}
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
                <div key={`einheit-${e.id}`} style={kraftZeileStil(token)}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: rollen.text }}>
                    {e.name}
                  </span>
                  {!schreibgeschuetzt && (
                    <Button aria-label={`${e.name} zuweisen`} onClick={() => onZuweisenEinheit(e)}>
                      zuweisen
                    </Button>
                  )}
                </div>
              ))}
              {g.fahrzeuge.map((f) => (
                <div key={`fahrzeug-${f.id}`} style={kraftZeileStil(token)}>
                  <span style={{ flex: 1, minWidth: 0, ...monoStil(13), color: rollen.text }}>
                    {f.funkrufname}
                  </span>
                  {!schreibgeschuetzt && (
                    <Button
                      aria-label={`${f.funkrufname} zuweisen`}
                      onClick={() => onZuweisenFahrzeug(f)}
                    >
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
