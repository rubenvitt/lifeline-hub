import { IconChevronHoch, IconChevronRunter } from '../icons';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, ConfigProvider, Layout, Menu, Spin, theme } from 'antd';
import { Augenbraue, useRollen } from '../components/instrument';
import type { MenuProps } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { useViewport } from '../components/useViewport';
import { adminAufbewahrung, adminBenutzer, adminDemoDaten, adminGruppen } from './adminNav';
import { useDemoDatenStatus } from './useDemoDaten';
import DatentraegerWarnung from './DatentraegerWarnung';

const { Sider, Content } = Layout;

/**
 * Admin-Shell: eine linke Sidebar (gruppiertes `Menu`) als EINZIGE Nav-Ebene für `/admin`, plus
 * `<Outlet>`. Menü und Routen stammen aus der `adminNav`-Registry; die aktive Sektion folgt der
 * URL. Gate `darfVerwaltung` (sonst Redirect zu /einsaetze). „Benutzer" und „Aufbewahrung" nur
 * für System-Admins, „Demo-Daten“ zusätzlich nur bei 200 von `GET /api/demo-daten`. Über dem
 * Inhalt steht für System-Admins die Warnleiste der Datenträgerprüfung (LFH-1100).
 */
/**
 * Menü-Key einer Sektion — EINE Quelle für Eintrag und Präfix-Match, sonst verlöre eine
 * Schreibweisen-Drift die Markierung still.
 */
function sektionsKey(gruppe: string, sektion: string): string {
  return `${gruppe}/${sektion}`;
}

/**
 * Der zu markierende Menü-Eintrag — PRÄFIX-Match statt Gleichheit, weil Detailrouten
 * (`stammdaten/fahrzeuge/7`) tiefer liegen als die Menü-Keys; sonst sähe die Sidebar auf einer
 * Detailseite verlassen aus.
 * Zwei Riegel gegen ein zu gieriges Präfix: der Trenner `/` (sonst träfe `stammdaten/personal`
 * auch `…personalstatus`) und der LÄNGSTE statt erste Treffer (für tiefer verschachtelte Keys).
 * Heute genügt jeder allein; beide bleiben für künftige Keys.
 */
function markierterKey(keys: string[], aktiv: string): string | undefined {
  return keys
    .filter((k) => aktiv === k || aktiv.startsWith(`${k}/`))
    .reduce<string | undefined>(
      (beste, k) => (beste && beste.length >= k.length ? beste : k),
      undefined,
    );
}

/**
 * Hält den markierten Eintrag im eigenen Bildlauf der Seitenleiste sichtbar (LFH-980), wie
 * `scrollIntoView({ block: 'nearest' })`, aber NUR im Container: `scrollIntoView` rollte auch das
 * Fenster, und die Seite spränge beim Routenwechsel.
 */
export function holeInsBild(container: HTMLElement, eintrag: HTMLElement): void {
  const rahmen = container.getBoundingClientRect();
  const ziel = eintrag.getBoundingClientRect();
  if (ziel.top < rahmen.top) container.scrollTop -= rahmen.top - ziel.top;
  else if (ziel.bottom > rahmen.bottom) container.scrollTop += ziel.bottom - rahmen.bottom;
}

/**
 * Die Seitenleiste ab `lg` (LFH-980), rein und exportiert. Bei 21 Einträgen in Touch-Dichte ist das
 * Menü rund 1400 px hoch; im Fluss bestimmte es die Seitenhöhe, und die unteren Einträge lagen
 * unter dem Bildschirmrand. Deshalb:
 * · `rest` ist die Höhe vom oberen Rand der Verwaltung bis zum unteren Seitenpolster
 *   (`oben` gemessen, das Polster aus `--lfh-seiten-polsterung`);
 * · die Verwaltung ist mindestens so hoch, kurze Seiten scrollen also nicht;
 * · das Menü klebt oben, ist höchstens `rest` hoch und scrollt in sich, es trägt zur Seitenhöhe
 *   nie mehr bei als die Verwaltung selbst. Es klebt unter dem Kopf, nicht an der Fensterkante
 *   (LFH-952, `frontend/AGENTS.md`, Rahmen); `rest` ist dort nie größer als der Platz darunter,
 *   weil `oben` die Kopfhöhe schon enthält.
 */
