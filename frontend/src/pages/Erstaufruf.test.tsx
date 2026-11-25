import { http } from 'msw';
import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { modulName } from '../einsatz/modulRegistry';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { benutzerFixture } from '../test/fixtures';
import AuftraegePage from './AuftraegePage';
import BetreuungPage from './BetreuungPage';
import BetreuungsstelleDetailPage from './BetreuungsstelleDetailPage';
import DokumentePage from './DokumentePage';
import EinheitAusVorlagePage from './EinheitAusVorlagePage';
import EinheitDetailPage from './EinheitDetailPage';
import EinheitenPage from './EinheitenPage';
import EinsatzabschnittePage from './EinsatzabschnittePage';
import EinsatzdatenPage from './EinsatzdatenPage';
import EinsatzEinstellungenPage from './EinsatzEinstellungenPage';
import EinsatzkraftPage from './EinsatzkraftPage';
import EvakuierungPage from './EvakuierungPage';
import EvakuierungsbezirkPage from './EvakuierungsbezirkPage';
import FahrzeugePage from './FahrzeugePage';
import FunkplanPage from './FunkplanPage';
import InfotelefonPage from './InfotelefonPage';
import KommunikationsplanPage from './KommunikationsplanPage';
import LageberichtePage from './LageberichtePage';
import LagebesprechungPage from './LagebesprechungPage';
import LagekartePage from './LagekartePage';
import MaterialPage from './MaterialPage';
import PersonalPage from './PersonalPage';
import SchaedenPage from './SchaedenPage';
import TierePage from './TierePage';
import UnfallhilfsstellenPage from './UnfallhilfsstellenPage';
import UnterkunftPlanenPage from './UnterkunftPlanenPage';
import BereitstellungsraeumePage from './bereitstellungsraum/BereitstellungsraeumePage';
import AufnahmePage from './personen/AufnahmePage';

/** Die echte Karte braucht WebGL; das Gerippe steht vor ihr, also genügt ein leerer Platzhalter. */
vi.mock('./lagekarte/Kartenflaeche', () => ({ default: () => null }));

/**
 * Erstaufruf mit langsamem Server (LLH-2005, Regel: `frontend/AGENTS.md`, „Modulwechsel zeigt
 * sofort Kopf und Gerippe“): Solange der Einsatz lädt, steht schon der Seitenkopf mit dem
 * Modulnamen, nie ein nacktes Gerippe. Meldebild, ETB und Betroffene belegen das in ihren eigenen
 * Tests (LLH-1830). Detailseiten zeigen bis dahin den Namen ihres Moduls; ihr eigener Titel kommt
 * mit den Daten in dieselbe Zeile.
 */
