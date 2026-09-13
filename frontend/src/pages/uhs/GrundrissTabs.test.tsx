import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setzeViewportBreite } from '../../test/viewport';
import { renderMitProviders } from '../../test/utils';
import Grundriss from './Grundriss';
import { aenderePersonBelegung } from '../../api/einsatzUhs';
import { ApiError } from '../../api/client';
import type { Person, UhsDetail, UhsPlatz } from '../../api/types';

// Auto-Mock: dieselbe Bauform wie `UhsDetailPage.test.tsx` — die realen HTTP-Aufrufe sind
// hier nicht die Aussage, der abgeschickte `art`-Wert ist es (Test 5 prüft ihn direkt am
// Mock, nicht über MSW-Interception).
vi.mock('../../api/einsatzUhs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzUhs')>();
  return { ...echt, aenderePersonBelegung: vi.fn() };
});

// Auto-Mock deckt auch `listePersonen` ab — die Personenliste kommt hier über React
// Query, deren Fetcher greift also ebenfalls auf den gemockten Modulnamen. Da `Grundriss`
// `listePersonen` aus `../../api/einsatzPerson` bezieht, wird DIESES Modul separat
// gemockt (sonst bliebe die Personen-Query dauerhaft leer).
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

/** Öffnet das geladene Dropdown-Menü der Platzkarte — Muster aus `Grundriss.test.tsx`
 *  (`offenesMenue()`). antd lässt Portale GESCHLOSSENER Dropdowns im Baum stehen: ein
 *  bloßer erster Treffer (`document.querySelector`) bewiese deshalb nicht, dass genau EIN
 *  Portal offen ist — in einer Schleife über mehrere Renderdurchläufe könnte er ebenso gut
 *  ein Relikt des vorigen Durchlaufs treffen. Wirft laut, wenn die Zahl nicht exakt eins
 *  ist: ein zweites offenes Portal wäre ein echter Befund (z. B. ein Leck über `unmount()`
 *  hinweg), keine Testschwäche, die sich stillschweigend wegfiltern ließe. */
