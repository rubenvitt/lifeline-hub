import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite } from '../../test/viewport';
import { kategorien } from '../../einsatz/modulRegistry';
import ModulEinstellungsListe, { modulZeilenStil } from './ModulEinstellungsListe';

/** Basis-Props der Einsatz-Ebene (drei Spalten, mit Sichtbar-Schalter). */
function einsatzProps() {
  return {
    rollenSpalte: 'Benötigte Rolle',
    darfVerwalten: true,
    rolleVon: () => '',
    aufRolle: vi.fn(),
    sichtbarSpalte: {
      titel: 'Sichtbar',
      sichtbarVon: () => true,
      aufSichtbar: vi.fn(),
    },
  };
}

describe('ModulEinstellungsListe', () => {
  it('rendert mit Sichtbar-Spalte einen Switch je Modul', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    expect(screen.getByText('Sichtbar')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeInTheDocument();
  });

  it('rendert ohne Sichtbar-Spalte gar keinen Switch (Org-Ebene kennt nur die Rolle)', () => {
    renderMitProviders(
      <ModulEinstellungsListe
        {...einsatzProps()}
        sichtbarSpalte={undefined}
        rollenSpalte="Benötigte Rolle (Default)"
      />,
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Benötigte Rolle (Default)')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeInTheDocument();
  });

  it('meldet den Sichtbar-Schalter mit Modul-Key und neuem Zustand', async () => {
    const props = einsatzProps();
    renderMitProviders(<ModulEinstellungsListe {...props} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Sichtbar: ETB' }));

    await waitFor(() =>
      expect(props.sichtbarSpalte.aufSichtbar).toHaveBeenCalledWith('etb', false),
    );
  });

  it('meldet die gewählte Rolle mit Modul-Key', async () => {
    const props = einsatzProps();
    renderMitProviders(<ModulEinstellungsListe {...props} />);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' }));
    fireEvent.click(await screen.findByText('Admin'));

    await waitFor(() => expect(props.aufRolle).toHaveBeenCalledWith('etb', 'admin'));
  });

  it('sperrt nicht-ausblendbare Module auch bei Verwaltungsrecht', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    // 'einsatzdaten'/'einsatz-einstellungen' sind NICHT_AUSBLENDBARE_MODULE.
    expect(screen.getByRole('switch', { name: 'Sichtbar: Einsatzdaten' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Einsatzdaten' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).not.toBeDisabled();
  });

  it('sperrt alles ohne Verwaltungsrecht', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} />);
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeDisabled();
  });

  it('zeigt den Org-Erb-Hinweis unter dem Select, wenn einer geliefert wird', () => {
    renderMitProviders(
      <ModulEinstellungsListe
        {...einsatzProps()}
        hinweisVon={(key) => (key === 'etb' ? 'Org: Führungskraft' : undefined)}
      />,
    );

    expect(screen.getByText('Org: Führungskraft')).toBeInTheDocument();
  });

  it('zeigt den aktuellen Wert je Modul an (Rolle und Sichtbarkeit kommen von außen)', () => {
    renderMitProviders(
      <ModulEinstellungsListe
        {...einsatzProps()}
        rolleVon={(key) => (key === 'etb' ? 'fuehrungskraft' : '')}
        sichtbarSpalte={{
          titel: 'Sichtbar',
          sichtbarVon: (key) => key !== 'etb',
          aufSichtbar: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).not.toBeChecked();
    expect(screen.getByTitle('Führungskraft')).toBeInTheDocument();
  });
});

/**
 * Zeilensperre und Fehlermarke je Zeile (LFH-345 · C10, Befunde H15/H14).
 *
 * Der Bestand sperrte bei JEDER laufenden Mutation ALLE 50 Steuerelemente. Wer eine Rolle
 * umstellte, konnte für die Dauer des PUT nirgends sonst etwas anfassen — und der Fehler
 * meldete sich nur als Toast, der die betroffene Zeile nicht benannte.
 */
describe('ModulEinstellungsListe · Zeilenzustand (LFH-345)', () => {
  it('sperrt NUR die gerade mutierende Zeile, nicht die ganze Liste', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} laeuftKey="etb" />);

    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Sichtbar: Chat' })).not.toBeDisabled();
  });

  it('markiert NUR die fehlgeschlagene Zeile', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} fehlerKey="etb" />);

    const markiert = document.querySelectorAll('[data-modul-zeile][data-fehler="true"]');
    expect(markiert).toHaveLength(1);
    expect(markiert[0].getAttribute('data-modul-zeile')).toBe('etb');
  });

  // Die Gegenaussage: ohne sie waere eine Liste, die JEDE Zeile markiert, ebenfalls gruen.
  it('markiert ohne Fehler gar keine Zeile', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    expect(document.querySelectorAll('[data-modul-zeile][data-fehler="true"]')).toHaveLength(0);
  });
});

/**
 * Trefffläche und Stapelung (LFH-345 · C10, Befunde H16/M17).
 *
 * Die Zeile belegte fest 268 px (64 Sichtbar + 180 Rolle + Abstände); bei 390 px blieben
 * unter 100 px fürs Modul-Label. Das Raster ist jetzt `minmax(0,1fr) auto auto` und stapelt
 * unter `md`.
 */
