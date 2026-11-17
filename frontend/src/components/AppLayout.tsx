import { IconSchloss } from '../icons';
import { Layout, Tag, Typography, theme } from 'antd';
import type { CSSProperties } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useEinsatzRueckweg } from '../einsatz/einsatzRueckweg';
import { useAuth } from '../auth/AuthContext';
import { darfPlanen, darfVerwaltung } from '../einsatz/schreibrecht';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';
import AlarmZone from '../alarm/AlarmZone';
import OrgBenachrichtigungen from '../alarm/OrgBenachrichtigungen';
import BenutzerMenu from './BenutzerMenu';
import { RAHMEN_KLEBT, RAHMEN_RANG, useRahmenObenStapel } from './rahmenOben';
import CommandPaletteTrigger from './CommandPaletteTrigger';
import {
  KOPF_HOEHE,
  KopfRechts,
  Markenzelle,
  SyncAnzeige,
  Uhr,
  Wortmarke,
  kopfZelleStil,
} from './Kopfleiste';
import { useViewport } from './useViewport';
import { useDokumentTitel } from './useDokumentTitel';
import { ebene1Seite } from './ebene1Seite';
import { planungenPfad } from '../routing/deeplinks';
import { Ebene1OrtProvider, type Ebene1OrtWert } from './Ebene1OrtKontext';
import { schriftGroesse } from './instrument/rollenwerte';
import { sprungzielInhalt } from './SprungZumInhalt';

const { Header, Content } = Layout;

/**
 * Die Kommandoleiste der Ebene-1-Shell — dieselbe Gestalt wie im Einsatz-Workspace
 * (`einsatz/EinsatzLayout.tsx`): 52 px auf dem dunklen Rahmengrund, Haarlinie unten, Zellen
 * statt Abständen. Die Polsterung der Leiste selbst ist 0; die Kopf-Polsterung
 * (`--lfh-kopf-polsterung`) sitzt an der Suchzelle. Auf dem Handschirm bricht die rechte
 * Zellgruppe als GANZES um (LFH-460).
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
 * Topbar-Eintrag: Link wenn frei, sonst gedämpft mit sichtbarem Grund (gesperrt statt versteckt).
 *
 * `grundSichtbar` kommt als PROP herein: die Breitenfrage stellt ausschließlich `useViewport`
 * im Elternteil (`useViewport.guard.test.ts`).
 */
