import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite } from '../../test/viewport';
import { kategorien } from '../../einsatz/modulRegistry';
import ModulEinstellungsListe, { modulSperrGrund, modulZeilenStil } from './ModulEinstellungsListe';

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
 * Zeilensperre und Fehlermarke je Zeile: eine laufende Mutation sperrt nur ihre Zeile, und der
 * Fehler benennt die betroffene Zeile.
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

  // Gegenaussage: sonst wäre eine Liste, die jede Zeile markiert, ebenfalls grün.
  it('markiert ohne Fehler gar keine Zeile', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    expect(document.querySelectorAll('[data-modul-zeile][data-fehler="true"]')).toHaveLength(0);
  });
});

/** Trefffläche und Stapelung: Raster `minmax(0,1fr) auto auto`, gestapelt unter `md`. */
describe('ModulEinstellungsListe · Trefffläche und Stapelung (LFH-345)', () => {
  // Prüfbar ist der Inline-Style, nicht ein Pixel. Die Böden stehen als Literale da.
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

  // An gesperrten Zeilen entsteht kein `<label>`: den Klick auf ein `disabled` Steuerelement leitet
  // der Browser nicht weiter.
  it('gibt der gesperrten Zeile ausdruecklich KEIN Label', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} />);

    expect(document.querySelector('label[for^="modul-sichtbar-"]')).toBeNull();
  });

  it('stapelt unter md und laesst die Spaltenkoepfe dann weg', () => {
    setzeViewportBreite(390);
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    // Ein Kopf über gestapelten Zeilen benennt keine Spalten und behauptet eine Ordnung, die es
    // nicht gibt.
    expect(screen.queryByText('Sichtbar')).toBeNull();
    // Der Schalter bleibt bedienbar, nur seine Überschrift fällt weg.
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeInTheDocument();
  });

  it('haelt die Spaltenkoepfe ab md', () => {
    setzeViewportBreite(1280);
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    expect(screen.getByText('Sichtbar')).toBeInTheDocument();
  });
});

/** Kategorie-Gruppierung, Filterfeld und der Text an den nicht ausblendbaren Modulen. */
describe('ModulEinstellungsListe · Gruppierung und Filter (LFH-346)', () => {
  it('gruppiert die Module in die sechs Registry-Kategorien — in der Ordnung der Icon-Rail', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    const koepfe = await screen.findAllByRole('heading', { level: 3 });
    // Gepinnt gegen `kategorien` selbst: die Reihenfolge ist die der Icon-Rail, eine eigene
    // Sortierung wäre eine zweite Wahrheit.
    expect(koepfe.map((h) => h.textContent)).toEqual(kategorien.map((k) => k.label));
  });

  it('filtert die Liste und laesst leere Kategorien GANZ weg', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'lagekarte' } });

    expect(screen.getByText('Lagekarte')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sichtbar: ETB' })).toBeNull();
    // Eine Kategorie-Überschrift ohne Zeilen behauptet eine Gruppe, die die gefilterte Liste nicht
    // hat.
    expect(screen.queryByRole('heading', { name: 'Kommunikation' })).toBeNull();
    // Gegenaussage: die Kategorie mit Treffer behält ihren Kopf.
    expect(screen.getByRole('heading', { name: 'Lage' })).toBeInTheDocument();
  });

  it('sagt es, wenn der Filter nichts trifft — statt einer leeren Flaeche unter dem Feld', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'zzz' } });

    expect(screen.getByText('Kein Modul passt zum Filter.')).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('benennt die nicht ausblendbaren Module als solche', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    const zeile = (await screen.findByText('Einsatzdaten')).closest('[data-modul-zeile]');
    expect(
      within(zeile as HTMLElement).getByText('immer sichtbar, nicht ausblendbar'),
    ).toBeInTheDocument();
  });

  // Gegenaussage: der Text steht nur an den zwei gesperrten Zeilen.
  it('haengt den Text NICHT an ein ausblendbares Modul', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    const zeile = screen.getByText('ETB').closest('[data-modul-zeile]');
    expect(
      within(zeile as HTMLElement).queryByText('immer sichtbar, nicht ausblendbar'),
    ).toBeNull();
  });
});

/**
 * Sperrgrund je Zeile. Drei Quellen sperren eine Zeile: Modul-Eigenschaft, fehlendes Recht, eigener
 * Schreibvorgang. Die tragenden Aussagen sind die negativen: kein Rechte-Text an einer bedienbaren
 * oder bloß schreibenden Zeile, und an „Einsatzdaten“ ohne Recht genau ein Grund.
 */
