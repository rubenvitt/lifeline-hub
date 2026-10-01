import { IkoneMenue } from '../ikonen';
import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Layout, Spin, theme } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import {
  erstesFreigegebenesModul,
  kategorien,
  modulAusPfad,
  moduleNachKategorie,
  modulZielRoute,
  type KategorieKey,
  type ModulEintrag,
} from './modulRegistry';
import { sprungmarkenNachKategorie, type Sprungmarke } from './sprungmarken';
import EinsatzSwitcher from './EinsatzSwitcher';
import IconRail from './IconRail';
import ModulPanel from './ModulPanel';
import ModulAkkordeon from './ModulAkkordeon';
import { leseNavEingeklappt, schreibeNavEingeklappt } from './navPersistenz';
import { merkeModulBesuch } from './zuletztModule';
import AlarmZentrale from './AlarmZentrale';
import BenutzerMenu from '../components/BenutzerMenu';
import CommandPaletteTrigger from '../components/CommandPaletteTrigger';
import {
  KOPF_HOEHE,
  KOPF_NAME_FLEX,
  KOPF_NAME_FLEX_SCHMAL,
  KOPF_SUCHE_FLEX,
  KopfRechts,
  Markenzelle,
  SyncAnzeige,
  Uhr,
  Wortmarke,
  kopfZelleStil,
} from '../components/Kopfleiste';
import { SeitenSackgasse } from '../components/SeitenZustand';
import { useViewport } from '../components/useViewport';
import type { EinsatzAnzeige } from '../api/types';
import { einsatzStatus } from '../theme/statusFarben';
import { farbenDunkel, navDrawerBreite, rahmenFarben, schrift } from '../theme/tokens';
import { einsaetzePfad, einsatzModulPfad, parseRouteId } from '../routing/deeplinks';
import { useEinsatzLiveStream } from '../live/useEinsatzLiveStream';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { useModulZaehler } from './useModulZaehler';
import UnwetterHinweis from '../wetter/UnwetterHinweis';
import { useAktiveWarnung } from './useAktiveWarnung';
import { useWarnsperre } from '../theme/ThemeModeProvider';

const { Header, Content } = Layout;

/**
 * 48 px (Material 48 dp) — Boden für den Hamburger und den Schließen-Knopf des Drawers, der
 * von Haus aus kleiner ist. Gelesen wird nur {@link navGriffMass}.
 */
const TREFFLAECHE = 48;

/**
 * Kantenmaß der zwei Griffe des Drawer-Zweigs (Hamburger, Drawer-Schließer): A1-Boden, darüber
 * die Staffel — 48 / 48 / 72; eine feste 48 unterschritt `handschuh` um 24 px (LFH-384). Rein
 * und exportiert, damit die Zusicherung ohne Rendern prüfbar ist.
 */
export function navGriffMass(token: { controlHeight: number }): number {
  return Math.max(TREFFLAECHE, token.controlHeight);
}

/**
 * Die Kommandoleiste: 52 px auf dem modusunabhängig dunklen Rahmengrund, Haarlinie unten,
 * Zellen statt Abständen.
 * `flexWrap` bleibt: auf dem Handschirm bricht die rechte Zellgruppe als GANZES in eine zweite
 * Zeile, statt überzulaufen. `height: auto` und `lineHeight: normal`, weil antds `Header` sonst
 * seine Tokenhöhe als Textzeile reserviert. Die 52 px sind ein Boden (in `handschuh` 72).
 * Die Seiten-Polsterung ist 0, die Zellen tragen ihren Rand; die Kopf-Polsterung sitzt an der
 * Suchzelle, der einen Stelle, deren Luft mit dem Viewport wachsen soll.
 */
const KOPF_STIL = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'stretch',
  height: 'auto',
  lineHeight: 'normal',
  minHeight: KOPF_HOEHE,
  padding: 0,
  background: rahmenFarben.grund,
  borderBottom: `1px solid ${rahmenFarben.linie}`,
  color: rahmenFarben.text,
} as const;

