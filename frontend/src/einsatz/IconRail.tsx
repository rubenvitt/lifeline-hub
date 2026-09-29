import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { RAIL_BREITE } from '../components/Kopfleiste';
import { form, rahmenFarben, schrift, schriftskala } from '../theme/tokens';
import type { Kategorie, KategorieKey } from './modulRegistry';
import { fussFokusabstandStil, useFussFokusabstand } from './fussFokusabstand';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
}

/**
 * Zeilenhöhe einer Kategorie laut Entwurf (62 px) — zugleich Boden unter der Dichte-Staffel: in
 * `handschuh` (72) wächst die Zeile mit, und sie liegt über dem 48-px-Boden der Rail.
 */
const RAIL_ZEILE = 62;

/** Breite der aktiven Marke am linken Rand. Markermaß, keine Dichte. */
const MARKE_BREITE = 2;

/**
 * Stil eines Kategorie-Ziels — rein und exportiert, damit die Dichte-Zusicherung ohne Rendern
 * prüfbar ist (`test/utils.tsx` hat kein Theme, jsdom kein Layout).
 *
 * `Math.max` und NICHT `??`: die Staffel darf den Boden heben, nie senken. ZWEI Angaben:
 * `minHeight` PLUS Polsterung; aufgelöste Tokens, nie `var(--lfh-*)`.
 *
 * DIE AKTIVE MARKE IST ROT (umsetzung.md, Entscheidung 2): 2 px in `marke` am linken Rand. Sie
 * bedient nichts — die Fläche des aktiven Ziels ist `flaeche3` (neutral). Als `boxShadow`
 * innen, weil ein Rand Ikone und Etikett beim Aktivieren verschöbe.
 */
export function railZielStil(
  token: { controlHeight: number; paddingXS: number },
  zustand: { aktiv: boolean },
): CSSProperties {
  return {
    width: '100%',
    minHeight: Math.max(RAIL_ZEILE, token.controlHeight),
    padding: `${token.paddingXS}px 2px`,
    border: 'none',
    cursor: 'pointer',
    borderRadius: form.radiusSteuer,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    // Nachtrollen, nicht Modus-Token: die Rail ist in BEIDEN Modi dunkel.
    background: zustand.aktiv ? rahmenFarben.aktiv : 'transparent',
    boxShadow: zustand.aktiv ? `inset ${MARKE_BREITE}px 0 0 ${rahmenFarben.marke}` : 'none',
    color: zustand.aktiv ? rahmenFarben.text : rahmenFarben.schwach,
  };
}

/** Das 9-px-Etikett unter der Ikone (Versalien, Sperrung .06em — `schriftskala.railEtikett`). */
const ETIKETT_STIL: CSSProperties = {
  fontFamily: schrift[schriftskala.railEtikett.familie],
  fontSize: schriftskala.railEtikett.groesse,
  fontWeight: schriftskala.railEtikett.gewicht,
  letterSpacing: schriftskala.railEtikett.sperrung,
  textTransform: 'uppercase',
  lineHeight: 1.15,
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

/**
 * Schmale vertikale Kategorie-Rail, 60 px.
 *
 * Das Etikett steht SICHTBAR, nicht im Tooltip: auf dem Führungs-Tablet gibt es kein Hover. Es
 * ist das Kurzetikett (`Kategorie.kurz`); der volle Name bleibt `aria-label` und `title`.
 * „Einstellungen" (`fuss`) steht abgesetzt unten. Es bleiben SECHS Ziele in EINER Landmarke.
 */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick }: Props) {
  const { token } = theme.useToken();
  const { wurzelRef, fussRef } = useFussFokusabstand();

  const ziel = (k: Kategorie) => {
    const aktiv = k.key === aktiveKategorie;
    const Icon = k.icon;
    return (
      <button
        key={k.key}
        type="button"
        aria-label={k.label}
        title={k.label === k.kurz ? undefined : k.label}
        aria-current={aktiv ? 'true' : undefined}
        onClick={() => onKategorieKlick(k.key)}
        // Fokusabstand zum klebenden Fuß (WCAG 2.4.11) — neben, nicht in `railZielStil`.
        style={{ ...railZielStil(token, { aktiv }), ...fussFokusabstandStil }}
      >
        {/* `flexShrink: 0`, sonst gibt die Ikone statt des Etiketts nach. `aria-hidden`: der Name steht
           am Knopf. */}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <Icon size={20} />
        </span>
        <span aria-hidden="true" style={ETIKETT_STIL}>
          {k.kurz}
        </span>
      </button>
    );
  };

  const haupt = kategorien.filter((k) => !k.fuss);
  const fuss = kategorien.filter((k) => k.fuss);

  return (
    <nav
      ref={wurzelRef}
      aria-label="Kategorien"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: rahmenFarben.grund,
        borderInlineEnd: `1px solid ${rahmenFarben.linie}`,
        minHeight: '100%',
        width: RAIL_BREITE,
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {haupt.map(ziel)}
      {fuss.length > 0 && (
        // `sticky; bottom: 0`: die Seite scrollt im Dokument, sonst stünde der Fuß auf einer langen
        // Seite am Seitenende. Auf kurzen Seiten schiebt ihn `marginTop: auto` ans Spaltenende. Der
        // Grund ist nötig, weil darunter Ziele vorbeiscrollen.
        <div
          ref={fussRef}
          data-lfh="rail-fuss"
          style={{
            marginTop: 'auto',
            position: 'sticky',
            bottom: 0,
            background: rahmenFarben.grund,
            borderTop: `1px solid ${rahmenFarben.linie}`,
          }}
        >
          {fuss.map(ziel)}
        </div>
      )}
    </nav>
  );
}
