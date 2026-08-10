import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Layout, Space, Spin } from 'antd';
import { TbMenu2 } from 'react-icons/tb';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import {
  istModulGesperrt, istModulSichtbar, kategorien, modulRegistry, moduleNachKategorie,
  modulZielRoute, type KategorieKey, type ModulEintrag,
} from './modulRegistry';
import EinsatzSwitcher from './EinsatzSwitcher';
import IconRail from './IconRail';
import ModulPanel from './ModulPanel';
import ModulAkkordeon from './ModulAkkordeon';
import { leseNavEingeklappt, schreibeNavEingeklappt } from './navPersistenz';
import { leseZuletztModule, merkeModulBesuch } from './zuletztModule';
import AlarmZentrale from './AlarmZentrale';
import ThemeToggle from '../components/ThemeToggle';
import BenutzerMenu from '../components/BenutzerMenu';
import CommandPaletteTrigger from '../components/CommandPaletteTrigger';
import { SeitenSackgasse } from '../components/SeitenZustand';
import { useViewport } from '../components/useViewport';
import { navDrawerBreite } from '../theme/tokens';
import { einsatzModulPfad } from '../routing/deeplinks';
import { useEinsatzLiveStream } from '../live/useEinsatzLiveStream';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { useModulZaehler } from './useModulZaehler';

const { Header, Content } = Layout;

/**
 * 48 px ist die Trefffläche aus A1 Festlegung 4 (Material 48 dp) — dieselbe Zahl,
 * die die Rail trägt. Sie gilt für den Hamburger und für den Schließen-Knopf, den
 * der Drawer selbst mitbringt: der ist von Haus aus kleiner, und ein Knopf, den
 * man auf dem Handschirm nicht trifft, ist keiner.
 */
const TREFFLAECHE = 48;

/**
 * Die Kopfzeile trägt ihre Polsterung selbst (LFH-329 · B1/M12).
 *
 * Ohne diesen Stil hinge sie am antd-Komponententoken, der sich aus der
 * Steuerhöhe ableitet und bei der kompakten Stufe rund 47 px je Seite beträgt —
 * auf einem 390-px-Schirm knapp ein Viertel der Breite, nur für Rand. Die Zahl
 * steht NICHT hier, sondern als Custom Property in `theme/rollen.css`: sie
 * hängt am Viewport, und eine Media-Regel greift beim ersten Paint, während
 * eine JS-Ableitung erst nach dem Mount stimmte. Geschwisterstil in
 * `components/AppLayout.tsx` — beide Kopfzeilen lesen dieselbe Property.
 */
const KOPF_STIL = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  paddingInline: 'var(--lfh-kopf-polsterung)',
} as const;

/**
 * Der Einsatzname bekommt die Restbreite — und nur die.
 *
 * `flexBasis: 0` ist tragend: mit `auto` bemäße sich der Rahmen am Inhalt, und
 * eine 60-Zeichen-Bezeichnung schöbe die Umschalter rechts aus der Kopfzeile
 * heraus. `minWidth: 0` ebenso — ohne die Aufhebung der Mindestbreite kürzt ein
 * Flex-Kind nicht, sondern wächst über seinen Rahmen hinaus. Die andere Hälfte
 * der Kürzung (Ellipsis, `title`) sitzt im `EinsatzSwitcher`: der Name steht in
 * einem antd-Knopf, und der kürzt ohne eigenes `overflow` nicht.
 */
const REST_STIL = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 } as const;

/**
 * Ebene 2: Einsatz-Workspace mit Switcher-Header, Icon-Rail und Modul-Panel.
 *
 * BREITENWEICHE AN antds `lg` (992 px, LFH-329 · B1/H11): darüber steht der
 * Rahmen inline wie bisher, darunter liegt die Navigation hinter dem Hamburger
 * in einem Drawer. Die Frage stellt ausschließlich `useViewport` — eine zweite,
 * handgeschriebene Breitenabfrage driftet still von antds Schwellen weg
 * (erzwungen von `components/useViewport.guard.test.ts`).
 */