function GlobalLink({
  to,
  label,
  gesperrt,
  grundSichtbar,
  linkStil,
  aktiv = false,
}: {
  to: string;
  label: string;
  gesperrt: boolean;
  grundSichtbar: boolean;
  linkStil: CSSProperties;
  /** Die Person steht in diesem Bereich (LFH-954): `aria-current` und Unterkante, nicht nur Farbe. */
  aktiv?: boolean;
}) {
  const { token } = theme.useToken();
  if (gesperrt) {
    return (
      <Typography.Text
        style={{
          // `rahmenFarben.gesperrt` hält den Boden 4,5 : 1 und bleibt sichtbar schwächer als der
          // freie Link (`gedaempft`). Die Tag-Schwelle gilt für bedienbaren Text, nicht für
          // Gesperrtes (LFH-434); deshalb steht das Schloss daneben.
          color: rahmenFarben.gesperrt,
          fontSize: schriftGroesse('klein'),
          cursor: 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          gap: token.marginSM,
          flexShrink: 0,
        }}
      >
        {/* Die Sperre trägt auf JEDER Breite ein Zeichen ohne Farbe (LFH-434, WCAG 1.4.1):
            `cursor: not-allowed` sieht auf Touch niemand, und der Tag steht erst ab `lg`. */}
        <span aria-hidden="true" data-lfh="sperr-schloss" style={{ display: 'inline-flex' }}>
          <IconSchloss size={13} />
        </span>
        {label}
        {/* Der Grund steht als TEXT da, nicht nur im `title`: auf dem Führungs-Tablet gibt es kein
            Hover. Eigene Farben, weil ein heller Standard-Tag auf dem dunklen Kopfzeilengrund den
            Kontrast verfehlte.

            ERST AB `lg` (LFH-337): der Block kann weder kürzen noch umbrechen (`flexShrink: 0` oben
            muss bleiben, sonst bräche der Tag INNERHALB der Kopfzeile um; antds `Tag` setzt
            `white-space: nowrap`) und sprengte bei 390 px die Kopfzeile. Das Führungs-Tablet liegt
            bei ≥ `lg` und behält seinen Grund. Der gedämpfte Link bleibt auf JEDER Breite stehen:
            „gesperrt statt versteckt" ist die Regel, nicht der Tag. */}
        {grundSichtbar && (
          <Tag
            style={{
              margin: 0,
              color: farbenDunkel.text,
              background: farbenDunkel.flaeche2,
              borderColor: farbenDunkel.linieStark,
            }}
          >
            Keine Berechtigung
          </Tag>
        )}
      </Typography.Text>
    );
  }
  return (
    <Link
      to={to}
      aria-current={aktiv ? 'page' : undefined}
      style={
        aktiv
          ? {
              ...linkStil,
              color: rahmenFarben.text,
              // Unterkante als zweiter Kanal (WCAG 1.4.1). Als Schatten, nicht als Rand: ein Rand
              // machte den Link höher und mit ihm den klebenden Kopf (`--lfh-rahmen-oben`).
              boxShadow: `inset 0 -2px 0 ${rahmenFarben.text}`,
            }
          : linkStil
      }
    >
      {label}
    </Link>
  );
}

/**
 * Ort und Rückweg der Ebene 1 (LFH-954, design.md D5): der Rückweg aus `useEinsatzRueckweg`
 * (LLH-1731 D1), nur auf Seiten mit Ort, also nicht auf der Einsatzliste.
 */
function useEbene1Ort(pathname: string, benutzerId: number | undefined): Ebene1OrtWert | undefined {
  const { ort } = ebene1Seite(pathname);
  const rueckweg = useEinsatzRueckweg(benutzerId, ort != null);
  if (ort == null) return undefined;
  return { ort, rueckweg };
}

