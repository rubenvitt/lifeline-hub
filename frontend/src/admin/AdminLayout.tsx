import { useState } from 'react';
import { Button, ConfigProvider, Layout, Menu, Spin, theme } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { Augenbraue, useRollen } from '../components/instrument';
import type { MenuProps } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { useViewport } from '../components/useViewport';
import { adminBenutzer, adminGruppen } from './adminNav';

const { Sider, Content } = Layout;

/**
 * Admin-Shell (LFH-284): eine linke Sidebar (gruppiertes `Menu`) als EINZIGE Nav-Ebene für
 * `/admin` + `<Outlet>`. Löst die frühere doppelte Nav (Top-Tabs + In-Page-Umschalter) auf.
 * Menu-Einträge und Routen stammen aus derselben `adminNav`-Registry; die aktive Sektion folgt
 * der URL (kein eigener Nav-State). Sitzt unter <AppLayout> (globale Topbar kommt von dort).
 * Gate: `darfVerwaltung` (admin oder fuehrungskraft, seit LFH-328 aus `einsatz/schreibrecht.ts`
 * statt lokaler Kopie) — sonst Redirect zu /einsaetze. Benutzer-Eintrag nur für System-Admins
 * (strengeres Gate der Seite selbst bleibt zusätzlich bestehen).
 */
/**
 * Menü-Key einer Sektion — EINE Quelle für den Eintrag UND den Präfix-Match unten. Zwei
 * Schreibweisen desselben Schlüssels wären genau die Drift, die die Markierung still verlöre.
 */
function sektionsKey(gruppe: string, sektion: string): string {
  return `${gruppe}/${sektion}`;
}

/**
 * Der zu markierende Menü-Eintrag zum aktuellen Pfad — PRÄFIX-Match statt Gleichheit
 * (LFH-346 · C11, Review-Befund): die Menü-Keys sind exakt zweisegmentig
 * (`stammdaten/fahrzeuge`), die Detailrouten aus A7 dreisegmentig
 * (`stammdaten/fahrzeuge/7`). Mit `selectedKeys={[aktiv]}` war auf einer Detailseite KEIN
 * Eintrag markiert — die Sidebar sah aus, als hätte man die Verwaltung verlassen, und der
 * Rückweg hatte keinen hervorgehobenen Anker.
 *
 * Zwei Riegel gegen ein zu gieriges Präfix: der Trenner `/` (ohne ihn markierte der Key
 * `stammdaten/personal` auch eine Route `stammdaten/personalstatus`) und der LÄNGSTE statt
 * erste Treffer (bei künftig tiefer verschachtelten Keys gewänne sonst der kürzere).
 *
 * Gemessen und hier festgehalten, damit es niemand als Deckung missversteht: auf den heute
 * erreichbaren Routen genügt JEDER der beiden allein — einzeln zurückgedreht bleibt die Suite
 * grün, rot wird sie erst, wenn beide fallen. Das einzige Präfix-Paar im Bestand
 * (`stammdaten/personal` / `…-status`) wird vom Trenner schon abgefangen. Beide bleiben
 * trotzdem stehen: der erste dreisegmentige Menü-Key braucht den Längen-Vergleich, der erste
 * Key ohne Trenner den anderen.
 */
function markierterKey(keys: string[], aktiv: string): string | undefined {
  return keys
    .filter((k) => aktiv === k || aktiv.startsWith(`${k}/`))
    .reduce<string | undefined>(
      (beste, k) => (beste && beste.length >= k.length ? beste : k),
      undefined,
    );
}

export default function AdminLayout() {
  const { benutzer, laedt } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  // ALLE Hooks vor den frühen Rückgaben unten. Die Breitenfrage stellt ausschließlich
  // `useViewport` — nicht antds `Sider breakpoint`, das eine zweite Wahrheit neben der
  // Viewport-Achse wäre. Gemessen am Vorgänger (e2e, 390 px): die Leiste klappte auf 1 px,
  // ihr Nullbreiten-Griff (50 px in `kompakt`, 102 px in `handschuh`) lag dann ÜBER dem
  // linken Inhaltsrand; in der Vorschau wurde zusätzlich ein Überlauf auf 408/411 px
  // gemeldet, der sich im e2e nicht nachstellen ließ.
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const [navOffen, setNavOffen] = useState(false);

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
  // '/admin/stammdaten/fahrzeuge' → 'stammdaten/fahrzeuge'; '/admin/benutzer' → 'benutzer'.
  const aktiv = pathname.replace(/^\/admin\/?/, '');

  const items: MenuProps['items'] = [
    ...adminGruppen.map((g) => ({
      key: g.key,
      type: 'group' as const,
      // Gruppentitel als Augenbraue (Neuentwurf: Modulpanel-Kopf) — der Wortlaut bleibt der
      // der Registry, nur der Satz ist 10 px/600/Versalien.
      label: <Augenbraue>{g.label}</Augenbraue>,
      children: g.sektionen.map((s) => ({ key: sektionsKey(g.key, s.key), label: s.label })),
    })),
    ...(istSystemAdmin ? [{ key: adminBenutzer.key, label: adminBenutzer.label }] : []),
  ];
  const menuKeys = [
    ...adminGruppen.flatMap((g) => g.sektionen.map((s) => sektionsKey(g.key, s.key))),
    ...(istSystemAdmin ? [adminBenutzer.key] : []),
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
            itemSelectedBg: rollen.flaeche2,
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
     * UNTER `lg` STAPELT DIE SEITENLEISTE (Leitlinie „Seitenleisten stapeln unter lg"), als
     * EXPANDER über dem Inhalt — kein zweiter Navigations-Drawer: die Ausnahme dafür ist in
     * CLAUDE.md ausdrücklich auf den Einsatz-Rahmen beschränkt. Zugeklappt nennt der Knopf
     * den aktuellen Bereich, damit der Ort auch ohne offene Liste lesbar bleibt; nach der
     * Wahl klappt die Liste wieder zu, sonst schöbe sie jede Sektion um ihre volle Höhe
     * nach unten. Der Knopf ist ein antd-`Button` und erbt damit die Dichte-Staffel.
     */
    const aktuell = [
      ...adminGruppen.flatMap((g) =>
        g.sektionen.map((sek) => ({ key: sektionsKey(g.key, sek.key), label: sek.label })),
      ),
      ...(istSystemAdmin ? [{ key: adminBenutzer.key, label: adminBenutzer.label }] : []),
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
              {navOffen ? <UpOutlined /> : <DownOutlined />}
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
        <Outlet />
      </div>
    );
  }

  return (
    <Layout style={{ background: 'transparent' }}>
      {/* Die Verwaltungs-Seitenleiste im Stil des Modulpanels (Neuentwurf, `shell.dc.html`):
          Grund `paneel`, Haarlinie zur Seite, Radius 0, aktive Zeile auf `flaeche2` statt
          der antd-Pille. Farben aus den Rollen, Höhen aus der Staffel. Ab `lg` immer
          sichtbar; die schmale Bauform steht oben. */}
      <Sider
        theme="light"
        width={220}
        style={{ background: rollen.paneel, borderInlineEnd: `1px solid ${rollen.linie}` }}
      >
        {menue}
      </Sider>
      <Content style={{ paddingInlineStart: token.paddingLG }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