export default function EinsatzLayout() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // EINE SSE-Verbindung für den gesamten Einsatz-Workspace (hier gehoistet, NICHT pro Page),
  // damit die Alarm-Zentrale seitenunabhängig auflöst und das HTTP/1.1-6-Verbindungslimit
  // sicher eingehalten wird (siehe useEinsatzLiveStream-Doku).
  useEinsatzLiveStream(einsatzId);

  // Die 401-Brücke (F14/LFH-263) saß bis LFH-268 hier und war damit einsatz-lokal: /admin,
  // /profil, Stammdaten und die Einsatzliste hatten gar keine Behandlung. Sie liegt jetzt als
  // `useSitzungsWache` in `App` und bedient SSE und HTTP über denselben Kanal.

  // Modul-Segment ist der Pfad-Teil direkt nach der Einsatz-ID
  // (…/einsaetze/:id/<route>/…) — nicht das letzte Segment, sonst verliert das
  // Menü auf Sub-Routen (Detail, Liste) die Hervorhebung.
  const aktuellesSegment = pathname.split('/').filter(Boolean)[2];
  const aktuellesModul = modulRegistry.find((m) => m.route === aktuellesSegment);
  const aktiveKategorie: KategorieKey | null = aktuellesModul?.kategorie ?? null;

  const { abBreite } = useViewport();
  const breit = abBreite('lg');

  const [offeneKategorie, setOffeneKategorie] = useState<KategorieKey | null>(aktiveKategorie);
  /**
   * ZWEITER Zustand neben `offeneKategorie`, bewusst getrennt: jene sagt WELCHE
   * Kategorie offen ist, dieser OB das Panel überhaupt steht. Der Effekt darunter
   * gleicht nur die erste Frage an die Route an und fasst diese hier NICHT an —
   * sonst klappte ein zugeklapptes Panel beim ersten Modulwechsel wieder auf, und
   * die Persistenz wäre wirkungslos. Lazy-Initialisierer: ein Lesevorgang, kein
   * Effekt.
   */
  const [panelEingeklappt, setPanelEingeklappt] = useState(leseNavEingeklappt);
  const [navOffen, setNavOffen] = useState(false);

  // Panel an die aktuelle Modul-Kategorie angleichen (auch nach Default-Redirect, der kein Remount auslöst).
  useEffect(() => {
    setOffeneKategorie(aktiveKategorie);
  }, [aktiveKategorie]);

  /**
   * Besuch aufzeichnen (LFH-337 · H12). Angesetzt am Modul-KEY, nicht am Objekt: die
   * Registry-Einträge sind zwar Modulkonstanten, aber ein Primitiv in der
   * Dependency-Liste erfüllt die exhaustive-deps-Regel strukturell statt sie zu
   * überreden (CLAUDE.md, Lint-Disziplin).
   *
   * `Number.isFinite`, weil `einsatzId` aus `useParams` stammt: auf einer Route ohne
   * gültige ID legte der Speicher sonst einen Eintrag unter `…:NaN` an.
   */
  const aktuellerModulKey = aktuellesModul?.key;
  useEffect(() => {
    if (aktuellerModulKey && Number.isFinite(einsatzId)) {
      merkeModulBesuch(einsatzId, aktuellerModulKey);
    }
  }, [einsatzId, aktuellerModulKey]);

  // Wird der Schirm breit, steht der Rahmen wieder inline — ein gemerktes „Drawer
  // offen" darf dann nicht auf die Rückkehr zum Handschirm warten. `breit` ist ein
  // Primitiv, damit ist die Dependency-Regel strukturell erfüllt.
  useEffect(() => {
    if (breit) setNavOffen(false);
  }, [breit]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einsatz = einsatzQuery.data;

  // Modul-Overrides (LFH-132) für die Nav-Reflexion; geteilter queryKey wie die
  // Einstellungen (Hot-Path, einmal gecacht je Einsatz).
  const modulOverridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  const modulOverrides = modulOverridesQuery.data;
  const modulZaehler = useModulZaehler({ einsatzId, benutzer, overrides: modulOverrides });

  /**
   * FRÜHER AUSSTIEG, VOR dem Haupt-JSX — nicht als Meldung innerhalb der Schale
   * (LFH-331 · B3).
   *
   * Die Kindseite im `Outlet` liest denselben Einsatz aus demselben
   * Zwischenspeicher. Bliebe der Rahmen stehen, stellte sie ihre eigene
   * Fehlermeldung daneben, und die Einsatzkraft sähe zwei konkurrierende Aussagen
   * über dieselbe Ursache. Deshalb die Großform statt eines Banners: hinter einem
   * kaputten Einsatz steht nichts mehr, die dreißig Türen der Navigation führen
   * alle ins Leere.
   *
   * Angesetzt wird ausschließlich an `isError`, ausdrücklich NICHT zusätzlich an
   * „keine Daten": während des Abrufs ist `einsatz` regulär leer, und ein Ausstieg
   * an dieser Stelle nähme dem Rahmen jeden Ladezustand — und machte nebenbei jede
   * Prüfung „unter `lg` steht die Navigation nicht im Layout" trivial wahr.
   *
   * Der Rückweg ist als Literal geschrieben: `routing/deeplinks.ts` baut
   * Einsatz-BINNEN-Pfade und führt die nackte Liste laut eigenem Dateikopf bewusst
   * nicht (kein passender Builder); `LageDashboardPage` verlinkt sie ebenso direkt.
   */
  if (einsatzQuery.isError) {
    return (
      <SeitenSackgasse
        titel="Einsatz konnte nicht geladen werden"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
        rueckweg={{ pfad: '/einsaetze', label: 'Zur Einsatzliste' }}
      />
    );
  }

  /**
   * Rail-Klick im inline-Rahmen: derselbe Kategorie-Knopf klappt das Panel zu und
   * merkt das; ein anderer klappt es wieder auf. Die Rail behält dabei ihre
   * Hervorhebung, weil sie `offeneKategorie ?? aktiveKategorie` bekommt.
   */
  function onKategorieKlick(key: KategorieKey) {
    const zu = offeneKategorie === key ? !panelEingeklappt : false;
    setOffeneKategorie(key);
    setPanelEingeklappt(zu);
    schreibeNavEingeklappt(zu);
  }

  /**
   * Kopfzeilen-Klick im Drawer: nur auf- und zuklappen. Das gemerkte Flag gehört
   * ausschließlich zum inline-Rahmen — sonst trüge derselbe Schalter in zwei
   * Darstellungen zwei Bedeutungen.
   */
  function onDrawerKategorieKlick(key: KategorieKey) {
    setOffeneKategorie((aktuell) => (aktuell === key ? null : key));
  }

  function onModulKlick(modul: ModulEintrag) {
    navigate(einsatzModulPfad(einsatzId, modulZielRoute(modul)));
    setNavOffen(false);
  }

  /**
   * Gemerkte Schlüssel → anzeigbare Module. Die Filter sind dieselben, die die Palette
   * anlegt (`command-palette/befehle.ts`): fertig, sichtbar, nicht rollen-gesperrt. Ein
   * Modul, das seit dem Besuch ausgeblendet oder entzogen wurde, verschwindet damit aus
   * der Abkürzung, statt in eine gesperrte Zeile zu führen.
   *
   * Das AKTUELLE Modul steht bewusst nicht in der Liste: es ist die Seite, auf der man
   * gerade steht — ein Sprung dorthin ist keine Abkürzung, und die drei Plätze sind knapp.
   *
   * Kein `useMemo`: die Liste hat höchstens drei Einträge, und `leseZuletztModule` muss
   * bei JEDEM Render laufen — der Speicher ist kein React-Zustand, eine Memoisierung über
   * den Modulschlüssel zeigte nach dem Aufzeichnungs-Effekt noch den vorigen Stand.
   */
  const zuletztModule = leseZuletztModule(einsatzId)
    .filter((key) => key !== aktuellerModulKey)
    .map((key) => modulRegistry.find((m) => m.key === key))
    .filter((m): m is ModulEintrag => m !== undefined
      && m.status === 'fertig'
      && istModulSichtbar(m, modulOverrides)
      && !istModulGesperrt(m, benutzer, modulOverrides));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={KOPF_STIL}>
        {!breit && (
          <Button
            type="text"
            aria-label="Navigation öffnen"
            // `flexShrink: 0` ist nicht Kosmetik: der Header ist eine Flex-Zeile,
            // und ohne die Sperre drückt der Inhalt daneben den Knopf auf dem
            // Handschirm auf gut die halbe Trefffläche zusammen (gemessen: 26 px).
            //
            // `color` ebenso wenig: ein antd-Textknopf erbt `colorText`, und die
            // Rolle folgt dem Farbschema — im Hellmodus also dunkel. Die
            // Kopfzeile trägt aber in BEIDEN Modi denselben dunklen Grund
            // (gemessen `rgb(0, 21, 41)`), sodass der Griff dort dunkel auf
            // dunkel verschwand. Er folgt jetzt seinem Grund statt dem Modus —
            // dieselbe Entscheidung, die Alarmzentrale und Benutzermenü
            // nebenan schon treffen, hier nur als Rolle statt als wiederholter
            // Festwert.
            style={{
              width: TREFFLAECHE,
              height: TREFFLAECHE,
              flexShrink: 0,
              color: 'var(--lfh-kopf-vordergrund)',
            }}
            icon={<TbMenu2 size={24} />}
            onClick={() => setNavOffen(true)}
          />
        )}
        <div style={REST_STIL}>
          {einsatzQuery.isLoading ? (
            <Spin />
          ) : (
            <EinsatzSwitcher aktuellName={einsatz?.bezeichnung ?? 'Einsatz'} />
          )}
        </div>
        <Space style={{ marginLeft: 'auto' }} size="middle">
          {/* Die Alarm-Zentrale bleibt auch auf dem Handschirm stehen und nennt
              Desktop-/Tonstatus ausdrücklich; „blockiert“ oder „stumm“ darf im
              Einsatz nicht nur über eine Ikone vermittelt werden. Farbschema
              UND Bediendichte wandern unter `lg` dagegen ins Benutzermenü. */}
          <AlarmZentrale />
          <CommandPaletteTrigger />
          {breit && <ThemeToggle />}
          <BenutzerMenu />
        </Space>
      </Header>
      {/* Warnung, keine Sackgasse: der Einsatz bleibt vollständig bedienbar, nur die
          Navigation zeigt womöglich mehr, als konfiguriert ist. `istModulSichtbar`
          (`einsatz/modulRegistry.ts`) prüft `sichtbar !== false` und fällt ohne
          Overrides also nach OFFEN — jedes per LFH-132 ausgeblendete Modul stünde
          stumm wieder in der Nav. Ein stiller Fehlschlag wäre hier schlimmer als ein
          lauter: er sieht aus wie eine Einsatzkonfiguration, die niemand so gesetzt
          hat. Rot bleibt der Gefahr vorbehalten (Bedien-Leitlinie), deshalb `warning`. */}
      {modulOverridesQuery.isError && (
        <Alert
          type="warning"
          showIcon
          banner
          title="Modul-Sichtbarkeit konnte nicht geladen werden — die Navigation zeigt womöglich Module, die für diesen Einsatz ausgeblendet sind."
          action={
            <Button onClick={() => void modulOverridesQuery.refetch()}>Erneut abrufen</Button>
          }
        />
      )}
      {/* Das Seitenspalten-Attribut unten ist tragend, in BEIDEN Zweigen: weder
          die Rail (`<nav>`) noch das Panel (`<div>`) ist eine antd-Seitenspalte,
          antd erkennt also von selbst keine — nur dieses Attribut erzwingt die
          waagerechte Achse. Ohne es stapeln die Spalten untereinander. */}
      <Layout hasSider>
        {breit && (
          <IconRail
            kategorien={kategorien}
            aktiveKategorie={offeneKategorie ?? aktiveKategorie}
            onKategorieKlick={onKategorieKlick}
          />
        )}
        {breit && offeneKategorie && !panelEingeklappt && (
          <ModulPanel
            titel={kategorien.find((k) => k.key === offeneKategorie)!.label}
            module={moduleNachKategorie(offeneKategorie)}
            benutzer={benutzer}
            overrides={modulOverrides}
            zaehler={modulZaehler}
            zuletztModule={zuletztModule}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
          />
        )}
        <Content style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
          <EinsatzAnzeigeProvider einsatzId={einsatzId}>
            <Outlet />
          </EinsatzAnzeigeProvider>
        </Content>
      </Layout>
      {/* Nur im Schmal-Zweig überhaupt vorhanden, und bewusst OHNE Vorab-Rendern
          des Inhalts: sonst stünden die Navigationsknoten doppelt im Baum und
          jede Aussage über den ausgeblendeten Rahmen wäre bedeutungslos.
          `destroyOnHidden`, weil das Panel sonst nach dem Schließen im DOM
          stehenbleibt und ein „ist zu"-Assert nichts mehr belegt. */}
      {!breit && (
        <Drawer
          placement="left"
          title="Navigation"
          // `size`, nicht `width`: letzteres ist in antd 6 abgekündigt und
          // meldet sich im Entwicklungsmodus als Konsolen-Warnung.
          size={navDrawerBreite}
          open={navOffen}
          onClose={() => setNavOffen(false)}
          destroyOnHidden
          styles={{ close: { minWidth: TREFFLAECHE, minHeight: TREFFLAECHE } }}
        >
          <ModulAkkordeon
            kategorien={kategorien}
            offeneKategorie={offeneKategorie}
            aktiverModulKey={aktuellesModul?.key ?? null}
            benutzer={benutzer}
            overrides={modulOverrides}
            zaehler={modulZaehler}
            onKategorieKlick={onDrawerKategorieKlick}
            onModulKlick={onModulKlick}
          />
        </Drawer>
      )}
    </Layout>
  );
}