export function seitenleistenStil(oben: number): {
  verwaltung: CSSProperties;
  menue: CSSProperties;
} {
  const rest = `calc(100dvh - ${Math.max(0, Math.round(oben))}px - var(--lfh-seiten-polsterung))`;
  return {
    verwaltung: { minHeight: rest },
    menue: {
      position: 'sticky',
      top: 'var(--lfh-rahmen-oben, 0px)',
      maxHeight: rest,
      overflowY: 'auto',
    },
  };
}

export default function AdminLayout() {
  const { benutzer, laedt } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  // ALLE Hooks vor den frühen Rückgaben. Die Breitenfrage stellt nur `useViewport`, nicht antds
  // `Sider breakpoint` (eine zweite Wahrheit, deren Nullbreiten-Griff bei 390 px über dem Inhalt lag).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const [navOffen, setNavOffen] = useState(false);
  const verwaltungRef = useRef<HTMLElement>(null);
  const menueRef = useRef<HTMLElement>(null);
  const [oben, setOben] = useState(0);
  // Demo-Daten: fragt nur für den System-Admin ab, 404 heißt aus.
  const { freigeschaltet: demoFreigeschaltet } = useDemoDatenStatus();

  // Der obere Rand der Verwaltung im Dokument (Kopfleiste, Seitenpolster). Gemessen statt aus
  // Konstanten gerechnet: die Kopfleiste wächst mit der Dichte-Staffel, ohne dass sich die
  // Fensterbreite ändert. Deshalb beobachtet ein ResizeObserver die Vorfahren mit, gebündelt in
  // einem Frame wie in `components/FensterRahmen.tsx`.
  useLayoutEffect(() => {
    const el = verwaltungRef.current;
    if (!breit || !el) return;
    const messe = () => setOben(el.getBoundingClientRect().top + window.scrollY);
    messe();
    let frame: number | undefined;
    const messungPlanen = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        messe();
      });
    };
    const observer = new ResizeObserver(messungPlanen);
    for (let knoten = el.parentElement; knoten; knoten = knoten.parentElement) {
      observer.observe(knoten);
    }
    window.addEventListener('resize', messungPlanen);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', messungPlanen);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [breit, laedt]);

  // Nach jedem Routenwechsel den markierten Eintrag in den Bildlauf des Menüs holen. `oben` steht
  // in den Abhängigkeiten: vor der ersten Messung ist das Menü zu hoch, und ein Eintrag, der dann
  // „im Bild“ war, läge nach der Messung unter dem Rand.
  useEffect(() => {
    if (!breit) return;
    const menue = menueRef.current;
    const eintrag = menue?.querySelector<HTMLElement>('.ant-menu-item-selected');
    if (menue && eintrag) holeInsBild(menue, eintrag);
  }, [breit, pathname, laedt, demoFreigeschaltet, oben]);

  if (laedt) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!darfVerwaltung(benutzer)) {
    return <Navigate to="/einsaetze" replace />;
  }

  const istSystemAdmin = benutzer?.system_rolle === 'admin';
  // Die Sonder-Einträge in EINER Liste, damit Menü, Markierung und schmale Bauform nicht
  // auseinanderlaufen.
  const sonderEintraege = [
    ...(istSystemAdmin ? [adminBenutzer] : []),
    ...(istSystemAdmin ? [adminAufbewahrung] : []),
    ...(istSystemAdmin && demoFreigeschaltet ? [adminDemoDaten] : []),
  ];
  // '/admin/stammdaten/fahrzeuge' → 'stammdaten/fahrzeuge'; '/admin/benutzer' → 'benutzer'.
  const aktiv = pathname.replace(/^\/admin\/?/, '');

  const items: MenuProps['items'] = [
    ...adminGruppen.map((g) => ({
      key: g.key,
      type: 'group' as const,
      // Gruppentitel als Augenbraue; der Wortlaut bleibt der der Registry.
      label: <Augenbraue>{g.label}</Augenbraue>,
      children: g.sektionen.map((s) => ({ key: sektionsKey(g.key, s.key), label: s.label })),
    })),
    ...sonderEintraege.map((e) => ({ key: e.key, label: e.label })),
  ];
  const menuKeys = [
    ...adminGruppen.flatMap((g) => g.sektionen.map((s) => sektionsKey(g.key, s.key))),
    ...sonderEintraege.map((e) => e.key),
  ];
  const selektiert = markierterKey(menuKeys, aktiv);

  const menue = (
    <ConfigProvider
      theme={{
        components: {
          Menu: {
            itemBg: 'transparent',
            itemBorderRadius: 0,
            itemMarginInline: 0,
            itemColor: rollen.text2,
            itemHoverBg: rollen.flaeche,
            itemHoverColor: rollen.text,
            // `flaeche3`, nicht `flaeche2`: die läge am Tag bei 1,01 : 1 auf `paneel`.
            itemSelectedBg: rollen.flaeche3,
            itemSelectedColor: rollen.text,
            activeBarBorderWidth: 0,
          },
        },
      }}
    >
      <Menu
        mode="inline"
        items={items}
        selectedKeys={selektiert ? [selektiert] : []}
        onClick={({ key }) => {
          setNavOffen(false);
          navigate(`/admin/${key}`);
        }}
        style={{ background: 'transparent', borderInlineEnd: 'none' }}
      />
    </ConfigProvider>
  );

  if (!breit) {
    /*
     * UNTER `lg` STAPELT DIE SEITENLEISTE als Expander über dem Inhalt — kein zweiter
     * Navigations-Drawer (die Ausnahme gilt nur dem Einsatz-Rahmen). Zugeklappt nennt der Knopf den
     * aktuellen Bereich; nach der Wahl klappt die Liste zu, sonst schöbe sie jede Sektion nach unten.
     */
    const aktuell = [
      ...adminGruppen.flatMap((g) =>
        g.sektionen.map((sek) => ({ key: sektionsKey(g.key, sek.key), label: sek.label })),
      ),
      ...sonderEintraege.map((e) => ({ key: e.key, label: e.label })),
    ].find((e) => e.key === selektiert)?.label;
    return (
      <div>
        <nav aria-label="Verwaltung" style={{ marginBlockEnd: token.marginSM }}>
          <Button
            block
            aria-expanded={navOffen}
            aria-controls="verwaltung-navigation"
            onClick={() => setNavOffen((o) => !o)}
            style={{ justifyContent: 'space-between' }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Verwaltung{aktuell ? `: ${aktuell}` : ''}
            </span>
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              {navOffen ? <IconChevronHoch /> : <IconChevronRunter />}
            </span>
          </Button>
          {navOffen && (
            <div
              id="verwaltung-navigation"
              style={{
                marginBlockStart: token.marginXS,
                background: rollen.paneel,
                border: `1px solid ${rollen.linie}`,
              }}
            >
              {menue}
            </div>
          )}
        </nav>
        <DatentraegerWarnung />
        <Outlet />
      </div>
    );
  }

  const stil = seitenleistenStil(oben);
  return (
    <Layout ref={verwaltungRef} style={{ background: 'transparent', ...stil.verwaltung }}>
      {/* Die Verwaltungs-Seitenleiste im Stil des Modulpanels: Grund `paneel`, Haarlinie, Radius 0,
         aktive Zeile auf `flaeche3`. Ab `lg` immer sichtbar; die schmale Bauform steht oben. Grund
         und Haarlinie reichen über die ganze Höhe, das Menü darin klebt (`seitenleistenStil`). */}
      <Sider
        theme="light"
        width={220}
        style={{ background: rollen.paneel, borderInlineEnd: `1px solid ${rollen.linie}` }}
      >
        <nav ref={menueRef} aria-label="Verwaltung" data-lfh="verwaltung-menue" style={stil.menue}>
          {menue}
        </nav>
      </Sider>
      <Content style={{ paddingInlineStart: token.paddingLG }}>
        {/* Befund des Server-Rechners (LFH-1100), nur für den System-Admin und nur bei Warnung. */}
        <DatentraegerWarnung />
        <Outlet />
      </Content>
    </Layout>
  );
}
