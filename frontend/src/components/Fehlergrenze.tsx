import { Button } from 'antd';
import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useRouteError } from 'react-router';
import { meldeClientFehler } from '../api/clientFehler';
import { useUeberblickRueckweg } from '../einsatz/useUeberblickRueckweg';
import { redirectZiel } from '../einsatz/modulRegistry';
import {
  einsaetzePfad,
  einsatzModulPfad,
  GERAET_START_PFAD,
  parseRouteId,
} from '../routing/deeplinks';
import { flaeche } from '../theme/tokens';
import Paneel from './instrument/Paneel';
import { schriftStil, useRollen } from './instrument/rollenwerte';

/**
 * Fehlergrenze je Rahmen (LLH-1822, Change `a12ms7g9-seitenzustaende`, D1/D2; Spec
 * `seiten-zustaende`, „Fehlergrenze je Rahmen“ und „Letztes Netz an der Wurzel“). Das
 * `errorElement` einer pfadlosen Route unter jedem Rahmen (`App.tsx`): Wirft eine Seite beim
 * Zeichnen oder beim Laden ihres Codes, zeichnet der Router dies hier im `<Outlet/>` des Rahmens.
 * Kopf, Rail und Menü bleiben stehen, beim nächsten Ortswechsel räumt der Router den Fehler ab.
 *
 * Form der `SeitenSackgasse` (Paneel mit Kante in `alarm`, denn hier ist etwas gescheitert), aber
 * ohne `ursache`-Zeile: Meldung und Stack des Wurfs stehen NIE im DOM, sie gehen nur an den Server
 * (`meldeClientFehler`, einmal je Fehlerobjekt, auch unter StrictMode). Genau zwei Auswege:
 * „Neu laden“ (holt auch einen neuen Chunk nach einem Update) und ein sicherer Ort des Rahmens.
 *
 * `wurzel` ist das letzte Netz an der obersten Route: Dort fehlen `AuthProvider` und alle
 * Rahmen-Kontexte, deshalb eine ganze Seite ohne Sitzung und ohne Router-Sprung; beide Auswege
 * laden die Seite neu (Theme und `AntApp` liegen außerhalb des Routers, `main.tsx`).
 */
export type FehlergrenzeRahmen = 'einsatz' | 'ebene1' | 'verwaltung' | 'geraet' | 'wurzel';

export const FEHLERGRENZE_TITEL = 'Diese Seite konnte nicht angezeigt werden';

interface FehlergrenzeProps {
  rahmen: FehlergrenzeRahmen;
}

export default function Fehlergrenze({ rahmen }: FehlergrenzeProps) {
  const fehler = useRouteError();
  const { pathname } = useLocation();
  useEffect(() => {
    void meldeClientFehler(fehler, pathname);
  }, [fehler, pathname]);

  const paneel = (
    <FehlerPaneel
      satz={
        rahmen === 'einsatz'
          ? 'Der Fehler wurde gemeldet. Die anderen Module arbeiten weiter.'
          : 'Der Fehler wurde gemeldet.'
      }
      ausweg={<ZweiterAusweg rahmen={rahmen} />}
    />
  );
  if (rahmen !== 'wurzel') return paneel;
  return <WurzelSeite>{paneel}</WurzelSeite>;
}

function FehlerPaneel({ satz, ausweg }: { satz: string; ausweg: ReactNode }) {
  const { token: t, rollen } = useRollen();
  return (
    <Paneel
      titel="Fehler"
      koerperPolster
      style={{
        maxWidth: flaeche.seiteSchmal,
        marginInline: 'auto',
        marginBlockStart: t.marginLG,
        // Die Kante trägt „gescheitert“ zusätzlich zum Wortlaut (WCAG 1.4.1); die Knöpfe bleiben
        // blau, Rot bedient nichts (wie `SeitenSackgasse`).
        boxShadow: `inset 3px 0 0 0 ${rollen.alarm}`,
      }}
    >
      <div
        data-lfh="fehlergrenze"
        style={{ display: 'flex', flexDirection: 'column', gap: t.marginSM }}
      >
        <div style={{ ...schriftStil('seitentitel'), color: rollen.text }}>
          {FEHLERGRENZE_TITEL}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            color: rollen.text2,
          }}
        >
          {satz}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.marginSM }}>
          <Button type="primary" onClick={() => window.location.reload()}>
            Neu laden
          </Button>
          {ausweg}
        </div>
      </div>
    </Paneel>
  );
}

function ZweiterAusweg({ rahmen }: FehlergrenzeProps) {
  switch (rahmen) {
    case 'einsatz':
      return <ZumUeberblick />;
    case 'ebene1':
    case 'verwaltung':
      return <RouterAusweg label="Zur Einsatzliste" pfad={einsaetzePfad()} />;
    case 'geraet':
      // Die Startseite der Ansicht kennt `GeraetStart` (Index unter `/geraet`), ohne dass die
      // Grenze die Ansicht des Geräts lesen muss.
      return <RouterAusweg label="Zur Startseite" pfad={GERAET_START_PFAD} />;
    case 'wurzel':
      // Ohne Router-Sprung: der Rahmen selbst ist gescheitert, ein frischer Seitenaufbau baut ihn
      // neu auf.
      return (
        <Button onClick={() => window.location.assign(einsaetzePfad())}>Zur Einsatzliste</Button>
      );
  }
}

function RouterAusweg({ label, pfad }: { label: string; pfad: string }) {
  const navigate = useNavigate();
  return <Button onClick={() => void navigate(pfad)}>{label}</Button>;
}

/**
 * „Zum Überblick“ im Einsatz: der Überblick, ist er gesperrt, das erste freie Modul
 * (`useUeberblickRueckweg`, geteilt mit `SeiteNichtGefunden`). Die Beschriftung bleibt fest, auch
 * wenn das Ziel ein anderes Modul ist (D2). Der Knopf steht sofort: das Ziel wird beim Klick
 * gewählt, bis dahin sind die Freigaben des Rahmens längst da; ohne sie der feste Einstieg.
 */
function ZumUeberblick() {
  const einsatzId = parseRouteId(useParams().id);
  const zielRoute = useUeberblickRueckweg(einsatzId);
  const navigate = useNavigate();
  return (
    <Button
      onClick={() =>
        void navigate(
          einsatzId === null
            ? einsaetzePfad()
            : einsatzModulPfad(einsatzId, zielRoute ?? redirectZiel()),
        )
      }
    >
      Zum Überblick
    </Button>
  );
}

function WurzelSeite({ children }: { children: ReactNode }) {
  const { rollen } = useRollen();
  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 'var(--lfh-seiten-polsterung)',
        background: rollen.grund,
        color: rollen.text,
      }}
    >
      {children}
    </main>
  );
}
