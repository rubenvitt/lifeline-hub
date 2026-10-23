import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from 'antd';
import { useState } from 'react';
import { Link, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { InlineAngabe } from './InlineAngabe';
import {
  OffeneBearbeitungProvider,
  sperrGrundOffeneBearbeitung,
  useOffeneBearbeitung,
  useOffeneBearbeitungBelegung,
  useOffeneBearbeitungGrund,
} from './offeneBearbeitung';

/**
 * Merker „offene Bearbeitung“ (LLH-1103, Change `f8218h1i-personendaten-feldweise`, design.md D4;
 * Spec `formularseiten`, „Rückfrage vor dem Verlassen“, Szenario „Offenes Einzelfeld in einer
 * Ansicht“, und `personendaten-bearbeiten`, „Eine offene Bearbeitung zur Zeit“).
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - Provider meldet dem Verlassen-Schutz keine Änderung (`geaendert()` entfernt): rot in
 *   „Rückfrage bei Entwurf“ und „Verwerfen wechselt“.
 * - Sperrgrund auch für den Halter selbst (Vergleich der Kennung entfernt): rot in „zweites Feld
 *   gesperrt“ (der Halter könnte nicht mehr speichern).
 * - Abmelden ohne Freigabe des Schutzes (`gespeichert(fassung())` entfernt): rot in „nach dem
 *   Speichern frei“.
 * - Abmelden beim Aushängen des Hooks entfernt: rot in „meldet beim Aushängen selbst ab“ (über
 *   `InlineAngabe` deckt deren eigenes Abmelden es zu, siehe „ein ausgehängtes Feld …“).
 */
function Angabe({ etikett, start = '' }: { etikett: string; start?: string }) {
  const [wert, setWert] = useState(start);
  const bearbeitung = useOffeneBearbeitung(etikett);
  return (
    <InlineAngabe<string>
      etikett={etikett}
      wert={wert}
      anzeige={wert}
      leer={(w) => w.trim() === ''}
      darfSchreiben
      onSpeichern={async (w) => setWert(w)}
      eingabe={({ feld, value, onChange }) => (
        <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {...bearbeitung}
    />
  );
}

function Seite({ mitVorname = true }: { mitVorname?: boolean }) {
  return (
    <Routes>
      <Route
        path="/person"
        element={
          <OffeneBearbeitungProvider>
            <Angabe etikett="Name" />
            {mitVorname && <Angabe etikett="Vorname" start="Erika" />}
            <Link to="/liste">Betroffene</Link>
          </OffeneBearbeitungProvider>
        }
      />
      <Route path="/liste" element={<div>LISTE</div>} />
    </Routes>
  );
}

function rendern(ui = <Seite />) {
  return renderMitProviders(ui, { route: '/person', datenRouter: true });
}

const NAME_SPERRT = 'Erst „Name“ speichern oder abbrechen';

describe('offene Bearbeitung · Rückfrage beim Verlassen', () => {
  it('Rückfrage bei Entwurf: „Bleiben“ behält die Eingabe', async () => {
    const user = userEvent.setup();
    rendern();
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mül');
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));

    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await user.click(screen.getByRole('button', { name: 'Bleiben' }));
    expect(screen.queryByText('LISTE')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mül');
  });

  it('Verwerfen wechselt', async () => {
    const user = userEvent.setup();
    rendern();
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mül');
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('keine Rückfrage ohne Änderung, auch bei offenem Feld', async () => {
    const user = userEvent.setup();
    rendern();
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nach dem Speichern frei: keine Rückfrage, das andere Feld wieder bedienbar', async () => {
    const user = userEvent.setup();
    rendern();
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Müller{Enter}');
    expect(await screen.findByRole('button', { name: 'Name bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeEnabled();
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Schließen oder Neuladen des Tabs warnt nur mit Entwurf', async () => {
    const user = userEvent.setup();
    rendern();
    const abfahrt = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    expect(abfahrt()).toBe(false);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'M');
    expect(abfahrt()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Bearbeitung von Name abbrechen' }));
    expect(abfahrt()).toBe(false);
  });

  it('ein ausgehängtes Feld gibt die Seite frei', async () => {
    const user = userEvent.setup();
    const { rerender } = rendern();
    await user.click(screen.getByRole('button', { name: 'Vorname bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Vorname' }), 'x');
    expect(screen.getByRole('button', { name: 'Name eintragen' })).toBeDisabled();
    rerender(<Seite mitVorname={false} />);
    expect(screen.getByRole('button', { name: 'Name eintragen' })).toBeEnabled();
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });
});

/** Ein Feld, das sich ohne `InlineAngabe` anmeldet: deren eigenes Abmelden beim Aushängen fehlt. */
function RohesFeld() {
  const { onEntwurf } = useOffeneBearbeitung('Notiz');
  return (
    <button type="button" onClick={() => onEntwurf(true)}>
      Notiz ändern
    </button>
  );
}

describe('offene Bearbeitung · Abmelden des Hooks', () => {
  it('der Hook meldet beim Aushängen selbst ab, auch ohne InlineAngabe', async () => {
    const user = userEvent.setup();
    const Rahmen = ({ mitNotiz }: { mitNotiz: boolean }) => (
      <OffeneBearbeitungProvider>
        <Angabe etikett="Name" />
        {mitNotiz && <RohesFeld />}
      </OffeneBearbeitungProvider>
    );
    const { rerender } = renderMitProviders(<Rahmen mitNotiz />, { datenRouter: true });
    await user.click(screen.getByRole('button', { name: 'Notiz ändern' }));
    expect(screen.getByRole('button', { name: 'Name eintragen' })).toBeDisabled();
    rerender(<Rahmen mitNotiz={false} />);
    expect(screen.getByRole('button', { name: 'Name eintragen' })).toBeEnabled();
  });
});

describe('offene Bearbeitung · eine zur Zeit', () => {
  it('zweites Feld gesperrt, mit Grund; nach dem Abbrechen wieder frei', async () => {
    const user = userEvent.setup();
    rendern();
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mül');

    const vorname = screen.getByRole('button', { name: 'Vorname bearbeiten' });
    expect(vorname).toBeDisabled();
    expect(screen.getByText(NAME_SPERRT)).toBeVisible();
    expect(vorname).toHaveAccessibleDescription(`Erika ${NAME_SPERRT}`);
    // Der Halter selbst bleibt bedienbar.
    expect(screen.getByRole('button', { name: 'Name speichern' })).toBeEnabled();
    expect(screen.queryByText('Erst „Vorname“ speichern oder abbrechen')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Bearbeitung von Name abbrechen' }));
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeEnabled();
    expect(screen.queryByText(NAME_SPERRT)).toBeNull();
  });

  it('ein offenes, unverändertes zweites Feld schließt, sobald das erste einen Entwurf hat', async () => {
    const user = userEvent.setup();
    rendern();
    await user.click(screen.getByRole('button', { name: 'Vorname bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    expect(screen.getByRole('textbox', { name: 'Vorname' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'M');
    expect(screen.queryByRole('textbox', { name: 'Vorname' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeDisabled();
  });

  it('der Grund der Seite steht für eine Zeile am Abschnittskopf bereit', async () => {
    function Kopf() {
      return <div data-testid="kopf">{useOffeneBearbeitungGrund() ?? 'frei'}</div>;
    }
    const user = userEvent.setup();
    renderMitProviders(
      <OffeneBearbeitungProvider>
        <Kopf />
        <Angabe etikett="Name" />
      </OffeneBearbeitungProvider>,
      { datenRouter: true },
    );
    expect(screen.getByTestId('kopf')).toHaveTextContent('frei');
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'M');
    expect(screen.getByTestId('kopf')).toHaveTextContent(NAME_SPERRT);
  });

  it('Wortlaut des Sperrgrunds', () => {
    expect(sperrGrundOffeneBearbeitung('Herkunft / Adresse')).toBe(
      'Erst „Herkunft / Adresse“ speichern oder abbrechen',
    );
  });
});

describe('offene Bearbeitung · ohne Seitenkontext', () => {
  it('der Hook sperrt nichts und meldet ins Leere (Lesefassung, Vorschau)', () => {
    const { result } = renderHook(() => useOffeneBearbeitung('Name'));
    expect(result.current.gesperrt).toBeUndefined();
    expect(() => act(() => result.current.onEntwurf(true))).not.toThrow();
    expect(result.current.gesperrt).toBeUndefined();
  });

  it('ohne Schreibrecht (`aktiv: false`) keine Rückfrage', async () => {
    const user = userEvent.setup();
    renderMitProviders(
      <Routes>
        <Route
          path="/person"
          element={
            <OffeneBearbeitungProvider aktiv={false}>
              <Angabe etikett="Name" />
              <Link to="/liste">Betroffene</Link>
            </OffeneBearbeitungProvider>
          }
        />
        <Route path="/liste" element={<div>LISTE</div>} />
      </Routes>,
      { route: '/person', datenRouter: true },
    );
    await user.click(screen.getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'M');
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/**
 * Belegung durch ein Paneel (LLH-1139, Spec `formularseiten`, „Eine offene Bearbeitung je
 * Ansicht“): ein offenes Paneel sperrt die übrigen sofort, die Rückfrage kommt erst mit einer
 * Änderung.
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - „offen“ wie „geändert“ behandelt (Verlassen-Schutz bei jeder Belegung): rot in „offen ohne
 *   Änderung sperrt, fragt aber nicht“.
 * - Rückfrage immer eingehängt statt nur bei Belegung: rot in „ohne Belegung kein Data Router
 *   nötig“ (`useBlocker` wirft im `MemoryRouter`).
 */
function PaneelAttrappe({ etikett }: { etikett: string }) {
  const { gesperrt, melde } = useOffeneBearbeitungBelegung(etikett);
  return (
    <div>
      <button type="button" disabled={gesperrt != null} onClick={() => melde('offen')}>
        {etikett} öffnen
      </button>
      <button type="button" onClick={() => melde('geaendert')}>
        {etikett} ändern
      </button>
      <button type="button" onClick={() => melde('zu')}>
        {etikett} schließen
      </button>
      {gesperrt && <span>{gesperrt}</span>}
    </div>
  );
}

function PaneelSeite() {
  return (
    <Routes>
      <Route
        path="/ansicht"
        element={
          <OffeneBearbeitungProvider>
            <PaneelAttrappe etikett="Funk" />
            <PaneelAttrappe etikett="Telefon" />
            <Angabe etikett="Name" />
            <Link to="/liste">Liste</Link>
          </OffeneBearbeitungProvider>
        }
      />
      <Route path="/liste" element={<div>LISTE</div>} />
    </Routes>
  );
}

describe('offene Bearbeitung · Belegung durch ein Paneel', () => {
  it('offen ohne Änderung sperrt die übrigen sofort, fragt beim Verlassen aber nicht', async () => {
    const user = userEvent.setup();
    renderMitProviders(<PaneelSeite />, { route: '/ansicht', datenRouter: true });
    await user.click(screen.getByRole('button', { name: 'Funk öffnen' }));
    expect(screen.getByRole('button', { name: 'Telefon öffnen' })).toBeDisabled();
    // Grund am gesperrten Paneel und am gesperrten Einzelfeld.
    expect(screen.getAllByText('Erst „Funk“ speichern oder abbrechen')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Name eintragen' })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: 'Liste' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('geändert fragt beim Verlassen; geschlossen gibt die Seite frei', async () => {
    const user = userEvent.setup();
    renderMitProviders(<PaneelSeite />, { route: '/ansicht', datenRouter: true });
    await user.click(screen.getByRole('button', { name: 'Funk öffnen' }));
    await user.click(screen.getByRole('button', { name: 'Funk ändern' }));
    await user.click(screen.getByRole('link', { name: 'Liste' }));
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await user.click(screen.getByRole('button', { name: 'Bleiben' }));
    await user.click(screen.getByRole('button', { name: 'Funk schließen' }));
    expect(screen.getByRole('button', { name: 'Telefon öffnen' })).toBeEnabled();
    await user.click(screen.getByRole('link', { name: 'Liste' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('ohne Belegung kein Data Router nötig (die Rückfrage hängt erst mit Belegung ein)', () => {
    expect(() =>
      renderMitProviders(
        <OffeneBearbeitungProvider>
          <PaneelAttrappe etikett="Funk" />
        </OffeneBearbeitungProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: 'Funk öffnen' })).toBeEnabled();
  });
});