export default function AppLayout() {
  const { benutzer } = useAuth();
  const { pathname } = useLocation();
  // Tab-Titel der Ebene 1 (LFH-954): „Fahrzeuge · Verwaltung · lifeline-hub“.
  useDokumentTitel(ebene1Seite(pathname).titel);
  const ebene1Ort = useEbene1Ort(pathname, benutzer?.id);
  // Dieselbe Schwelle wie im Einsatz-Workspace. Sie trägt drei Fragen: ob der Sperrgrund als Tag
  // danebensteht, ob die Suche als Feld oder als Icon steht und ob die Wortmarke Platz hat.
  // Die Frage stellt ausschließlich `useViewport` (`useViewport.guard.test.ts`).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const mittel = abBreite('md');
  const { token } = theme.useToken();
  // Unter `md` rücken die Zellen zusammen: mit der vollen Staffel-Polsterung (18 px je Seite
  // in `komfortabel`) bräche die rechte Zellgruppe auf 390 px in eine dritte Zeile um.
  const zellToken = mittel ? token : { padding: token.paddingXS };
  // Der Kopf bleibt stehen wie im Einsatz-Workspace, in jeder Breite (LFH-952, LLH-1728,
  // `frontend/AGENTS.md`, Rahmen); unter `md` unter der gestörten Betriebszeile (Rang, D2).
  const { ref: kopfRef, oben: kopfOben } = useRahmenObenStapel<HTMLElement>(true, RAHMEN_RANG.kopf);
  // Der Verwaltungs-Link ist ein handgebautes Bedienziel: ZWEI Angaben (LFH-365). Farbe aus der
  // Nachtrolle, weil die Leiste in beiden Modi dunkel ist.
  const linkStil: CSSProperties = {
    color: rahmenFarben.gedaempft,
    fontSize: schriftGroesse('klein'),
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    minHeight: token.controlHeight,
    // Gate 3 misst Höhe UND Breite: ein 12-px-Wort allein fiele in `handschuh` unter 72.
    minWidth: token.controlHeight,
    justifyContent: 'center',
    padding: `${token.paddingXS}px 0`,
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <OrgBenachrichtigungen />
      <Header
        ref={kopfRef}
        data-lfh="rahmen-kopf"
        style={{ ...KOPF_STIL, ...RAHMEN_KLEBT, top: kopfOben }}
      >
        {/* LINKE GRUPPE: Marke, Wortmarke (Link zur Einsatzliste), Verwaltung. */}
        <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minWidth: 0 }}>
          {/* Unter `md` weicht die Wortmarke der Uhr, und die Bildmarke trägt ihren Link zur
              Einsatzliste (LLH-1728, D5): sonst bliebe der Kopf am Handy zweizeilig. */}
          <Markenzelle alsLink={!mittel} />
          <div style={kopfZelleStil(zellToken)}>
            {mittel && (
              <>
                <Wortmarke />
                <span
                  aria-hidden="true"
                  style={{ width: 1, height: 18, flexShrink: 0, background: rahmenFarben.linie }}
                />
              </>
            )}
            <GlobalLink
              to="/admin"
              label="Verwaltung"
              gesperrt={!darfVerwaltung(benutzer)}
              grundSichtbar={breit}
              linkStil={linkStil}
              aktiv={pathname === '/admin' || pathname.startsWith('/admin/')}
            />
            {/* Vorplanung (LLH-1586): nur für wer planen darf, sonst fehlt der Eintrag ganz
                (Abstimmung 08.11.2026, anders als die gesperrt stehende Verwaltung). */}
            {darfPlanen(benutzer) && (
              <GlobalLink
                to={planungenPfad()}
                label="Planungen"
                gesperrt={false}
                grundSichtbar={breit}
                linkStil={linkStil}
                aktiv={pathname === '/planungen' || pathname.startsWith('/planungen/')}
              />
            )}
          </div>
        </div>
        {/* SUCHZELLE ab `lg` — sie trägt die Kopf-Polsterung (`kopfpolsterung.guard.test.ts`).
            Farbschema und Bediendichte wohnen im Benutzermenü: Einstellungen gehören nicht in eine
            Aktionsreihe. */}
        {breit && (
          <div
            data-lfh="kopf-suche"
            style={{
              flex: '1 1 280px',
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              paddingInline: 'var(--lfh-kopf-polsterung)',
            }}
          >
            <CommandPaletteTrigger />
          </div>
        )}
        <KopfRechts>
          {/* Außerhalb eines Einsatzes läuft kein Live-Strom — die SYNC-Zelle erscheint hier
              nur bei Netzverlust oder offener Offline-Queue. */}
          <SyncAnzeige liveErwartet={false} kompakt={!mittel} />
          <Uhr zelle={zellToken} />
          {!breit && (
            <div style={kopfZelleStil(zellToken)}>
              <CommandPaletteTrigger />
            </div>
          )}
          <div
            style={{ ...kopfZelleStil(zellToken, 'keiner'), paddingInlineStart: token.paddingXS }}
          >
            <BenutzerMenu />
          </div>
        </KopfRechts>
      </Header>
      {/* Alarmzone (LLH-1735): Org-Hinweise direkt unter dem Kopf, in jeder Breite; der Org-Rahmen
         hat keine Leiste am Handschirm (design.md D5). */}
      <AlarmZone />
      {/* Ziel des Sprunglinks zum Inhalt (nufmon70 D2); die Verwaltung schachtelt ihres hinein. */}
      <Content {...sprungzielInhalt} style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
        <Ebene1OrtProvider value={ebene1Ort}>
          <Outlet />
        </Ebene1OrtProvider>
      </Content>
    </Layout>
  );
}
