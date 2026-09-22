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
 * Zeilenhöhe einer Kategorie im Entwurf (`shell.dc.html`: 62 px). Sie ist zugleich der
 * Boden unter der Dichte-Staffel: in `handschuh` (72) wächst die Zeile mit, sonst trägt sie
 * die Entwurfshöhe — und liegt damit über dem A1-Boden von 48 px, den die Rail seit LFH-329
 * zusichert.
 */
const RAIL_ZEILE = 62;

/** Breite der aktiven Marke am linken Rand (Entwurf: 2 px). Markermaß, keine Dichte. */
const MARKE_BREITE = 2;

/**
 * Stil eines Kategorie-Ziels — REIN und exportiert, damit die Dichte-Zusicherung ohne
 * Rendern prüfbar ist.
 *
 * `test/utils.tsx:31` montiert ein nacktes `ConfigProvider` ohne unser Theme: `useToken()`
 * liefert dort den antd-Seed (`controlHeight: 32`), also KEINE der Stufen 30/48/72. Ein
 * gerenderter Wert belegte antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin
 * kein Layout. Präzedenzen: `ModulPanel.modulZeilenStil`, `Sidebar.bedienzielStil`.
 *
 * `Math.max` und NICHT `??`: die Staffel darf den Boden heben, nie senken.
 *
 * ZWEI Angaben, nicht eine (LFH-365): `minHeight` PLUS Polsterung. Aufgelöste Tokens,
 * nie `var(--lfh-*)` — die Arbeitsteilung steht in `theme/rollen.css`.
 *
 * DIE AKTIVE MARKE IST ROT — Entscheidung des Auftraggebers zum Neuentwurf (21.09.2026,
 * `docs/design/2026-09-21-neuentwurf/umsetzung.md`, Entscheidung 2): 2 px in `marke` am
 * linken Rand. Das ist KEINE rote Bedienfläche: die Fläche des aktiven Ziels ist `flaeche3`
 * (neutral), das Etikett hell — Rot markiert den Ort, es bedient nichts. Vorher (LFH-328/A2)
 * trug der aktive Zustand eine blaue Vollfläche; die ist mit dem Entwurf entfallen.
 * Die Marke sitzt als `boxShadow` innen, nicht als Rand: ein Rand verschöbe Ikone und
 * Etikett beim Aktivieren um 2 px.
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
 * Schmale vertikale Kategorie-Rail (Ebene 2), 60 px nach dem Neuentwurf.
 *
 * DAS ETIKETT STEHT SICHTBAR, NICHT IM TOOLTIP (LFH-337 · Befund H8): auf dem
 * Führungs-Tablet gibt es kein Hover. Seit dem Neuentwurf ist es das KURZETIKETT
 * (`Kategorie.kurz`, „Kräfte", „Komm.") — 9 px Versalien in 60 px Breite tragen
 * „Kommunikation" nicht. Der volle Name bleibt `aria-label` (Namensabfrage der Tests,
 * Screenreader) und `title` (Zeiger).
 *
 * „Einstellungen" (`fuss`) steht abgesetzt unten mit Haarlinie — sie ist Konfiguration,
 * keine Arbeitskategorie. Es bleiben SECHS Ziele in EINER Landmarke: die Zahl prüfen die
 * e2e-Suiten, und eine zweite Landmarke für ein Ziel wäre Lärm.
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
        {/* `flexShrink: 0`, weil sonst die Ikone statt des Etiketts nachgibt — dieselbe
            gemessene Falle wie in `ModulPanel`. Hülle mit `aria-hidden`: der Name steht am
            Knopf, die Ikone ist Dekoration. */}
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
        // `sticky; bottom: 0`: die Seite scrollt im Dokument, nicht in einem eigenen
        // Container — auf einer langen Seite stünde der Fuß sonst am Seitenende. So hängt er
        // am unteren Fensterrand, solange die Spalte reicht; auf kurzen Seiten schiebt ihn
        // `marginTop: auto` ans Spaltenende. Der Grund ist nötig, weil darunter Ziele vorbei-
        // scrollen.
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