/**
 * Der Einsatzname bekommt die Restbreite — und nur die. `flexBasis: 0` und `minWidth: 0` sind
 * tragend: sonst schöbe ein langer Name die Zellen rechts hinaus. Die Ellipsis sitzt im
 * `EinsatzSwitcher` (ein antd-Knopf kürzt ohne eigenes `overflow` nicht).
 */
const REST_STIL = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 } as const;

/**
 * Die Einsatznummer im Kopf: die interne, sonst die Leitstellennummer, sonst KEINE — die
 * Datenbank-`id` ist keine Einsatznummer.
 */
export function einsatzKennung(
  einsatz: Pick<EinsatzAnzeige, 'einsatznummer_intern' | 'leitstellen_nr'> | undefined,
): string | null {
  const intern = einsatz?.einsatznummer_intern?.trim();
  if (intern) return intern;
  const leitstelle = einsatz?.leitstellen_nr?.trim();
  return leitstelle ? leitstelle : null;
}

/**
 * Statuspunkt vor der Einsatznummer: `normal` bei aktivem Einsatz, sonst neutral. Das Wort
 * steht als zugänglicher Name (`role="img"`) und `title` am Punkt (WCAG 1.4.1).
 */
function StatusPunkt({ status }: { status: EinsatzAnzeige['status'] }) {
  const darstellung = einsatzStatus[status];
  const farbe = darstellung.rolle === 'normal' ? farbenDunkel.normal : farbenDunkel.schwach;
  return (
    <span
      role="img"
      aria-label={`Einsatzstatus: ${darstellung.label}`}
      title={darstellung.label}
      style={{ width: 6, height: 6, flexShrink: 0, background: farbe }}
    />
  );
}

/**
 * Ebene 2: Einsatz-Workspace mit Kopfleiste, Icon-Rail und Modul-Panel.
 * Breitenweiche an antds `lg`: darüber steht der Rahmen inline, darunter liegt die Navigation
 * hinter dem Hamburger in einem Drawer. Die Frage stellt ausschließlich `useViewport`
 * (erzwungen von `components/useViewport.guard.test.ts`).
 */
export default function EinsatzLayout() {
  const einsatzId = parseRouteId(useParams().id);
  /*
   * LFH-438: eine verbogene ID (Hand-URL, kaputtes Lesezeichen) führt auf die Einsatzliste, wie
   * bei den Detailseiten unter `pages/`. Die Weiche steht VOR dem Rahmen, damit darin keine
   * `NaN`-Abrufe, -Pfade oder -Speicherschlüssel entstehen und jede Kindroute eine gültige ID erbt.
   */
  if (einsatzId == null) return <Navigate to={einsaetzePfad()} replace />;
  return <EinsatzRahmen einsatzId={einsatzId} />;
}

