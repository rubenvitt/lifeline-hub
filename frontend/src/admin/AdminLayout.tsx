import { Layout, Menu, Spin, theme } from 'antd';
import type { MenuProps } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
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
    .reduce<string | undefined>((beste, k) => (beste && beste.length >= k.length ? beste : k), undefined);
}

export default function AdminLayout() {
  const { benutzer, laedt } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();

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
      label: g.label,
      children: g.sektionen.map((s) => ({ key: sektionsKey(g.key, s.key), label: s.label })),
    })),
    ...(istSystemAdmin ? [{ key: adminBenutzer.key, label: adminBenutzer.label }] : []),
  ];
  const menuKeys = [
    ...adminGruppen.flatMap((g) => g.sektionen.map((s) => sektionsKey(g.key, s.key))),
    ...(istSystemAdmin ? [adminBenutzer.key] : []),
  ];
  const selektiert = markierterKey(menuKeys, aktiv);

  return (
    <Layout style={{ background: 'transparent' }}>
      <Sider
        theme="light"
        width={220}
        breakpoint="lg"
        collapsedWidth={0}
        style={{ background: 'transparent' }}
      >
        <Menu
          mode="inline"
          items={items}
          selectedKeys={selektiert ? [selektiert] : []}
          onClick={({ key }) => navigate(`/admin/${key}`)}
          style={{ background: 'transparent', borderInlineEnd: 'none' }}
        />
      </Sider>
      <Content style={{ paddingInlineStart: token.paddingLG }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
