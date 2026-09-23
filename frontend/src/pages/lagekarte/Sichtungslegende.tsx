import { monoStil, useRollen } from '../../components/instrument';
import { SK_WORT } from '../../personen/personMeta';
import { SK_KURZZEICHEN } from '../../personen/personenKarte';
import { SICHTUNGSBILD_REIHE, type SichtungsbildSchluessel } from '../../personen/personenBilanz';
import { rollenFarbe, sichtung } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';

/** Kantenlänge des Kreises — derselbe Durchmesser wie der Personen-Marker (`KREIS_PAINT`). */
const KREIS = 18;

/**
 * Legende der Ebene „Betroffene" auf der Lagekarte (LFH-648).
 *
 * Die Personen-Marker tragen Sichtungsfarben, die das einzelne Farbfeld der Ebenen-Zeile
 * nicht erklären kann. Jeder Eintrag zeigt deshalb den Kreis GENAU so, wie ihn die Karte
 * zeichnet (Farbe, weißer Rand, Kürzel innen), und daneben das Wort — die Farbe ist nie der
 * einzige Kanal (WCAG 1.4.1). Reihenfolge wie das Sichtungsbild der Betroffenen-Seite.
 *
 * Gelesen, nicht gebaut: `sichtung` (Label) aus `theme/statusFarben.ts`, `sichtungsfarben`
 * aus `theme/tokens.ts`, das Kürzel aus `personenKarte.ts` — dieselbe Quelle wie der Marker.
 * Kein eigenes `Record<…, StatusDarstellung>` und kein Farbwert hier (statusVertrag-/gate5-
 * Guard). Kein Bedienziel, also kein Dichte-Boden.
 */
export default function Sichtungslegende() {
  const { token, rollen } = useRollen();
  const neutral = rollenFarbe('neutral', token);

  function farbe(k: SichtungsbildSchluessel): string {
    if (k === 'ohne') return neutral;
    const f = sichtung[k].farbe;
    return f ? sichtungsfarben[f] : neutral;
  }

  function beschriftung(k: SichtungsbildSchluessel): string {
    return k === 'ohne' ? SK_WORT.ohne : `${sichtung[k].label} · ${SK_WORT[k]}`;
  }

  return (
    <ul
      aria-label="Sichtungslegende"
      data-lfh="sichtungslegende"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: `${token.paddingXS}px ${token.padding}px`,
        display: 'grid',
        gap: token.marginXXS,
      }}
    >
      {SICHTUNGSBILD_REIHE.map((k) => (
        <li
          key={k}
          style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, fontSize: 11 }}
        >
          <span
            aria-hidden="true"
            data-sichtung-feld={k}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: KREIS,
              height: KREIS,
              flex: `0 0 ${KREIS}px`,
              borderRadius: '50%',
              background: farbe(k),
              border: `2px solid ${token.colorWhite}`,
              ...monoStil(8),
              color: sichtungsfarben.schwarz,
              textShadow: `0 0 2px ${token.colorWhite}`,
            }}
          >
            {SK_KURZZEICHEN[k]}
          </span>
          <span style={{ color: rollen.text2 }}>{beschriftung(k)}</span>
        </li>
      ))}
    </ul>
  );
}
