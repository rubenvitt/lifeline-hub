import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setzeViewportBreite } from '../../test/viewport';
import { renderMitProviders } from '../../test/utils';
import Grundriss from './Grundriss';
import { aenderePersonBelegung } from '../../api/einsatzUhs';
import type { Person, UhsDetail, UhsPlatz } from '../../api/types';

// Auto-Mock: dieselbe Bauform wie `UhsDetailPage.test.tsx` — die realen HTTP-Aufrufe sind
// hier nicht die Aussage, der abgeschickte `art`-Wert ist es (Test 5 prüft ihn direkt am
// Mock, nicht über MSW-Interception).
vi.mock('../../api/einsatzUhs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzUhs')>();
  return { ...echt, aenderePersonBelegung: vi.fn() };
});

function person(over: Partial<Person>): Person {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 42, status: 'betroffen', name: null, vorname: null,
    geschlecht: null, geburtsdatum: null, alter_geschaetzt: null, herkunft_adresse: null,
    antreff_ort: null, melder_kontakt: null, notiz: null, erfasst_at: 'x', erfasst_von: 1,
    geaendert_at: 'x', geaendert_von: 1, storniert_at: null, aktuelle_sichtung: null,
    aktuelle_sichtung_at: null, aktueller_verbleib: null, aktuelle_uhs_id: null,
    aktueller_platz_id: null, ...over,
  };
}

function platz(over: Partial<UhsPlatz>): UhsPlatz {
  return {
    id: 10, uhs_id: 1, typ: 'bett', bezeichnung: 'Bett 1', pos_x: 10, pos_y: 10,
    verfuegbarkeit: 'frei', reserviert_fuer_person_id: null, storniert_at: null, ...over,
  };
}

function uhsDetail(over: Partial<UhsDetail>): UhsDetail {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz', bezeichnung: 'BHP 50',
    standort: null, notiz: null, lat: null, lon: null, status: 'aktiv',
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
    plaetze: [], belegungen: [], material: [], ...over,
  };
}

// Warteliste + Wartebereich + Transport gefüllt, damit alle drei Bereiche im Baum etwas
// zeigen — die Aussage „nebeneinander"/„gestapelt" braucht in JEDEM Bereich einen Beleg.
const nichtAufgenommen = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
const wartebereich = person({ id: 6, registrier_nr: 6, aktuelle_uhs_id: 1, aktueller_platz_id: null });
const transportPerson = person({
  id: 9, registrier_nr: 9, aktuelle_uhs_id: null, aktueller_verbleib: 'Transport → KH Mitte',
});
const transportBelegung = {
  id: 1, einsatz_id: 1, person_id: 9, uhs_id: 1, platz_id: null,
  art: 'austritt' as const, notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
};

const uhsFixture = uhsDetail({
  plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })],
  belegungen: [transportBelegung],
});

// Bett 1 ist hier BELEGT — der Rückweg-Menüeintrag existiert nur an einem belegten Platz.
const belegendePerson = person({ id: 42, registrier_nr: 42, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
const uhsMitBelegtemPlatz = uhsDetail({
  plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })],
  belegungen: [transportBelegung],
});

function personenFuer(uhs: UhsDetail): Person[] {
  return uhs === uhsMitBelegtemPlatz
    ? [belegendePerson, nichtAufgenommen, wartebereich, transportPerson]
    : [nichtAufgenommen, wartebereich, transportPerson];
}

// Auto-Mock deckt auch `listePersonen`/`ladeUhs` ab — die Personenliste kommt hier über
// React Query, deren Fetcher greift also ebenfalls auf den gemockten Modulnamen. Da
// `Grundriss` `listePersonen` aus `../../api/einsatzPerson` bezieht, wird DIESES Modul
// separat gemockt (sonst bliebe die Personen-Query dauerhaft leer).
vi.mock('../../api/einsatzPerson', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzPerson')>();
  return { ...echt, listePersonen: vi.fn() };
});