function offenesMenue(): HTMLElement {
  const treffer = document.querySelectorAll(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
  if (treffer.length !== 1) {
    throw new Error(`erwartet genau EIN offenes Dropdown-Menü, gefunden: ${treffer.length}`);
  }
  return treffer[0] as HTMLElement;
}

// EINE UHS für alle Tests — Warteliste + Wartebereich + Transport gefüllt, damit alle
// drei Bereiche im Baum etwas zeigen (die Aussage „nebeneinander"/„gestapelt" braucht in
// JEDEM Bereich einen Beleg). Der Platz „Bett 1" ist in JEDER Variante derselbe Platz;
// ob er belegt ist, entscheidet sich für `Grundriss` ausschließlich über die Personen-
// liste (`person.aktueller_platz_id`), nie über ein Feld an der UHS selbst — deshalb gibt
// es hier bewusst NUR eine `uhs`-Fixture, keine zweite „mit belegtem Platz".
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

// Zwei Personenlisten, EXPLIZIT ausgewählt je Test — keine Ableitung über einen
// Referenzvergleich auf `uhs` (die früher hier stand): der Unterschied „Bett 1 belegt
// oder nicht" lebt allein in dieser Liste.
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

describe('Grundriss — Breakpoint-Weiche (LFH-341 · H40)', () => {
  it('stellt ab lg alle drei Bereiche nebeneinander, ohne Reiter', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(1280);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);

    // Beide Seitenspalten UND die Fläche gleichzeitig im Baum — das ist die Aussage
    // „nebeneinander", die unter lg nicht mehr gilt.
    expect(await screen.findByText('Noch nicht aufgenommen')).toBeInTheDocument();
    expect(screen.getByText('Wartebereich (Eingang)')).toBeInTheDocument();
    expect(screen.getByText('Auf Transport gebracht')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    // Beide Richtungen behauptet, nicht nur die Abwesenheit der Reiter — sonst bliebe der
    // Test grün, wenn der breite Zweig irgendwann selbst stapelte (Muster der `md`-Tests
    // in `EinsatzabschnittePage`/`BrDetailPage`). jsdom rechnet kein Layout, prüfbar ist
    // der Inline-Style.
    expect((await screen.findByTestId('grundriss-rahmen')).style.flexDirection).toBe('row');
  });

  it('stapelt unter lg zu drei Reitern mit der Fläche voran', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(800); // < lg (992)
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);

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
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);

    await screen.findByRole('tablist');
    // Ohne diese Zusicherung wäre ein verborgener zweiter Zweig eine unbemerkte Rückkehr
    // zum 504-px-Zustand mit anderer Optik: die Spalten STÜNDEN im DOM, nur unsichtbar,
    // und der Wartebereich trüge sein Droppable ein zweites Mal.
    expect(screen.queryByText('Wartebereich (Eingang)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Wartebereich' }));
    expect(await screen.findByText('Wartebereich (Eingang)')).toBeInTheDocument();

    // DIE ZWEITE HÄLFTE, und sie ist die eigentliche Aussage (Abschluss-Review LFH-341).
    // Die Zeilen darüber prüfen nur den ANFANGSZUSTAND — und der ist auch ohne
    // `destroyOnHidden` so: `@rc-component/tabs` montiert eine Pane erst beim ersten
    // Besuch. Ohne die Prop bliebe sie DANACH montiert (`removeOnLeave: false`, nur
    // `display: none` + `aria-hidden`), und genau das behauptet der Testname als
    // ausgeschlossen. Der Rückklick ist die Stelle, an der die Aussage kippt.
    await userEvent.click(screen.getByRole('tab', { name: 'Fläche' }));
    await waitFor(() =>
      expect(screen.queryByText('Wartebereich (Eingang)')).not.toBeInTheDocument(),
    );
  });

  it('bietet den Rückweg in den Wartebereich als Menüeintrag — auf beiden Breiten', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenMitBelegung);
    // Der Drag auf `drop-inbox` ist unter lg strukturell weg (anderer Reiter). Ohne
    // diesen Eintrag hätte der schmale Schirm KEINEN Weg mehr, einen Patienten vom
    // Platz zurückzunehmen — der Umbau nähme eine Bewegung, statt eine zu geben.
    for (const breite of [1280, 800]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(
        <Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />,
      );
      if (breite < 992) await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

      await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
      // Genau EIN offenes Portal — nicht bloß „irgendeins" (offenesMenue() wirft sonst).
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
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    const menue = offenesMenue();
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    );

    // `art: 'wechsel'`, weil die Person bereits an dieser UHS liegt — das rechnet
    // `belegMut` selbst aus, und genau deshalb geht der Eintrag durch die Mutation
    // statt an ihr vorbei.
    await waitFor(() =>
      expect(aenderePersonBelegung).toHaveBeenCalledWith(1, 42, {
        art: 'wechsel',
        uhs_id: 1,
        platz_id: null,
      }),
    );
  });

  it('zeigt den Rückweg optimistisch als freien Platz und rollt eine Serverablehnung zurück', async () => {
    // Dritter Aufrufer von `belegMut` (Task 3 dieses Plans, LFH-341/C6-AK): der Test oben
    // prüft nur den abgesetzten Body, nicht das optimistische Verhalten — `onMutate`/
    // `onError` sind Bestand aus B5g, aber bisher nur für Drag und Zuweisungsdialog
    // belegt. Muster wie die kombinierte Zusicherung
    // „zeigt die Platzbelegung optimistisch und rollt eine Serverablehnung zurück" in
    // Grundriss.test.tsx.
    const { listePersonen } = await import('../../api/einsatzPerson');
    // Erster Ruf lädt die Ausgangslage; jeder weitere ist der `onSettled`-Refetch, den
    // `invalidate()` nach JEDER Mutation auslöst — auch nach einer Ablehnung. Der hängt
    // hier bewusst: die Fixture liefert unverändert „belegt" zurück, ein sofort
    // aufgelöster Refetch überschriebe den Rollback-Beleg unten also selbst dann korrekt,
    // wenn `onError` gar nicht liefe. Ohne diesen Riegel wäre die Zusicherung blind für
    // einen fehlenden Rollback-Zweig.
    let anrufe = 0;
    vi.mocked(listePersonen).mockImplementation(() => {
      anrufe += 1;
      return anrufe === 1 ? Promise.resolve(personenMitBelegung) : new Promise<Person[]>(() => {});
    });
    // Die Zusage bleibt offen, bis wir sie gezielt ablehnen — nur so ist der Zustand
    // ZWISCHEN Klick und Antwort beobachtbar. Mit einer sofort abgelehnten Zusage bliebe
    // die Karte ohne `onMutate` die ganze Zeit „belegt", und der Test belegte nichts.
    let ablehnen: (grund: unknown) => void = () => {};
    vi.mocked(aenderePersonBelegung).mockReturnValue(
      new Promise((_res, rej) => {
        ablehnen = rej;
      }),
    );
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);
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
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    const menue = offenesMenue();
    expect(
      within(menue).queryByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    ).not.toBeInTheDocument();
  });

  /**
   * DER ZWEITE BEDIENWEG, DEN DER UMBRUCH SONST GENOMMEN HÄTTE (Abschluss-Review LFH-341).
   *
   * Der Rückweg `Platz → Wartebereich` hat in Task 3 einen Menüeintrag bekommen, weil der
   * Reiter-Umbruch ihn sonst genommen hätte. Für die zweite Richtung wurde dieselbe
   * Rechnung nicht gestellt: `onDragEnd` nimmt `kind: 'transport'` von JEDER Person
   * entgegen — auch aus dem Wartebereich und aus „Noch nicht aufgenommen" —, und
   * `drop-transport` liegt unter `lg` im dritten Reiter. Die direkten Knöpfe sitzen
   * ausschliesslich auf der PlatzKarte und nur bei belegtem Platz, `PersonDetailDrawer` ist
   * mutationsfrei: eine Person im Wartebereich hätte im Grundriss keinen Verbleib mehr
   * bekommen können.
   */
  it('erfasst den Verbleib aus beiden Wartelisten heraus — auf beiden Breiten', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    for (const breite of [1280, 800]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(
        <Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />,
      );
      if (breite < 992)
        await userEvent.click(await screen.findByRole('tab', { name: 'Wartebereich' }));

      // Beide Listen, je eigener Auslöser mit ZEILENKENNUNG im Namen — n Zeilen dürfen
      // nicht n gleichnamige Knöpfe liefern. Ein blosses `getAllByRole` mit Zählung
      // liesse offen, ob die Namen unterscheidbar sind.
      const ausloeser = await screen.findByRole('button', {
        name: 'Verbleib / Entlassung erfassen — R-006 · unbekannt',
      });
      expect(ausloeser, `Wartebereich, Breite ${breite}`).toBeInTheDocument();
      // Die Ikone ist Zierde und darf KEIN eigenes Vorleseziel sein: ein
      // `@ant-design/icons`-Knoten bringt `role="img"` mit englischem `aria-label` („car")
      // mit und stünde sonst in jeder Zeile als zweites Ziel daneben. Die `aria-hidden`-Hülle
      // nimmt ihn aus dem Barrierefreiheitsbaum — geprüft, nicht bloss behauptet
      // (Muster `kraefte/AmpelZelle.test.tsx`, dort per Mutationsprobe belegt).
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
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Wartebereich' }));

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Verbleib / Entlassung erfassen — R-006 · unbekannt',
      }),
    );

    // Der Titel trägt die Person — das ist der Beleg, dass `setTransportPerson` mit DIESER
    // Zeile gerufen wurde und nicht bloss irgendein Dialog aufging.
    expect(await screen.findByText('Verbleib erfassen — R-006 · unbekannt')).toBeInTheDocument();
  });

  it('rendert den Verbleib-Auslöser ohne Schreibrecht gar nicht erst', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(1280);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt />);

    // AUF DIE ZEILE warten, nicht auf den Spaltentitel — der steht sofort, auch bevor die
    // Personen-Query aufgelöst hat. Gemessen: mit `findByText('Wartebereich (Eingang)')`
    // als Anker lief dieser Test auch dann grün, wenn der Rechte-Riegel ganz entfernt war
    // (Mutationsprobe), weil zum Prüfzeitpunkt schlicht noch keine Zeile im Baum stand.
    expect(await screen.findByText('R-006 · unbekannt')).toBeInTheDocument();
    // … und trägt trotzdem keinen Auslöser. GAR NICHT gerendert, nicht deaktiviert.
    expect(
      screen.queryByRole('button', { name: /Verbleib \/ Entlassung erfassen/ }),
    ).not.toBeInTheDocument();
  });

  it('setzt an keiner Seitenspalte mehr eine feste Breite, wenn gestapelt wird', async () => {
    const { listePersonen } = await import('../../api/einsatzPerson');
    vi.mocked(listePersonen).mockResolvedValue(personenOhneBelegung);
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={false} />);

    // jsdom rechnet kein Layout — prüfbar ist der INLINE-STYLE, nicht ein Pixelwert.
    // Die 240 px sassen NIE am Rahmen selbst, sondern an den inneren Wrapper-Divs der
    // Seitenspalten (LINKS/RECHTS) — ein `not.toHaveStyle({ width: '240px' })` auf dem
    // Rahmen wäre also trivial erfüllt, unabhängig vom Umbau. Geprüft wird deshalb, dass
    // KEIN Nachkomme des Rahmens eine feste 240-px-Breite trägt.
    const rahmen = await screen.findByTestId('grundriss-rahmen');
    expect(rahmen.querySelectorAll('[style*="width: 240px"]')).toHaveLength(0);
    expect(rahmen.style.flexDirection).toBe('column');
  });
});
