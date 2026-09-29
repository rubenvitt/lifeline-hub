import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setzeViewportBreite } from '../../test/viewport';
import { renderMitProviders } from '../../test/utils';
import { ConfigProvider } from 'antd';
import type { ReactElement } from 'react';
import Grundriss from './Grundriss';
import { antdToken, farbenDunkel } from '../../theme/tokens';
import { aenderePersonBelegung } from '../../api/einsatzUhs';
import { ApiError } from '../../api/client';
import type { Person, UhsDetail, UhsPlatz } from '../../api/types';

// Auto-Mock: die Aussage ist der abgeschickte `art`-Wert, direkt am Mock geprüft.
vi.mock('../../api/einsatzUhs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzUhs')>();
  return { ...echt, aenderePersonBelegung: vi.fn() };
});

// `Grundriss` bezieht `listePersonen` aus `../../api/einsatzPerson` — dieses Modul wird separat
// gemockt, sonst bliebe die Personen-Query leer.
vi.mock('../../api/einsatzPerson', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzPerson')>();
  return { ...echt, listePersonen: vi.fn() };
});

function person(over: Partial<Person>): Person {
  return {
    id: 1,
    einsatz_id: 1,
    registrier_nr: 42,
    status: 'betroffen',
    name: null,
    vorname: null,
    geschlecht: null,
    geburtsdatum: null,
    alter_geschaetzt: null,
    herkunft_adresse: null,
    antreff_ort: null,
    melder_kontakt: null,
    notiz: null,
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    aktuelle_sichtung: null,
    aktuelle_sichtung_at: null,
    aktueller_verbleib: null,
    aktuelle_uhs_id: null,
    aktueller_platz_id: null,
    ...over,
  };
}

function platz(over: Partial<UhsPlatz>): UhsPlatz {
  return {
    id: 10,
    uhs_id: 1,
    typ: 'bett',
    bezeichnung: 'Bett 1',
    pos_x: 10,
    pos_y: 10,
    verfuegbarkeit: 'frei',
    reserviert_fuer_person_id: null,
    storniert_at: null,
    ...over,
  };
}

function uhsDetail(over: Partial<UhsDetail>): UhsDetail {
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    typ: 'behandlungsplatz',
    bezeichnung: 'BHP 50',
    standort: null,
    notiz: null,
    lat: null,
    lon: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    plaetze: [],
    belegungen: [],
    material: [],
    ...over,
  };
}

/**
 * Das geöffnete Dropdown-Menü der Platzkarte. antd lässt Portale geschlossener Dropdowns stehen;
 * wirft laut, wenn nicht genau eines offen ist — ein zweites wäre ein echter Befund (etwa ein Leck
 * über `unmount()`).
 */
function offenesMenue(): HTMLElement {
  const treffer = document.querySelectorAll(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
  if (treffer.length !== 1) {
    throw new Error(`erwartet genau EIN offenes Dropdown-Menü, gefunden: ${treffer.length}`);
  }
  return treffer[0] as HTMLElement;
}

// Eine UHS für alle Tests, alle drei Bereiche gefüllt (jede Aussage „nebeneinander"/„gestapelt"
// braucht in jedem Bereich einen Beleg). Ob „Bett 1" belegt ist, entscheidet allein die
// Personenliste (`person.aktueller_platz_id`).
const nichtAufgenommenPerson = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
const wartebereichPerson = person({
  id: 6,
  registrier_nr: 6,
  aktuelle_uhs_id: 1,
  aktueller_platz_id: null,
});
const transportPerson = person({
  id: 9,
  registrier_nr: 9,
  aktuelle_uhs_id: null,
  aktueller_verbleib: 'Transport → KH Mitte',
});
const belegendePerson = person({
  id: 42,
  registrier_nr: 42,
  aktuelle_uhs_id: 1,
  aktueller_platz_id: 10,
});
const transportBelegung = {
  id: 1,
  einsatz_id: 1,
  person_id: 9,
  uhs_id: 1,
  platz_id: null,
  art: 'austritt' as const,
  notiz: null,
  zeitpunkt_at: 'x',
  erfasst_von: 1,
};

const uhs = uhsDetail({
  plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })],
  belegungen: [transportBelegung],
});

// Zwei Personenlisten, je Test explizit gewählt — der Unterschied „Bett 1 belegt oder nicht" lebt
// allein hier.
const personenOhneBelegung: Person[] = [
  nichtAufgenommenPerson,
  wartebereichPerson,
  transportPerson,
];
const personenMitBelegung: Person[] = [
  belegendePerson,
  nichtAufgenommenPerson,
  wartebereichPerson,
  transportPerson,
];