function EinsatzRahmen({ einsatzId }: { einsatzId: number }) {
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // EINE SSE-Verbindung für den ganzen Einsatz-Workspace (hier gehoistet, NICHT pro Seite),
  // damit die Alarm-Zentrale seitenunabhängig auflöst und das HTTP/1.1-Verbindungslimit hält.
  useEinsatzLiveStream(einsatzId);

  // Modul-Segment ist der Pfad-Teil direkt nach der Einsatz-ID, nicht das letzte Segment — sonst
  // verlöre das Menü auf Sub-Routen die Hervorhebung.
  const aktuellesModul = modulAusPfad(pathname);
  const aktiveKategorie: KategorieKey | null = aktuellesModul?.kategorie ?? null;

  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const mittel = abBreite('md');
  // Ab `xl` trägt der Kopf alle Wörter; darunter (Führungs-Tablet) stehen Ruhezustände nur als
  // Ikone, damit er einzeilig bleibt.
  const weit = abBreite('xl');
  const { token } = theme.useToken();
  // Unter `md` rücken die Zellen zusammen, sonst bräche die rechte Gruppe auf 390 px in eine
  // dritte Zeile.
  const zellToken = mittel ? token : { padding: token.paddingXS };

  const [offeneKategorie, setOffeneKategorie] = useState<KategorieKey | null>(aktiveKategorie);
  /**
   * ZWEITER Zustand neben `offeneKategorie`: jene sagt WELCHE Kategorie offen ist, dieser OB das
   * Panel steht. Der Effekt darunter gleicht nur die erste an die Route an — sonst klappte ein
   * zugeklapptes Panel beim ersten Modulwechsel wieder auf.
   */
  const [panelEingeklappt, setPanelEingeklappt] = useState(leseNavEingeklappt);
  const [navOffen, setNavOffen] = useState(false);

  // Panel an die aktuelle Modul-Kategorie angleichen (auch nach dem Default-Redirect).
  useEffect(() => {
    setOffeneKategorie(aktiveKategorie);
  }, [aktiveKategorie]);

  // Wird der Schirm breit, steht der Rahmen inline; ein gemerktes „Drawer offen" wird geräumt.
  useEffect(() => {
    if (breit) setNavOffen(false);
  }, [breit]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einsatz = einsatzQuery.data;

  // Modul-Overrides für die Navigation; geteilter Query-Key wie die Einstellungen.
  const modulOverridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  const modulOverrides = modulOverridesQuery.data;
  const modulZaehler = useModulZaehler({ einsatzId, benutzer, overrides: modulOverrides });
  // Warnsperre des Helligkeitsreglers (LFH-397): nur dieser Rahmen steht für den ganzen
  // Einsatz, deshalb meldet er die Warnung. Verlässt man den Einsatz, baut er ab und nimmt
  // die Sperre mit — in der Einsatzauswahl gibt es keine Einsatzwarnung.
  useWarnsperre(useAktiveWarnung({ einsatzId, benutzer, overrides: modulOverrides }));

  /**
   * FRÜHER AUSSTIEG vor dem Haupt-JSX: die Kindseite liest denselben Einsatz aus demselben Cache
   * und stellte sonst eine zweite Fehlermeldung daneben. Hinter einem kaputten Einsatz führt die
   * ganze Navigation ins Leere, deshalb die Großform statt eines Banners.
   * Nur an `isError`, NICHT an „keine Daten": während des Abrufs ist `einsatz` regulär leer.
   */
  if (einsatzQuery.isError) {
    return (
      <SeitenSackgasse
        titel="Einsatz konnte nicht geladen werden"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
        rueckweg={{ pfad: einsaetzePfad(), label: 'Zur Einsatzliste' }}
      />
    );
  }

  /**
   * Rail-Klick im inline-Rahmen: SELBSTKLICK = ZUKLAPPEN, FREMDKLICK = SPRUNG in das erste
   * freigegebene Modul der Kategorie.
   * Nicht immer navigieren: der Angleich-Effekt höbe sonst das persistierte Zuklappen in
   * derselben Runde auf. Die Rail behält ihre Hervorhebung über
   * `offeneKategorie ?? aktiveKategorie`. Ohne freigegebenes Modul nur aufklappen.
   * Dieser Sprung wird NICHT gemerkt: sein Ziel hat niemand gewählt, und drei Rail-Klicks
   * überschrieben sonst die ganze „Zuletzt"-Liste. Gemerkt wird in `onModulKlick`.
   */
  function onKategorieKlick(key: KategorieKey) {
    if (offeneKategorie === key) {
      const zu = !panelEingeklappt;
      setPanelEingeklappt(zu);
      schreibeNavEingeklappt(zu);
      return;
    }
    setOffeneKategorie(key);
    setPanelEingeklappt(false);
    schreibeNavEingeklappt(false);
    const ziel = erstesFreigegebenesModul(key, benutzer, modulOverrides);
    if (ziel) navigate(einsatzModulPfad(einsatzId, modulZielRoute(ziel)));
  }

  /**
   * Kopfzeilen-Klick im Drawer: nur auf- und zuklappen. Das gemerkte Flag gehört ausschließlich
   * zum inline-Rahmen.
   */
  function onDrawerKategorieKlick(key: KategorieKey) {
    setOffeneKategorie((aktuell) => (aktuell === key ? null : key));
  }

  /**
   * Modulklick — einer der Wege, auf denen der „Zuletzt"-Speicher (gelesen von der
   * Kommandopalette) gefüllt wird; die Übersicht aller Zugänge steht in `zuletztModule.ts`.
   * Gemerkt wird, was jemand GEWÄHLT hat, keine Ankünfte: der Rail-Sprung und ein Deep-Link von
   * außen laufen bewusst nicht hinein, sonst käme die Erosion durch Rail-Sprünge zurück.
   * VOR `navigate`, weil der Routenwechsel den lesenden Render auslöst. Ohne Benutzer (Sitzung
   * lädt noch) kein Eintrag.
   */
  function onModulKlick(modul: ModulEintrag) {
    if (benutzer) merkeModulBesuch(benutzer.id, einsatzId, modul.key);
    navigate(einsatzModulPfad(einsatzId, modulZielRoute(modul)));
    setNavOffen(false);
  }

  /**
   * Klick auf eine Sprungmarke — NICHT im „Zuletzt"-Speicher: der trägt Modulschlüssel, und eine
   * Marke ist keins.
   */
  function onSprungKlick(marke: Sprungmarke) {
    navigate(marke.pfad(einsatzId));
    setNavOffen(false);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={KOPF_STIL}>
        {/* LINKE GRUPPE: Marke (bzw. Griff unter `lg`), Wortmarke, Einsatzkennung. Bei Platzmangel
           bricht die rechte Gruppe um; die linke wächst stärker als die Suche, damit der Name erst
           spät kürzt. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            flex: breit ? KOPF_NAME_FLEX : KOPF_NAME_FLEX_SCHMAL,
            minWidth: 0,
          }}
        >
          {breit ? (
            <Markenzelle />
          ) : (
            <div style={kopfZelleStil({ padding: 0 })}>
              <Button
                type="text"
                aria-label="Navigation öffnen"
                // `flexShrink: 0`: sonst drückt der Inhalt daneben den Knopf auf dem Handschirm auf die halbe
                // Trefffläche. Die Farbe folgt dem dunklen Rahmengrund, nicht dem Modus.
                style={{
                  width: navGriffMass(token),
                  height: navGriffMass(token),
                  flexShrink: 0,
                  color: rahmenFarben.text,
                }}
                icon={<IkoneMenue size={22} />}
                onClick={() => setNavOffen(true)}
              />
            </div>
          )}
          <div style={{ ...kopfZelleStil(zellToken), ...REST_STIL }}>
            {breit && (
              <>
                <Wortmarke />
                <span
                  aria-hidden="true"
                  style={{ width: 1, height: 18, flexShrink: 0, background: rahmenFarben.linie }}
                />
              </>
            )}
            {einsatz && <StatusPunkt status={einsatz.status} />}
            {mittel && einsatzKennung(einsatz) && (
              <span
                data-lfh="kopf-einsatznummer"
                style={{
                  fontFamily: schrift.zahl,
                  fontSize: 12,
                  color: rahmenFarben.text,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {einsatzKennung(einsatz)}
              </span>
            )}
            <div style={REST_STIL}>
              {einsatzQuery.isLoading ? (
                <Spin />
              ) : (
                <EinsatzSwitcher aktuellName={einsatz?.bezeichnung ?? 'Einsatz'} />
              )}
            </div>
          </div>
        </div>
        {/* SUCHZELLE ab `lg`: das Suchfeld als Auslöser der Palette. Sie trägt die Kopf-Polsterung
           (`kopfpolsterung.guard.test.ts` zählt genau diese Stelle). */}
        {breit && (
          <div
            data-lfh="kopf-suche"
            style={{
              flex: KOPF_SUCHE_FLEX,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              paddingInline: 'var(--lfh-kopf-polsterung)',
            }}
          >
            <CommandPaletteTrigger />
          </div>
        )}
        {/* RECHTE GRUPPE: Zellen mit Haarlinien. Die Alarmzentrale steht in EIGENER Zelle — sie ZEIGT
           einen Zustand — auf JEDER Breite und nennt ihn im Text: „blockiert" oder „stumm" darf im
           Einsatz nicht nur über eine Ikone laufen. */}
        <KopfRechts>
          <div data-lfh="kopf-alarm" style={kopfZelleStil(zellToken)}>
            <AlarmZentrale einsatzId={einsatzId} />
          </div>
          <SyncAnzeige liveErwartet kompakt={!mittel} ruheOhneWort={!weit} />
          {mittel && <Uhr />}
          {!breit && (
            <div style={kopfZelleStil(zellToken)}>
              <CommandPaletteTrigger />
            </div>
          )}
          <div
            style={{ ...kopfZelleStil(zellToken, 'keiner'), paddingInlineStart: token.paddingXS }}
          >
            <BenutzerMenu funktion={einsatz?.meine_funktion} />
          </div>
        </KopfRechts>
      </Header>
      {/* Warnung, keine Sackgasse: ohne Overrides fällt `istModulSichtbar` nach OFFEN, jedes
         ausgeblendete Modul stünde stumm wieder in der Navigation. Ein stiller Fehlschlag sähe aus wie
         eine Konfiguration, die niemand gesetzt hat. `warning`, weil Rot der Gefahr vorbehalten ist. */}
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
      {/* `hasSider` ist tragend: weder Rail noch Panel ist eine antd-Seitenspalte, ohne das Attribut
         stapelten die Spalten untereinander. */}
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
            einsatz={einsatz}
            module={moduleNachKategorie(offeneKategorie)}
            benutzer={benutzer}
            overrides={modulOverrides}
            zaehler={modulZaehler}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
            sprungmarken={sprungmarkenNachKategorie(offeneKategorie)}
            onSprungKlick={onSprungKlick}
          />
        )}
        <Content style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
          <EinsatzAnzeigeProvider einsatzId={einsatzId}>
            {/* Neue Unwetterwarnung am Einsatzort → ein Hinweis in der AlarmZentrale (LFH-663).
               Im Rahmen, weil nur er für den ganzen Einsatz steht; im Provider, weil der Text
               Zeitzone und Zeitformat des Einsatzes trägt. */}
            <UnwetterHinweis einsatzId={einsatzId} benutzer={benutzer} overrides={modulOverrides} />
            <Outlet />
          </EinsatzAnzeigeProvider>
        </Content>
      </Layout>
      {/* Nur im Schmal-Zweig vorhanden und OHNE Vorab-Rendern, sonst stünde die Navigation doppelt im
         Baum. `destroyOnHidden`, damit ein „ist zu"-Assert etwas belegt. */}
      {!breit && (
        <Drawer
          placement="left"
          title="Navigation"
          // `size`, nicht `width` (in antd 6 abgekündigt).
          size={navDrawerBreite}
          open={navOffen}
          onClose={() => setNavOffen(false)}
          destroyOnHidden
          // Der Schließer folgt der Staffel wie der Hamburger, der ihn öffnet (LFH-384).
          styles={{ close: { minWidth: navGriffMass(token), minHeight: navGriffMass(token) } }}
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
            onSprungKlick={onSprungKlick}
          />
        </Drawer>
      )}
    </Layout>
  );
}