describe('ModulEinstellungsListe · Sperrgrund je Zeile (LFH-383)', () => {
  const RECHTE = {
    kurz: 'nur Einsatzleitung',
    lang: 'Nur die Einsatzleitung darf die Modul-Sichtbarkeit ändern.',
  };

  function zeileVon(label: string) {
    return screen.getByText(label).closest('[data-modul-zeile]') as HTMLElement;
  }

  // Vorrang ohne Render: Modul vor Recht vor Schreibvorgang.
  it('leitet den Grund mit festem Vorrang ab: Modul vor Recht vor Schreibvorgang', () => {
    expect(modulSperrGrund({ ausblendbar: false, darfVerwalten: false, laeuft: true })).toBe(
      'modul',
    );
    expect(modulSperrGrund({ ausblendbar: true, darfVerwalten: false, laeuft: true })).toBe(
      'rechte',
    );
    expect(modulSperrGrund({ ausblendbar: true, darfVerwalten: true, laeuft: true })).toBe(
      'laeuft',
    );
    expect(modulSperrGrund({ ausblendbar: true, darfVerwalten: true, laeuft: false })).toBeNull();
  });

  it('nennt ohne Recht den Grund des Aufrufers sichtbar an der Zeile', () => {
    renderMitProviders(
      <ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} rechteGrund={RECHTE} />,
    );

    expect(within(zeileVon('ETB')).getByText('nur Einsatzleitung')).toBeInTheDocument();
  });

  it('trägt an einer Zeile mit zwei Gründen nur den strukturellen', () => {
    renderMitProviders(
      <ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} rechteGrund={RECHTE} />,
    );

    const zeile = zeileVon('Einsatzdaten');
    expect(within(zeile).getByText('immer sichtbar, nicht ausblendbar')).toBeInTheDocument();
    expect(within(zeile).queryByText('nur Einsatzleitung')).toBeNull();
  });

  it('fällt ohne Wortlaut des Aufrufers auf „nur lesen“ zurück — ein Wort, das immer stimmt', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} />);

    expect(within(zeileVon('ETB')).getByText('nur lesen')).toBeInTheDocument();
  });

  it('hängt an eine bedienbare Zeile keinen Rechte-Text', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} rechteGrund={RECHTE} />);

    expect(screen.queryByText('nur Einsatzleitung')).toBeNull();
    expect(screen.queryByText('nur lesen')).toBeNull();
  });

  // Der Schreibvorgang bekommt keinen Text, aber den Ladezustand am Steuerelement.
  it('zeigt an der schreibenden Zeile keinen Text, aber den Ladezustand am Schalter', () => {
    renderMitProviders(
      <ModulEinstellungsListe {...einsatzProps()} rechteGrund={RECHTE} laeuftKey="etb" />,
    );

    const zeile = zeileVon('ETB');
    expect(within(zeile).queryByText('nur Einsatzleitung')).toBeNull();
    expect(within(zeile).queryByText('nur lesen')).toBeNull();
    // Der zugängliche Name bleibt stehen: das `aria-label` schlägt die Lade-Ikone.
    const schalter = screen.getByRole('switch', { name: 'Sichtbar: ETB' });
    expect(schalter).toHaveClass('ant-switch-loading');
    // Gegenaussage: eine ruhende Zeile lädt nicht.
    expect(screen.getByRole('switch', { name: 'Sichtbar: Chat' })).not.toHaveClass(
      'ant-switch-loading',
    );
  });

  it('legt die lange Begründung in den Tooltip über dem Kurztext', async () => {
    renderMitProviders(
      <ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} rechteGrund={RECHTE} />,
    );

    fireEvent.mouseEnter(within(zeileVon('ETB')).getByText('nur Einsatzleitung'));
    expect(await screen.findByText(RECHTE.lang)).toBeInTheDocument();
  });

  it('erklärt die Modul-Eigenschaft im Tooltip — vorher stand dort gar nichts', async () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    fireEvent.mouseEnter(
      within(zeileVon('Einsatzdaten')).getByText('immer sichtbar, nicht ausblendbar'),
    );
    expect(await screen.findByText(/Selbst-Aussperr-Schutz/)).toBeInTheDocument();
  });
});
