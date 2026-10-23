import { Link } from 'react-router';
import type { AbrufZustand } from '../../api/abrufZustand';
import type { Nachforderung } from '../../api/types';
import { formatVor } from '../../anzeige/abstand';
import { DashboardPaneel, listenZeileStil, monoStil, useRollen } from '../../components/instrument';
import { useModulWahl } from '../../einsatz/useModulWahl';
import {
  OFFENE_STUFEN,
  istOffen,
  offenText,
  stufeWort,
  type NachforderungsZahlen,
} from '../../nachforderungen/nachforderungStufen';
import { nachforderungenPfad } from '../../routing/deeplinks';
import { nachforderungName } from '../../nachforderungen/nachforderungName';

/** Wie viele der am längsten wartenden offenen das Paneel nennt. */
export const NACHFORDERUNGEN_AELTESTE = 2;

/**
 * Die am längsten wartenden offenen Nachforderungen, älteste zuerst — rein, für das Paneel.
 * Gezählt wird nicht hier: die Zahlen kommen aus dem Modulzähler (LFH-550).
 */
export function aeltesteOffene(
  liste: readonly Nachforderung[],
  anzahl = NACHFORDERUNGEN_AELTESTE,
): Nachforderung[] {
  return liste
    .filter((n) => istOffen(n.status))
    .sort((a, b) => a.angefordert_at.localeCompare(b.angefordert_at) || a.id - b.id)
    .slice(0, anzahl);
}

/**
 * Paneel „Nachforderungen“ des Führungsüberblicks (LLH-1078): die offenen je Stufe aus dem
 * Server-Zähler, darunter die am längsten wartenden mit ihrem Alter. Rahmen aus dem
 * Dashboard-Baukasten (`DashboardPaneel`, LLH-1140): Sprung „Nachforderungen ↗“, Laden/Fehler/
 * Leer aus `PaneelZustand`, gesperrt ohne Sprung mit Grund.
 */
export default function NachforderungenPaneel({
  einsatzId,
  zustand,
  zahlen,
  aelteste,
  jetzt,
  darfSchreiben,
  onNeuladen,
}: {
  einsatzId: number;
  /** Schlechtester Zustand aus Zähler und Liste. */
  zustand: AbrufZustand;
  zahlen: NachforderungsZahlen | null;
  aelteste: readonly Nachforderung[];
  /** Uhr der Seite (ms). */
  jetzt: number;
  darfSchreiben: boolean;
  onNeuladen: () => void;
}) {
  const { token, rollen } = useRollen();
  const { waehle } = useModulWahl();
  const zeile = listenZeileStil(rollen, token);
  const daten = zustand === 'daten' && zahlen != null;

  return (
    <DashboardPaneel
      titel="Nachforderungen"
      // Ohne Zahlen trotz Daten: der Zähler sagt „nicht freigegeben“.
      zustand={
        zahlen == null && zustand === 'daten'
          ? 'gesperrt'
          : zustand === 'daten' && zahlen?.offen === 0
            ? 'leer'
            : zustand
      }
      meta={daten ? offenText(zahlen) : undefined}
      sprung={{ label: 'Nachforderungen', onKlick: () => waehle(nachforderungenPfad(einsatzId)) }}
      leerText="Keine offenen Nachforderungen."
      gesperrtText="Modul nicht freigegeben."
      leerAktion={
        darfSchreiben
          ? {
              label: 'Nachforderung anlegen',
              onKlick: () => waehle(nachforderungenPfad(einsatzId, { neu: true })),
            }
          : undefined
      }
      onNeuladen={onNeuladen}
    >
      {zahlen != null && (
        <dl
          data-lfh="nachforderung-stufen"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            margin: 0,
            borderBlockEnd: `1px solid ${rollen.flaeche3}`,
          }}
        >
          {OFFENE_STUFEN.map((stufe) => (
            <div
              key={stufe}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                paddingBlock: token.paddingSM,
                paddingInline: token.padding,
                minWidth: 0,
              }}
            >
              <dt style={{ fontSize: 12, color: rollen.gedaempft }}>{stufeWort(stufe)}</dt>
              <dd style={{ margin: 0, ...monoStil(20, 500), color: rollen.text }}>
                {zahlen[stufe]}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {aelteste.map((n) => (
          <li key={n.id}>
            <Link
              to={nachforderungenPfad(einsatzId, { nachforderung: n.id })}
              data-lfh="ueberblick-nachforderung"
              style={zeile}
            >
              <span
                style={{
                  ...monoStil(11),
                  color: rollen.gedaempft,
                  flex: '0 0 auto',
                  minWidth: 72,
                }}
              >
                {formatVor(n.angefordert_at, jetzt)}
              </span>
              <span
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: rollen.text2,
                  overflowWrap: 'anywhere',
                }}
              >
                {nachforderungName(n)}
              </span>
              <span
                style={{
                  ...monoStil(10),
                  letterSpacing: '0.06em',
                  color: rollen.gedaempft,
                  flex: '0 0 auto',
                }}
              >
                {stufeWort(n.status)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </DashboardPaneel>
  );
}
