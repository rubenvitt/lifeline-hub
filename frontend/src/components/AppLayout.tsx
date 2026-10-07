import { IconSchloss } from '../icons';
import { Layout, Tag, Typography, theme } from 'antd';
import { useMemo, type CSSProperties } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { leseLetztenOrt } from '../einsatz/letzterOrt';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';
import BenutzerMenu from './BenutzerMenu';
import { RAHMEN_KLEBT, useRahmenObenQuelle } from './rahmenOben';
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
import { Ebene1OrtProvider, type Ebene1OrtWert } from './Ebene1OrtKontext';

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
  if (gesperrt) {
    return (
      <Typography.Text
        style={{
          // `rahmenFarben.gesperrt` hält den Boden 4,5 : 1 und bleibt sichtbar schwächer als der
          // freie Link (`gedaempft`). Die Tag-Schwelle gilt für bedienbaren Text, nicht für
          // Gesperrtes (LFH-434); deshalb steht das Schloss daneben.
          color: rahmenFarben.gesperrt,
          fontSize: 12,
          cursor: 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
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
 * Ort und Rückweg der Ebene 1 (LFH-954, design.md D5): der Rückweg nur, wenn der zuletzt offene
 * Einsatz der Person in der Liste steht und aktiv ist; der Name kommt aus der Liste, nicht aus dem
 * Speicher. Abgerufen wird die Liste nur auf Profil und Verwaltung (derselbe Key wie im Wechsler).
 */
function useEbene1Ort(pathname: string, benutzerId: number | undefined): Ebene1OrtWert | undefined {
  const { ort } = ebene1Seite(pathname);
  // Je Adresse neu gelesen: die Person kann zwischendurch in einem anderen Tab im Einsatz sein.
  const letzter = useMemo(
    () =>
      benutzerId == null || ebene1Seite(pathname).ort == null ? null : leseLetztenOrt(benutzerId),
    [benutzerId, pathname],
  );
  const { data: einsaetze } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
    enabled: letzter != null,
  });
  if (ort == null) return undefined;
  const einsatz = letzter && einsaetze?.find((e) => e.id === letzter.einsatzId);
  return {
    ort,
    rueckweg:
      letzter && einsatz && einsatz.status === 'aktiv'
        ? { label: `Zurück zu ${einsatz.bezeichnung}`, pfad: letzter.pfad }
        : undefined,
  };
}

export default function AppLayout() {
  const { benutzer } = useAuth();
  const { pathname } = useLocation();
  // Tab-Titel der Ebene 1 (LFH-954): „Fahrzeuge · Verwaltung · lifeline-hub“.
  useDokumentTitel(ebene1Seite(pathname).titel);
  const ebene1Ort = useEbene1Ort(pathname, benutzer?.id);
  // Dieselbe Schwelle wie im Einsatz-Workspace. Sie trägt drei Fragen: ob der Sperrgrund als Tag
  // danebensteht, ob die Suche als Feld oder als Icon steht, und (ab `md`) ob die Uhr Platz hat.
  // Die Frage stellt ausschließlich `useViewport` (`useViewport.guard.test.ts`).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const mittel = abBreite('md');
  // Wie im Einsatz-Kopf: unter `xl` steht der Ruhezustand der SYNC-Anzeige nur als Icon.
  const weit = abBreite('xl');
  const { token } = theme.useToken();
  // Unter `md` rücken die Zellen zusammen: mit der vollen Staffel-Polsterung (18 px je Seite
  // in `komfortabel`) bräche die rechte Zellgruppe auf 390 px in eine dritte Zeile um.
  const zellToken = mittel ? token : { padding: token.paddingXS };
  // Ab `md` bleibt der Kopf stehen wie im Einsatz-Workspace (LFH-952, `frontend/AGENTS.md`, Rahmen).
  const kopfRef = useRahmenObenQuelle<HTMLElement>(mittel);
  // Der Verwaltungs-Link ist ein handgebautes Bedienziel: ZWEI Angaben (LFH-365). Farbe aus der
  // Nachtrolle, weil die Leiste in beiden Modi dunkel ist.
  const linkStil: CSSProperties = {
    color: rahmenFarben.gedaempft,
    fontSize: 12,
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
      <Header
        ref={kopfRef}
        data-lfh="rahmen-kopf"
        style={mittel ? { ...KOPF_STIL, ...RAHMEN_KLEBT } : KOPF_STIL}
      >
        {/* LINKE GRUPPE: Marke, Wortmarke (Link zur Einsatzliste), Verwaltung. */}
        <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minWidth: 0 }}>
          <Markenzelle />
          <div style={kopfZelleStil(zellToken)}>
            <Wortmarke />
            <span
              aria-hidden="true"
              style={{ width: 1, height: 18, flexShrink: 0, background: rahmenFarben.linie }}
            />
            <GlobalLink
              to="/admin"
              label="Verwaltung"
              gesperrt={!darfVerwaltung(benutzer)}
              grundSichtbar={breit}
              linkStil={linkStil}
              aktiv={pathname === '/admin' || pathname.startsWith('/admin/')}
            />
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
          <SyncAnzeige liveErwartet={false} kompakt={!mittel} ruheOhneWort={!weit} />
          {mittel && <Uhr />}
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
      <Content style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
        <Ebene1OrtProvider value={ebene1Ort}>
          <Outlet />
        </Ebene1OrtProvider>
      </Content>
    </Layout>
  );
}