describe('ModulEinstellungsListe · Trefffläche und Stapelung (LFH-345)', () => {
  // Prüfbar ist der Inline-Style, nicht ein Pixel — jsdom rechnet kein Layout. Die Böden
  // stehen als Literale da: aus dem Token zurückgelesen prüften sie den Token gegen sich selbst.
  it('traegt den Boden der Stufe an der Beschriftung — und die ZWEITE Angabe daneben', () => {
    expect(modulZeilenStil({ controlHeight: 30, paddingSM: 8, padding: 12 }).minHeight).toBe(30);
    expect(modulZeilenStil({ controlHeight: 72, paddingSM: 16, padding: 24 }).minHeight).toBe(72);
    expect(modulZeilenStil({ controlHeight: 30, paddingSM: 8, padding: 12 }).padding).toBe(
      '8px 12px',
    );
  });

  it('schaltet ueber einen Klick auf die Beschriftung — genau einmal', async () => {
    const props = einsatzProps();
    renderMitProviders(<ModulEinstellungsListe {...props} />);

    fireEvent.click(screen.getByText('ETB'));

    await waitFor(() => expect(props.sichtbarSpalte.aufSichtbar).toHaveBeenCalledTimes(1));
    expect(props.sichtbarSpalte.aufSichtbar).toHaveBeenCalledWith('etb', false);
  });

  // Dieselbe Regel wie in `Anmeldeverfahren` (LFH-370): an gesperrten Zeilen entsteht gar
  // kein `<label>` — ein Label-Klick auf ein `disabled` Steuerelement leitet der Browser
  // ohnehin nicht weiter, er waere also eine Aufforderung ohne Reaktion.
  it('gibt der gesperrten Zeile ausdruecklich KEIN Label', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} />);

    expect(document.querySelector('label[for^="modul-sichtbar-"]')).toBeNull();
  });

  it('stapelt unter md und laesst die Spaltenkoepfe dann weg', () => {
    setzeViewportBreite(390);
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    // Der Kopf benennt Spalten. Ohne Spalten benennt er nichts — und ein Kopf ueber
    // gestapelten Zeilen behauptet eine Ordnung, die es nicht gibt.
    expect(screen.queryByText('Sichtbar')).toBeNull();
    // Der Schalter selbst bleibt bedienbar; nur seine Ueberschrift faellt weg.
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeInTheDocument();
  });

  it('haelt die Spaltenkoepfe ab md', () => {
    setzeViewportBreite(1280);
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    expect(screen.getByText('Sichtbar')).toBeInTheDocument();
  });
});

/**
 * Kategorie-Gruppierung, Filterfeld und der Text an den nicht ausblendbaren Modulen
 * (LFH-346 · A9, Befund M48).
 *
 * 25 Modulzeilen lagen flach untereinander — ohne Ordnung, ohne Weg, eine bestimmte Zeile zu
 * finden, und ohne Auskunft darüber, WARUM zwei von ihnen gesperrt sind.
 */
describe('ModulEinstellungsListe · Gruppierung und Filter (LFH-346)', () => {
  it('gruppiert die Module in die sechs Registry-Kategorien — in der Ordnung der Icon-Rail', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    const koepfe = await screen.findAllByRole('heading', { level: 5 });
    // Gepinnt gegen `kategorien` selbst, nicht gegen eine Literal-Liste: die Reihenfolge ist
    // die der Icon-Rail (`modulRegistry.ts`), eine eigene Sortierung hier waere eine zweite
    // Wahrheit. Der Plan nannte ein `modulNachKategorie()` — das gibt es nicht, die Registry
    // fuehrt `kategorien` + `moduleNachKategorie(key)`.
    expect(koepfe.map((h) => h.textContent)).toEqual(kategorien.map((k) => k.label));
  });

  it('filtert die Liste und laesst leere Kategorien GANZ weg', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'lagekarte' } });

    expect(screen.getByText('Lagekarte')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sichtbar: ETB' })).toBeNull();
    // Eine Kategorie-Ueberschrift ohne Zeilen darunter behauptet eine Gruppe, die die
    // gefilterte Liste nicht hat. Mutationsprobe: faellt der Leer-Riegel weg, stehen alle
    // sechs Koepfe ueber einer einzigen Zeile und diese Aussage wird rot — ohne sie waere
    // sie trivial gruen, weil es vor A9 ueberhaupt keine Ueberschriften gab.
    expect(screen.queryByRole('heading', { name: 'Kommunikation' })).toBeNull();
    // Die Gegenaussage: die Kategorie MIT Treffer behaelt ihren Kopf.
    expect(screen.getByRole('heading', { name: 'Lage' })).toBeInTheDocument();
  });

  it('sagt es, wenn der Filter nichts trifft — statt einer leeren Flaeche unter dem Feld', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'zzz' } });

    expect(screen.getByText('Kein Modul passt zum Filter.')).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 5 })).toHaveLength(0);
  });

  it('benennt die nicht ausblendbaren Module als solche', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    const zeile = (await screen.findByText('Einsatzdaten')).closest('[data-modul-zeile]');
    expect(
      within(zeile as HTMLElement).getByText('immer sichtbar, nicht ausblendbar'),
    ).toBeInTheDocument();
  });

  // Die Gegenaussage: der Text steht NUR an den zwei gesperrten Zeilen, nicht an allen 25.
  it('haengt den Text NICHT an ein ausblendbares Modul', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    const zeile = screen.getByText('ETB').closest('[data-modul-zeile]');
    expect(
      within(zeile as HTMLElement).queryByText('immer sichtbar, nicht ausblendbar'),
    ).toBeNull();
  });
});
