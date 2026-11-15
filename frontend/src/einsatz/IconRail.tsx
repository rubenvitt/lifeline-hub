import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { theme } from 'antd';
import { IconSeitenleisteAuf, IconSeitenleisteZu } from '../icons';
import { railBreite } from '../components/Kopfleiste';
import { leseRahmenOben, useRahmenOben } from '../components/rahmenOben';
import { form, rahmenFarben, schrift, schriftskala } from '../theme/tokens';
import type { Kategorie, KategorieKey } from './modulRegistry';
import { handleLinkKlick } from '../routing/linkModifier';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  /** Einfacher Klick auf eine Kategorie; Strg/⌘/Umschalt/Mittelklick behält der Browser. */
  onKategorieKlick: (key: KategorieKey) => void;
  /**
   * Adresse des Ziels einer Kategorie, das erste freigegebene Modul (LLH-1732). Mit Adresse ist
   * das Ziel ein `<a href>`, damit Strg/⌘+Klick einen neuen Tab öffnet; ohne (kein freigegebenes
   * Modul, oder der Aufrufer reicht keine Adressen) bleibt es ein Knopf.
   */
  kategoriePfad?: (key: KategorieKey) => string | null;
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
    boxSizing: 'border-box',
    // Das Ziel ist ein `<a href>` oder ein `<button>` (LLH-1732); beide sehen gleich aus.
    textDecoration: 'none',
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
 * Der Vorlauf der Rail (LLH-1734, design.md D3 in
 * `openspec/changes/archive/2026-11-15-f24jkokr-rahmen-kleinteile/`): was im Fluss über ihr steht
 * und nicht zum klebenden Rahmen zählt, also die Betriebszeile ab `md`, das Spiegelband und die
 * Warnung zu den Modulfreigaben. Gemessen als Abstand der `<nav>` vom Dokumentanfang minus
 * `--lfh-rahmen-oben`; die `<nav>` klebt nicht, ihr Abstand hängt also nicht am Rollstand.
 *
 * Neu gemessen, wenn sich `body` in der Größe ändert (eine Zeile erscheint oder verschwindet) oder
 * der Rahmen eine neue Höhe meldet; geschrieben im nächsten Bild, wie in `rahmenOben.ts` (LLH-1335).
 */
function useVorlauf(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [vorlauf, setVorlauf] = useState(0);
  const rahmenOben = useRahmenOben();
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setVorlauf(Math.max(0, Math.round(top - leseRahmenOben())));
    };
    measure();
    let pending = 0;
    const observer = new ResizeObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        measure();
      });
    });
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      if (pending) cancelAnimationFrame(pending);
    };
  }, [el, rahmenOben]);
  return [setEl, vorlauf];
}

/**
 * Schmale vertikale Kategorie-Rail, 60 px.
 *
 * Das Etikett steht SICHTBAR, nicht im Tooltip: auf dem Führungs-Tablet gibt es kein Hover. Es
 * ist das Kurzetikett (`Kategorie.kurz`); der volle Name bleibt `aria-label` und `title`.
 * „Einstellungen" (`fuss`) steht abgesetzt unten. Es bleiben SECHS Kategorie-Ziele in EINER
 * Landmarke; steht ein Modulpanel daneben, kommt im Fuß der Griff „Menü“ dazu (LFH-952).
 */
export default function IconRail({
  kategorien,
  aktiveKategorie,
  onKategorieKlick,
  kategoriePfad,
  panel,
}: Props) {
  const { token } = theme.useToken();
  const [navRef, vorlauf] = useVorlauf();

  const ziel = (k: Kategorie) => {
    const aktiv = k.key === aktiveKategorie;
    const Icon = aktiv ? k.icon.gefuellt : k.icon.umriss;
    const zielProps = {
      'aria-label': k.label,
      title: k.label === k.kurz ? undefined : k.label,
      'aria-current': aktiv ? ('true' as const) : undefined,
      // Der Selbstklick klappt das Panel um (LFH-952): die offene Kategorie sagt, ob es steht.
      'aria-expanded': aktiv && panel ? panel.offen : undefined,
      'aria-controls': aktiv && panel?.offen ? MODUL_PANEL_ID : undefined,
      style: railZielStil(token, { aktiv }),
    };
    const inhalt = (
      <>
        {/* `flexShrink: 0`, sonst gibt das Icon statt des Etiketts nach. `aria-hidden`: der Name steht
           am Ziel. */}
        <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <Icon size={20} />
        </span>
        <span aria-hidden="true" data-lfh="rail-etikett" style={ETIKETT_STIL}>
          {k.kurz}
        </span>
      </>
    );
    const pfad = kategoriePfad?.(k.key) ?? null;
    // Mit Adresse ein Link (LLH-1732): Strg/⌘+Klick legt das Modul in einen neuen Tab. Der einfache
    // Klick bleibt Sprung bzw. Umklappen, auch an der offenen Kategorie.
    return pfad ? (
      <a
        key={k.key}
        href={pfad}
        onClick={(e) => handleLinkKlick(e, () => onKategorieKlick(k.key))}
        {...zielProps}
      >
        {inhalt}
      </a>
    ) : (
      <button key={k.key} type="button" onClick={() => onKategorieKlick(k.key)} {...zielProps}>
        {inhalt}
      </button>
    );
  };

  const haupt = kategorien.filter((k) => !k.fuss);
  const fuss = kategorien.filter((k) => k.fuss);

  return (
    <nav
      ref={navRef}
      aria-label="Kategorien"
      style={{
        ['--lfh-rail-vorlauf' as string]: `${vorlauf}px`,
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
         sich, und der Fuß folgt den Kategorien (LLH-1273): die Kategorien stehen zuerst im Bild,
         nichts liegt unter einem klebenden Teil. Was im Fluss über der Rail steht (Betriebszeile ab
         `md`), zieht die Spalte als Vorlauf ab (LLH-1734), sonst lag der Fuß bei Rollstand 0 um
         dessen Höhe unter dem Fensterrand. Gerollt bleibt darunter ein Streifen im Grund der Rail. */}
      <div
        data-lfh="rail-spalte"
        style={{
          position: 'sticky',
          top: 'var(--lfh-rahmen-oben, 0px)',
          height: 'calc(100dvh - var(--lfh-rahmen-oben, 0px) - var(--lfh-rail-vorlauf, 0px))',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        <div data-lfh="rail-haupt" style={{ display: 'flex', flexDirection: 'column' }}>
          {haupt.map(ziel)}
        </div>
        {fuss.length > 0 && (
          // Auf hohen Fenstern schiebt ihn `marginTop: auto` ans Ende der Spalte. Er klebt NICHT
          // (LLH-1273): bei 1366 × 520 in `handschuh` lagen „Lage“ und „Kommunikation“ ganz unter
          // dem klebenden Fuß und waren ohne Wischen weder zu sehen noch anzutippen. Reicht die Höhe
          // nicht, steht er hinter den Kategorien und kommt per Wischen oder Tab ins Bild.
          <div
            data-lfh="rail-fuss"
            style={{ marginTop: 'auto', borderTop: `1px solid ${rahmenFarben.linie}` }}
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
                style={railZielStil(token, { aktiv: false })}
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