const FAELLE: {
  seite: string;
  muster: string;
  pfad: string;
  modul: string;
  element: ReactElement;
}[] = [
  {
    seite: 'Aufträge',
    muster: 'auftraege',
    pfad: 'auftraege',
    modul: 'auftraege',
    element: <AuftraegePage />,
  },
  {
    seite: 'Betreuung',
    muster: 'betreuung',
    pfad: 'betreuung',
    modul: 'betreuung',
    element: <BetreuungPage />,
  },
  {
    seite: 'Dokumente',
    muster: 'dokumente',
    pfad: 'dokumente',
    modul: 'dokumente',
    element: <DokumentePage />,
  },
  {
    seite: 'Einheiten',
    muster: 'einheiten',
    pfad: 'einheiten',
    modul: 'einheiten',
    element: <EinheitenPage />,
  },
  {
    seite: 'Einsatzabschnitte',
    muster: 'einsatzabschnitte',
    pfad: 'einsatzabschnitte',
    modul: 'einsatzabschnitte',
    element: <EinsatzabschnittePage />,
  },
  {
    seite: 'Einsatzdaten',
    muster: 'einsatzdaten',
    pfad: 'einsatzdaten',
    modul: 'einsatzdaten',
    element: <EinsatzdatenPage />,
  },
  {
    seite: 'Evakuierung',
    muster: 'evakuierung',
    pfad: 'evakuierung',
    modul: 'evakuierung',
    element: <EvakuierungPage />,
  },
  {
    seite: 'Fahrzeuge',
    muster: 'fahrzeuge',
    pfad: 'fahrzeuge',
    modul: 'fahrzeuge',
    element: <FahrzeugePage />,
  },
  {
    seite: 'Funkplan',
    muster: 'fernmeldewesen',
    pfad: 'fernmeldewesen',
    modul: 'fernmeldewesen',
    element: <FunkplanPage />,
  },
  {
    seite: 'Infotelefon',
    muster: 'infotelefon',
    pfad: 'infotelefon',
    modul: 'infotelefon',
    element: <InfotelefonPage />,
  },
  {
    seite: 'Kommunikationsplan',
    muster: 'fernmeldewesen/kommunikationsplan',
    pfad: 'fernmeldewesen/kommunikationsplan',
    modul: 'fernmeldewesen',
    element: <KommunikationsplanPage />,
  },
  {
    seite: 'Lageberichte',
    muster: 'lageberichte',
    pfad: 'lageberichte',
    modul: 'lageberichte',
    element: <LageberichtePage />,
  },
  {
    seite: 'Lagebesprechung',
    muster: 'lagebesprechung',
    pfad: 'lagebesprechung',
    modul: 'lagebesprechung',
    element: <LagebesprechungPage />,
  },
  {
    seite: 'Lagekarte',
    muster: 'lagekarte',
    pfad: 'lagekarte',
    modul: 'lagekarte',
    element: <LagekartePage />,
  },
  {
    seite: 'Material',
    muster: 'material',
    pfad: 'material',
    modul: 'material',
    element: <MaterialPage />,
  },
  {
    seite: 'Personal',
    muster: 'personal',
    pfad: 'personal',
    modul: 'personal',
    element: <PersonalPage />,
  },
  {
    seite: 'Schäden',
    muster: 'schaeden',
    pfad: 'schaeden',
    modul: 'schaeden',
    element: <SchaedenPage />,
  },
  { seite: 'Tiere', muster: 'tiere', pfad: 'tiere', modul: 'tiere', element: <TierePage /> },
  {
    seite: 'Unfallhilfsstellen',
    muster: 'unfallhilfsstellen/liste',
    pfad: 'unfallhilfsstellen/liste',
    modul: 'unfallhilfsstellen',
    element: <UnfallhilfsstellenPage />,
  },
  {
    seite: 'Bereitstellungsräume',
    muster: 'bereitstellungsraeume/liste',
    pfad: 'bereitstellungsraeume/liste',
    modul: 'bereitstellungsraeume',
    element: <BereitstellungsraeumePage />,
  },
  {
    seite: 'Einsatz-Einstellungen',
    muster: 'einstellungen/*',
    pfad: 'einstellungen/allgemein',
    modul: 'einsatz-einstellungen',
    element: <EinsatzEinstellungenPage />,
  },
  {
    seite: 'Einheit (Detail)',
    muster: 'einheiten/:einheitId',
    pfad: 'einheiten/5',
    modul: 'einheiten',
    element: <EinheitDetailPage />,
  },
  {
    seite: 'Einheit aus Vorlage',
    muster: 'einheiten/aus-vorlage/:vorlageId',
    pfad: 'einheiten/aus-vorlage/5',
    modul: 'einheiten',
    element: <EinheitAusVorlagePage />,
  },
  {
    seite: 'Einsatzkraft',
    muster: 'personal/:epId',
    pfad: 'personal/5',
    modul: 'personal',
    element: <EinsatzkraftPage />,
  },
  {
    seite: 'Evakuierungsbezirk',
    muster: 'evakuierung/:bezirkId',
    pfad: 'evakuierung/5',
    modul: 'evakuierung',
    element: <EvakuierungsbezirkPage />,
  },
  {
    seite: 'Betreuungsstelle',
    muster: 'betreuung/:stelleId',
    pfad: 'betreuung/5',
    modul: 'betreuung',
    element: <BetreuungsstelleDetailPage />,
  },
  {
    seite: 'Unterkunft planen',
    muster: 'betreuung/:stelleId/unterkunft',
    pfad: 'betreuung/5/unterkunft',
    modul: 'betreuung',
    element: <UnterkunftPlanenPage />,
  },
  {
    seite: 'Aufnahme',
    muster: 'personen/aufnahme',
    pfad: 'personen/aufnahme',
    modul: 'personen',
    element: <AufnahmePage />,
  },
];

describe('Erstaufruf mit langsamem Server (LLH-2005)', () => {
  it.each(FAELLE)(
    '$seite zeigt, solange der Einsatz lädt, schon den Seitenkopf mit Modulnamen',
    async ({ muster, pfad, modul, element }) => {
      const nieAntworten = () => new Promise<never>(() => {});
      server.use(
        meHandler(benutzerFixture()),
        http.get('/api/incidents/:id', nieAntworten),
        http.get('/api/incidents/:id/*', nieAntworten),
      );
      renderMitProviders(
        <Routes>
          <Route path={`/einsaetze/:id/${muster}`} element={element} />
        </Routes>,
        { route: `/einsaetze/1/${pfad}`, datenRouter: true },
      );
      const gerippe = await screen.findByTestId('modul-gerippe');
      expect(
        within(gerippe).getByRole('heading', { level: 1, name: modulName(modul) }),
      ).toBeInTheDocument();
    },
  );
});
