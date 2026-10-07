import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { IconSeitenleisteAuf, IconSeitenleisteZu } from '../icons';
import { railBreite } from '../components/Kopfleiste';
import { form, rahmenFarben, schrift, schriftskala } from '../theme/tokens';
import type { Kategorie, KategorieKey } from './modulRegistry';
import { fussFokusabstandStil, useFussFokusabstand } from './fussFokusabstand';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
  /**
   * Das Modulpanel neben der Rail (LFH-952, D5): trägt den Griff „Menü“ im Fuß und
   * `aria-expanded` an der offenen Kategorie. Ohne (Drawer-Zweig) kein Griff.
   */
  panel?: { offen: boolean; onUmschalten: () => void };
}

/** `id` des Modulpanels, auf das Griff und offene Kategorie zeigen. */
export const MODUL_PANEL_ID = 'modul-panel';

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
 * innen, weil ein Rand Icon und Etikett beim Aktivieren verschöbe.
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
    // Nachtrollen, nicht Modus-Token: die Rail ist in BEIDEN Modi dunkel. Inaktiv heißt nicht
    // gesperrt: das Etikett ist bedienbarer Text und hält die Tag-Schwelle (LFH-434).
    background: zustand.aktiv ? rahmenFarben.aktiv : 'transparent',
    boxShadow: zustand.aktiv ? `inset ${MARKE_BREITE}px 0 0 ${rahmenFarben.marke}` : 'none',
    color: zustand.aktiv ? rahmenFarben.text : rahmenFarben.gedaempft,
  };
}

/**
 * Das 9-px-Etikett unter dem Icon (Versalien, Sperrung .06em — `schriftskala.railEtikett`).
 *
 * `maxWidth: '100%'` hält das Etikett in der Zielbreite: ein zu langes Kurzetikett zeigt sich dann
 * als `scrollWidth > clientWidth` (gemessen in `e2e/rail-etikett.spec.ts`, LFH-644) statt still
 * links und rechts über die Rail zu ragen.
 */
const ETIKETT_STIL: CSSProperties = {
  fontFamily: schrift[schriftskala.railEtikett.familie],
  fontSize: schriftskala.railEtikett.groesse,
  fontWeight: schriftskala.railEtikett.gewicht,
  letterSpacing: schriftskala.railEtikett.sperrung,
  textTransform: 'uppercase',
  lineHeight: 1.15,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
};

/**
 * Schmale vertikale Kategorie-Rail, 60 px.
 *
 * Das Etikett steht SICHTBAR, nicht im Tooltip: auf dem Führungs-Tablet gibt es kein Hover. Es
 * ist das Kurzetikett (`Kategorie.kurz`); der volle Name bleibt `aria-label` und `title`.
 * „Einstellungen" (`fuss`) steht abgesetzt unten. Es bleiben SECHS Kategorie-Ziele in EINER
 * Landmarke; steht ein Modulpanel daneben, kommt im Fuß der Griff „Menü“ dazu (LFH-952).
 */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick, panel }: Props) {
  const { token } = theme.useToken();
  const { wurzelRef, fussRef } = useFussFokusabstand();

  const ziel = (k: Kategorie) => {
    const aktiv = k.key === aktiveKategorie;
    const Icon = aktiv ? k.icon.gefuellt : k.icon.umriss;
    return (
      <button
        key={k.key}
        type="button"
        aria-label={k.label}
        title={k.label === k.kurz ? undefined : k.label}
        aria-current={aktiv ? 'true' : undefined}
        // Der Selbstklick klappt das Panel um (LFH-952): die offene Kategorie sagt, ob es steht.
        aria-expanded={aktiv && panel ? panel.offen : undefined}
        aria-controls={aktiv && panel?.offen ? MODUL_PANEL_ID : undefined}
        onClick={() => onKategorieKlick(k.key)}
        // Fokusabstand zum klebenden Fuß (WCAG 2.4.11) — neben, nicht in `railZielStil`.
        style={{ ...railZielStil(token, { aktiv }), ...fussFokusabstandStil }}
      >
        {/* `flexShrink: 0`, sonst gibt das Icon statt des Etiketts nach. `aria-hidden`: der Name steht
           am Knopf. */}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <Icon size={20} />
        </span>
        <span aria-hidden="true" data-lfh="rail-etikett" style={ETIKETT_STIL}>
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
        // Wächst in `handschuh` mit, damit das Ziel auch in der Breite 72 hält (LFH-384).
        width: railBreite(token),
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* EINE klebende Spalte unter dem Kopf (LFH-952, `frontend/AGENTS.md`, Rahmen): Kategorien oben,
         Fuß unten, zusammen höchstens so hoch wie das Fenster unter dem Rahmen. Zwei getrennt
         klebende Teile (Kategorien oben, Fuß unten) überlappten bei geringer Höhe in `handschuh`,
         und keiner rollte die verdeckte Kategorie frei. Reicht die Höhe nicht, rollt die Spalte in
         sich; der Fuß klebt an ihrem Ende, `fussFokusabstand` hält Fokusziele über ihm frei.
         Steht über dem Kopf eine Zeile im Fluss (Betriebszeile ab `md`), liegt der Fuß um ihre
         Höhe unter dem Fensterrand, bis die Seite so weit gerollt ist. */}
      <div
        data-lfh="rail-spalte"
        style={{
          position: 'sticky',
          top: 'var(--lfh-rahmen-oben, 0px)',
          height: 'calc(100dvh - var(--lfh-rahmen-oben, 0px))',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        <div data-lfh="rail-haupt" style={{ display: 'flex', flexDirection: 'column' }}>
          {haupt.map(ziel)}
        </div>
        {fuss.length > 0 && (
          // `sticky; bottom: 0` am Ende der Spalte; auf hohen Fenstern schiebt ihn `marginTop: auto`
          // dorthin. Der Grund ist nötig, weil in einer rollenden Spalte Ziele darunter vorbeiziehen.
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
            {panel && (
              // Griff des Modulmenüs (LFH-952, D5): sichtbar, weil das Panel am Tablet quer ohne
              // Wahl zu ist und der Selbstklick auf die Kategorie kein erkennbarer Weg zurück wäre.
              // Eigenes Etikett-Merkmal: `rail-etikett` zählt die Kategorien.
              <button
                type="button"
                aria-label={panel.offen ? 'Menü einklappen' : 'Menü ausklappen'}
                aria-expanded={panel.offen}
                aria-controls={panel.offen ? MODUL_PANEL_ID : undefined}
                data-lfh="rail-griff"
                onClick={panel.onUmschalten}
                style={{ ...railZielStil(token, { aktiv: false }), ...fussFokusabstandStil }}
              >
                <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
                  {panel.offen ? (
                    <IconSeitenleisteZu size={20} />
                  ) : (
                    <IconSeitenleisteAuf size={20} />
                  )}
                </span>
                <span aria-hidden="true" data-lfh="rail-griff-etikett" style={ETIKETT_STIL}>
                  Menü
                </span>
              </button>
            )}
            {fuss.map(ziel)}
          </div>
        )}
      </div>
    </nav>
  );
}