describe('Grundriss — Breakpoint-Weiche (LFH-341 · H40)', () => {
  it('stellt ab lg alle drei Bereiche nebeneinander, ohne Reiter', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsFixture));
    setzeViewportBreite(1280);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    // Beide Seitenspalten UND die Fläche gleichzeitig im Baum — das ist die Aussage
    // „nebeneinander", die unter lg nicht mehr gilt.
    expect(await screen.findByText('Noch nicht aufgenommen')).toBeInTheDocument();
    expect(screen.getByText('Wartebereich (Eingang)')).toBeInTheDocument();
    expect(screen.getByText('Auf Transport gebracht')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('stapelt unter lg zu drei Reitern mit der Fläche voran', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsFixture));
    setzeViewportBreite(800); // < lg (992)
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    const reiter = await screen.findByRole('tablist');
    expect(within(reiter).getByRole('tab', { name: 'Fläche' })).toHaveAttribute('aria-selected', 'true');
    expect(within(reiter).getByRole('tab', { name: 'Wartebereich' })).toBeInTheDocument();
    expect(within(reiter).getByRole('tab', { name: 'Transport' })).toBeInTheDocument();
  });

  it('hält unter lg genau EINEN Zweig im Baum — der inaktive Reiter ist nicht bloß verborgen', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsFixture));
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    await screen.findByRole('tablist');
    // Ohne diese Zusicherung wäre `forceRender` eine unbemerkte Rückkehr zum
    // 504-px-Zustand mit anderer Optik: die Spalten STÜNDEN im DOM, nur unsichtbar,
    // und der Wartebereich trüge sein Droppable ein zweites Mal.
    expect(screen.queryByText('Wartebereich (Eingang)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Wartebereich' }));
    expect(await screen.findByText('Wartebereich (Eingang)')).toBeInTheDocument();
  });

  it('bietet den Rückweg in den Wartebereich als Menüeintrag — auf beiden Breiten', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsMitBelegtemPlatz));
    // Der Drag auf `drop-inbox` ist unter lg strukturell weg (anderer Reiter). Ohne
    // diesen Eintrag hätte der schmale Schirm KEINEN Weg mehr, einen Patienten vom
    // Platz zurückzunehmen — der Umbau nähme eine Bewegung, statt eine zu geben.
    for (const breite of [1280, 800]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(
        <Grundriss einsatzId={1} uhs={uhsMitBelegtemPlatz} schreibgeschuetzt={false} />,
      );
      if (breite < 992) await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

      await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
      // Immer über das GEÖFFNETE Menü greifen: antd lässt die Portale geschlossener
      // Dropdowns im Baum stehen.
      const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
      expect(
        within(menue as HTMLElement).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('schickt den Rückweg über dieselbe Mutation wie Drag und Zuweisungsdialog', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsMitBelegtemPlatz));
    vi.mocked(aenderePersonBelegung).mockResolvedValue({
      id: 1, einsatz_id: 1, person_id: 42, uhs_id: 1, platz_id: null,
      art: 'wechsel', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
    });
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsMitBelegtemPlatz} schreibgeschuetzt={false} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
    await userEvent.click(within(menue as HTMLElement).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }));

    // `art: 'wechsel'`, weil die Person bereits an dieser UHS liegt — das rechnet
    // `belegMut` selbst aus, und genau deshalb geht der Eintrag durch die Mutation
    // statt an ihr vorbei.
    await waitFor(() => expect(aenderePersonBelegung).toHaveBeenCalledWith(1, 42, {
      art: 'wechsel', uhs_id: 1, platz_id: null,
    }));
  });

  it('bietet den Rückweg an einem unbelegten Platz gar nicht erst an', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsFixture));
    setzeViewportBreite(1280);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
    expect(
      within(menue as HTMLElement).queryByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    ).not.toBeInTheDocument();
  });

  it('setzt an keiner Seitenspalte mehr eine feste Breite, wenn gestapelt wird', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenFuer(uhsFixture));
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    // jsdom rechnet kein Layout — prüfbar ist der INLINE-STYLE, nicht ein Pixelwert.
    const rahmen = await screen.findByTestId('grundriss-rahmen');
    expect(rahmen).not.toHaveStyle({ width: '240px' });
    expect(rahmen.style.flexDirection).toBe('column');
  });
});