/**
 * Mit dem App-Theme in `kompakt`: antds Vorgaben (`marginSM` 12) ergäben die Kartenform. Diese
 * Datei prüft die Knopfzeile des Fükw.
 */
function kompakt(ui: ReactElement) {
  return (
    <ConfigProvider theme={{ token: antdToken(farbenDunkel, 'kompakt') }}>{ui}</ConfigProvider>
  );
}

describe('Grundriss — Breakpoint-Weiche (LFH-341 · H40)', () => {
  it('stellt ab lg alle drei Bereiche nebeneinander, ohne Reiter', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(1280);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));

    // Beide Seitenspalten und die Fläche gleichzeitig im Baum — die Aussage „nebeneinander".
    expect(await screen.findByText('Noch nicht aufgenommen')).toBeInTheDocument();
    expect(screen.getByText('Wartebereich (Eingang)')).toBeInTheDocument();
    expect(screen.getByText('Auf Transport gebracht')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    // Beide Richtungen, sonst bliebe der Test grün, wenn der breite Zweig selbst stapelte. Prüfbar
    // ist der Inline-Style.
    expect((await screen.findByTestId('grundriss-rahmen')).style.flexDirection).toBe('row');
  });

  it('stapelt unter lg zu drei Reitern mit der Fläche voran', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(800); // < lg (992)
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));

    const reiter = await screen.findByRole('tablist');
    expect(within(reiter).getByRole('tab', { name: 'Fläche' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(reiter).getByRole('tab', { name: 'Wartebereich' })).toBeInTheDocument();
    expect(within(reiter).getByRole('tab', { name: 'Transport' })).toBeInTheDocument();
  });

  it('hält unter lg genau EINEN Zweig im Baum — der inaktive Reiter ist nicht bloß verborgen', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(800);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));

    await screen.findByRole('tablist');
    // Ein verborgener zweiter Zweig stünde im DOM, nur unsichtbar, und trüge das Droppable doppelt.
    expect(screen.queryByText('Wartebereich (Eingang)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Wartebereich' }));
    expect(await screen.findByText('Wartebereich (Eingang)')).toBeInTheDocument();

    // Die eigentliche Aussage: der Anfangszustand stimmt auch ohne `destroyOnHidden` (die Pane wird
    // erst beim ersten Besuch montiert). Ohne die Prop bliebe sie danach montiert — der Rückklick
    // ist die Stelle, an der das kippt.
    await userEvent.click(screen.getByRole('tab', { name: 'Fläche' }));
    await waitFor(() =>
      expect(screen.queryByText('Wartebereich (Eingang)')).not.toBeInTheDocument(),
    );
  });

  it('bietet den Rückweg in den Wartebereich als Menüeintrag — auf beiden Breiten', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenMitBelegung);
    // Der Drag auf `drop-inbox` ist unter lg weg (anderer Reiter); ohne diesen Eintrag gäbe es auf
    // schmalem Schirm keinen Rückweg vom Platz.
    for (const breite of [1280, 800]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(
        kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />),
      );
      if (breite < 992) await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

      await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
      // Genau ein offenes Portal (offenesMenue() wirft sonst).
      const menue = offenesMenue();
      expect(
        within(menue).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('schickt den Rückweg über dieselbe Mutation wie Drag und Zuweisungsdialog', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenMitBelegung);
    vi.mocked(aenderePersonBelegung).mockResolvedValue({
      id: 1,
      einsatz_id: 1,
      person_id: 42,
      uhs_id: 1,
      platz_id: null,
      art: 'wechsel',
      notiz: null,
      zeitpunkt_at: 'x',
      erfasst_von: 1,
    });
    setzeViewportBreite(800);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));
    await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    const menue = offenesMenue();
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    );

    // `art: 'wechsel'`, weil die Person bereits an dieser UHS liegt — `belegMut` rechnet das
    // selbst, deshalb geht der Eintrag durch die Mutation.
    await waitFor(() =>
      expect(aenderePersonBelegung).toHaveBeenCalledWith(1, 42, {
        art: 'wechsel',
        uhs_id: 1,
        platz_id: null,
      }),
    );
  });

  it('zeigt den Rückweg optimistisch als freien Platz und rollt eine Serverablehnung zurück', async () => {
    // Dritter Aufrufer von `belegMut`: geprüft wird das optimistische Verhalten samt Rollback, wie
    // „zeigt die Platzbelegung optimistisch und rollt eine Serverablehnung zurück" in
    // Grundriss.test.tsx.
    const { listePersonen } = await import('../../api/einsatzPerson');
    // Erster Ruf lädt die Ausgangslage; jeder weitere ist der `onSettled`-Refetch. Der hängt hier
    // bewusst: ein sofort aufgelöster Refetch mit „belegt" stellte den Ausgangszustand auch ohne
    // `onError` wieder her.
    let anrufe = 0;
    vi.mocked(listePersonen).mockImplementation(() => {
      anrufe += 1;
      return anrufe === 1 ? Promise.resolve(personenMitBelegung) : new Promise<Person[]>(() => {});
    });
    // Die Zusage bleibt offen, bis wir sie ablehnen — nur so ist der Zustand zwischen Klick und
    // Antwort beobachtbar.
    let ablehnen: (grund: unknown) => void = () => {};
    vi.mocked(aenderePersonBelegung).mockReturnValue(
      new Promise((_res, rej) => {
        ablehnen = rej;
      }),
    );
    setzeViewportBreite(800);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));
    await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));
    expect(await screen.findByText('belegt')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    await userEvent.click(
      within(offenesMenue()).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    );

    // Optimistisch: der Platz zeigt sich schon frei, bevor die Zusage entschieden ist.
    await waitFor(() => expect(screen.queryByText('belegt')).not.toBeInTheDocument());

    await act(async () => {
      ablehnen(new ApiError(422, 'abgelehnt'));
    });

    // Rollback: die Ablehnung stellt den Ausgangszustand wieder her.
    expect(await screen.findByText('belegt')).toBeInTheDocument();
  });

  it('bietet den Rückweg an einem unbelegten Platz gar nicht erst an', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(1280);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    const menue = offenesMenue();
    expect(
      within(menue).queryByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    ).not.toBeInTheDocument();
  });

  /**
   * Verbleib aus beiden Wartelisten heraus: `onDragEnd` nimmt `kind: 'transport'` von jeder Person,
   * `drop-transport` liegt unter `lg` im dritten Reiter, und die direkten Knöpfe sitzen nur an
   * belegten Plätzen.
   */
  it('erfasst den Verbleib aus beiden Wartelisten heraus — auf beiden Breiten', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    for (const breite of [1280, 800]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(
        kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />),
      );
      if (breite < 992)
        await userEvent.click(await screen.findByRole('tab', { name: 'Wartebereich' }));

      // Je eigener Auslöser mit Zeilenkennung im Namen — ein bloßes Zählen ließe offen, ob die
      // Namen unterscheidbar sind.
      const ausloeser = await screen.findByRole('button', {
        name: 'Verbleib / Entlassung erfassen — R-006 · unbekannt',
      });
      expect(ausloeser, `Wartebereich, Breite ${breite}`).toBeInTheDocument();
      // Die Ikone darf kein eigenes Vorleseziel sein (antd-Icons bringen `role="img"` mit
      // englischem `aria-label`); die `aria-hidden`-Hülle nimmt sie aus dem Baum.
      expect(within(ausloeser).queryByRole('img'), `Ikone stumm, Breite ${breite}`).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Verbleib / Entlassung erfassen — R-005 · unbekannt' }),
        `Noch nicht aufgenommen, Breite ${breite}`,
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('öffnet damit denselben Verbleib-Dialog wie der Drag auf „Auf Transport gebracht"', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(800);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));
    await userEvent.click(await screen.findByRole('tab', { name: 'Wartebereich' }));

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Verbleib / Entlassung erfassen — R-006 · unbekannt',
      }),
    );

    // Der Titel trägt die Person — Beleg, dass `setTransportPerson` mit dieser Zeile gerufen wurde.
    expect(await screen.findByText('Verbleib erfassen — R-006 · unbekannt')).toBeInTheDocument();
  });

  it('rendert den Verbleib-Auslöser ohne Schreibrecht gar nicht erst', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(1280);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt />));

    // Auf die Zeile warten, nicht auf den Spaltentitel: der steht sofort, und die Prüfung liefe
    // sonst auch ohne Rechte-Riegel grün.
    expect(await screen.findByText('R-006')).toBeInTheDocument();
    // … und trägt trotzdem keinen Auslöser — gar nicht gerendert, nicht deaktiviert.
    expect(
      screen.queryByRole('button', { name: /Verbleib \/ Entlassung erfassen/ }),
    ).not.toBeInTheDocument();
  });

  it('setzt an keiner Seitenspalte mehr eine feste Breite, wenn gestapelt wird', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(800);
    renderMitProviders(kompakt(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />));

    // Die 240 px saßen an den inneren Wrappern der Seitenspalten, nicht am Rahmen — geprüft wird
    // deshalb, dass kein Nachkomme des Rahmens eine feste 240-px-Breite trägt.
    const rahmen = await screen.findByTestId('grundriss-rahmen');
    expect(rahmen.querySelectorAll('[style*="width: 240px"]')).toHaveLength(0);
    expect(rahmen.style.flexDirection).toBe('column');
  });
});
