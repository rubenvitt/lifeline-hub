import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { ComponentProps } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import EtbTabelle from './EtbTabelle';

/** EtbTabelle ist seit den Backlink-Badges router-abhängig → in MemoryRouter rendern. */
function renderTabelle(props: Omit<ComponentProps<typeof EtbTabelle>, 'einsatzId'> & { einsatzId?: number }) {
  return render(
    <MemoryRouter>
      <EtbTabelle einsatzId={1} {...props} />
    </MemoryRouter>,
  );
}

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'Lage erkundet',
    von: 'ELW',
    an: 'Leitstelle',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    ...over,
  };
}

describe('EtbTabelle', () => {
  it('zeigt Inhalt, Typ-Label und Von→An', () => {
    renderTabelle({ eintraege: [eintrag()] });
    expect(screen.getByText('Lage erkundet')).toBeInTheDocument();
    expect(screen.getByText('Meldung')).toBeInTheDocument();
    expect(screen.getByText(/ELW/)).toBeInTheDocument();
  });

  /**
   * Das Nachtrags-Merkmal trägt ein WORT, kein Zeichen (LFH-365 · B5e). Die Aussage ist
   * beweisrelevant: „diese Zeit hat der Erfasser nachgetragen" muss man lesen können,
   * ohne ein ⧖ zu deuten oder einen Tooltip zu öffnen.
   *
   * Drei Dinge an der Form dieser Zusicherung sind gemessen, nicht Geschmack:
   *
   * 1. `getByRole('cell', …)` statt `getByText`, weil `getByText` auch `sr-only` und
   *    `aria-hidden` trifft — ein unsichtbarer Span machte das Kriterium grün, während
   *    auf dem Tablet nichts stünde.
   * 2. Ein REGEX, kein exakter String: der zugängliche Name einer Zelle ist ihr ganzer
   *    Inhalt, hier also „23.05. 09:00 Nachtrag". `{ name: 'Nachtrag' }` schlägt fehl.
   * 3. Die Rollen-Abfrage allein genügt NICHT — sie war gegen den Vorzustand schon grün.
   *    Dort hing ein `aria-label="nachgetragen"` am Zeichen, und `aria-label` gewinnt in
   *    der Namensrechnung (accname Schritt 2C) gegen den Inhalt (2F). Deshalb ist das
   *    `aria-label` beim Umbau GELÖSCHT: der Name entsteht jetzt nur noch aus sichtbarem
   *    Text. Die Zusicherung auf das verschwundene ⧖ hält das fest — bliebe das Zeichen
   *    als Dekoration daneben stehen, wäre der Umbau folgenlos und trotzdem grün.
   */
  it('beschriftet nachgetragene Einträge mit dem Wort „Nachtrag"', () => {
    renderTabelle({
      eintraege: [eintrag({ ereigniszeit: '2026-05-23 09:00:00', received_at: '2026-05-23 10:00:00' })],
    });
    expect(screen.getByRole('cell', { name: /Nachtrag/ })).toBeInTheDocument();
    expect(screen.queryByText('⧖')).not.toBeInTheDocument();
  });

  /**
   * Die Gegenprobe, und sie ist nicht trivial: die Zelle existiert in BEIDEN Fällen (die
   * Ereigniszeit steht immer darin). Rot/grün hängt hier wirklich an der Schwelle aus
   * `typFarben.ts`, nicht an der Anwesenheit der Spalte.
   */
  it('beschriftet nichts bei normaler Latenz', () => {
    renderTabelle({ eintraege: [eintrag()] });
    expect(screen.queryByRole('cell', { name: /Nachtrag/ })).not.toBeInTheDocument();
  });

  it('verknüpft Original und Berichtigung in beide Richtungen', () => {
    const original = eintrag({ id: 1, lfd_nr: 1, inhalt: 'Falsche Lage' });
    const korrektur = eintrag({
      id: 2,
      lfd_nr: 2,
      typ: 'berichtigung',
      inhalt: 'Korrektur',
      berichtigt_eintrag_id: 1,
    });
    renderTabelle({ eintraege: [korrektur, original] });
    expect(screen.getByText('berichtigt #1')).toBeInTheDocument();
    expect(screen.getByText('berichtigt durch #2')).toBeInTheDocument();
  });

  it('rendert Markdown-Inhalt mit Fettschrift (kein Rohtext mit **)', () => {
    const { container } = renderTabelle({ eintraege: [eintrag({ inhalt: '**Lage** erkundet' })] });
    // Nach der Markdown-Umwandlung muss ein <strong>-Element vorhanden sein.
    expect(container.querySelector('strong')).toBeInTheDocument();
    // Die rohen Sternchen dürfen NICHT als Plaintext erscheinen.
    expect(screen.queryByText('**Lage** erkundet')).not.toBeInTheDocument();
  });

  it('rendert Markdown-Listen als Listenelemente (kein Rohtext mit #/-)', () => {
    const { container } = renderTabelle({ eintraege: [eintrag({ inhalt: '# Titel\n- a\n- b' })] });
    // Liste aus zwei Einträgen muss als <li>-Elemente erscheinen.
    const liElemente = container.querySelectorAll('li');
    expect(liElemente.length).toBeGreaterThanOrEqual(2);
  });

  it('zeigt einen Deeplink-Badge auf den gekoppelten Befehl (LFH-25)', () => {
    renderTabelle({ eintraege: [eintrag({ id: 5, befehl_id: 42 })] });
    expect(screen.getByRole('link', { name: /Befehl/ })).toHaveAttribute(
      'href', '/einsaetze/1/auftraege/befehle/42',
    );
  });

  it('hebt den per highlightId adressierten Eintrag hervor (LFH-25 ?eintrag=)', () => {
    const { container } = renderTabelle({ eintraege: [eintrag({ id: 9 })], highlightId: 9 });
    expect(container.querySelector('[data-row-key="9"]')).toHaveClass('zeile-hervorgehoben');
  });
});

/**
 * Die Aktionsspalte (LFH-365 · B5e). Sie war bis hierhin in DIESER Datei völlig
 * ungesichert — geprüft wurden nur Inhalt, Typ, Berichtigung, Markdown, Deeplink und die
 * Datenzustände. Zwei Abfragen in `pages/EtbPage.test.tsx` klickten die Knöpfe direkt und
 * waren damit die einzige Absicherung eines Bauteils, das hier definiert wird.
 *
 * Bauform ist das erprobte Repo-Muster für gebündelte Datensatz-Aktionen
 * (`chat/NachrichtenStrom.tsx:88`), wo dieselbe Transformation — eine Reihe von
 * `type="link"`-Knöpfen zu einem „⋯"-Menü — bereits gemergt ist.
 */
describe('EtbTabelle – Aktionsmenü (LFH-365 · B5e)', () => {
  /**
   * Öffnet das Menü und gibt das OFFENE zurück. Nie ein freier `findByRole`-Griff nach
   * einem `menuitem`: antd lässt die Portale geschlossener Dropdowns im Baum stehen, und
   * eine Abfrage nach der Beschriftung kann dann einen toten Eintrag erwischen — im Repo
   * schon einmal zugeschlagen (`components/Datensicht.test.tsx:926-931`). In einer Tabelle
   * mit mehreren Zeilen liegt zusätzlich je Zeile ein eigenes Portal herum.
   */
  async function oeffneMenue(name: string | RegExp): Promise<HTMLElement> {
    await userEvent.click(screen.getByRole('button', { name }));
    const offen = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    if (!offen) throw new Error(`Das Menü „${String(name)}" ließ sich nicht öffnen`);
    return offen;
  }

  /**
   * Der zugängliche Name trägt die LAUFENDE NUMMER, nicht bloß „Aktionen": die Tabelle
   * zeigt n Zeilen, und n gleichnamige Knöpfe sind per Rolle nicht auseinanderzuhalten.
   * Genommen wird `lfd_nr` — die menschenlesbare Kennung der Tabelle, nie die DB-`id`.
   */
  it('trägt die laufende Nummer im Namen des Auslösers', () => {
    renderTabelle({ eintraege: [eintrag({ lfd_nr: 7 })], onWiedervorlage: vi.fn() });
    expect(screen.getByRole('button', { name: 'Aktionen zu Eintrag 7' })).toBeInTheDocument();
  });

  /*
   * KEINE Zusicherung auf `autoFocus` — und das ist gemessen, nicht angenommen.
   *
   * Der Review hielt die Wirkung für in jsdom belegbar („mit dem Prop trägt der erste
   * Eintrag die Hervorhebung"). Nachgemessen mit dem Testweg dieses Repos (`await
   * userEvent.click` auf den Auslöser, danach das offene Menü untersuchen) gibt es
   * keinen Unterschied: mit UND ohne den Prop bleibt `document.activeElement` der
   * Auslöser-Knopf, die `li`-Klassen sind byte-gleich (`ant-dropdown-menu-item
   * ant-dropdown-menu-item-only-child`), `aria-activedescendant` ist in beiden Fällen
   * `null`. Ein Test darauf wäre also entweder grün-egal-was oder an ein Timing
   * gebunden, das der Rest der Datei nicht nutzt.
   *
   * Der Prop bleibt trotzdem am Produktivcode: er ist Repo-Konvention mit Quelle
   * (`components/Datensicht.tsx:664-670`, dort am echten Baum gemessen). Was hier steht,
   * ist die Grenze des Belegbaren — der Nachweis gehört nach Playwright.
   */
  it('bündelt die drei Aktionen in einem Menü statt in einer Knopfreihe', async () => {
    renderTabelle({
      eintraege: [eintrag()],
      onBerichtigen: vi.fn(),
      onWiedervorlage: vi.fn(),
      onAuftragErteilen: vi.fn(),
    });
    // Die Wortlaute sind KEINE Knöpfe mehr — sonst wäre die Reihe bloß ergänzt worden.
    expect(screen.queryByRole('button', { name: 'Berichtigen' })).not.toBeInTheDocument();
    const menue = await oeffneMenue(/^Aktionen zu Eintrag/);
    expect(within(menue).getByRole('menuitem', { name: 'Berichtigen' })).toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: 'Wiedervorlage' })).toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: 'Auftrag erteilen' })).toBeInTheDocument();
  });

  /**
   * Jeder der drei Zweige wird ANGEKLICKT, nicht nur auf Anwesenheit geprüft.
   *
   * Der Umbau hat drei direkte Verdrahtungen (`onClick={() => onBerichtigen(e)}`) durch
   * einen Versand über Schlüssel-Zeichenketten ersetzt. Zwischen dem Schlüssel am Eintrag
   * und dem Vergleich im Versand besteht keine Typkopplung — `MenuInfo.key` ist ein
   * nackter `string`, `tsc` sieht eine Umbenennung also nicht. Ein Zweig, der nur per
   * An-/Abwesenheit belegt ist, wäre gegen jeden Tippfehler ungeschützt.
   */
  it.each([
    ['Berichtigen', 'onBerichtigen'],
    ['Wiedervorlage', 'onWiedervorlage'],
    ['Auftrag erteilen', 'onAuftragErteilen'],
  ] as const)('„%s" reicht den Eintrag an %s', async (eintragName, prop) => {
    const rueckruf = vi.fn();
    renderTabelle({ eintraege: [eintrag({ id: 42, lfd_nr: 3 })], [prop]: rueckruf });
    const menue = await oeffneMenue('Aktionen zu Eintrag 3');
    await userEvent.click(within(menue).getByRole('menuitem', { name: eintragName }));
    expect(rueckruf).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  /** Bestandslogik, die der Umbau erhalten muss: eine Berichtigung berichtigt man nicht. */
  it('lässt „Berichtigen" an einer Berichtigung weg', async () => {
    renderTabelle({
      eintraege: [eintrag({ typ: 'berichtigung', berichtigt_eintrag_id: 9 })],
      onBerichtigen: vi.fn(),
      onWiedervorlage: vi.fn(),
    });
    const menue = await oeffneMenue(/^Aktionen zu Eintrag/);
    expect(within(menue).queryByRole('menuitem', { name: 'Berichtigen' })).not.toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: 'Wiedervorlage' })).toBeInTheDocument();
  });

  /**
   * Bleibt nach der Filterung keine Aktion übrig, erscheint gar kein Auslöser — kein
   * deaktivierter Knopf, der ins Leere führt. Dieselbe Festlegung wie in
   * `chat/NachrichtenStrom.tsx:89-95`. Der Fall ist erreichbar: eine Berichtigungszeile
   * auf einer Seite, die nur „Berichtigen" anbietet.
   */
  it('rendert keinen Auslöser, wenn keine Aktion übrig bleibt', () => {
    renderTabelle({
      eintraege: [eintrag({ typ: 'berichtigung', berichtigt_eintrag_id: 9 })],
      onBerichtigen: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /^Aktionen/ })).not.toBeInTheDocument();
  });

  /**
   * Ohne Rückrufe gibt es die Spalte GAR NICHT — geprüft an der Spaltenzahl, nicht bloß an
   * der Abwesenheit des Auslösers.
   *
   * Der Unterschied ist der ganze Test: „kein Auslöser" wäre auch grün, wenn die Spalte
   * angelegt und nur ihr Inhalt leer wäre, und der Fall darüber deckt den leeren Inhalt
   * schon ab. Was hier hängt, ist die Weiche eine Ebene höher — sie ist produktiv
   * erreichbar, weil `EtbPage` alle drei Rückrufe als `undefined` übergibt, wenn der
   * Benutzer kein Schreibrecht hat. Ohne diese Zusicherung sähe ein Leser eine dauerhaft
   * leere 96-px-Spalte, und kein Test würde rot.
   */
  it('legt die Aktionsspalte gar nicht an, wenn die Seite keine Aktion mitgibt', () => {
    renderTabelle({ eintraege: [eintrag()] });
    const ohne = screen.getAllByRole('columnheader').length;
    expect(screen.queryByRole('button', { name: /^Aktionen/ })).not.toBeInTheDocument();

    // Abbauen, sonst zählt die zweite Tabelle die Köpfe der ersten mit.
    cleanup();
    renderTabelle({ eintraege: [eintrag()], onWiedervorlage: vi.fn() });
    expect(screen.getAllByRole('columnheader').length).toBe(ohne + 1);
  });
});

/**
 * Die drei Zusicherungen unten sind das AK4-Partnerpaar dieses Bündels — und zwar das
 * einzige mit echter Beweiskraft (Spec §3/F2): die Tabelle bleibt in allen drei Fällen
 * montiert, der Leertext wird also wirklich unterdrückt und nicht bloß mangels Komponente
 * nicht gerendert. Deshalb dasselbe Literal in allen drei Fällen.
 */
describe('EtbTabelle – Datenzustände (LFH-331 · B3)', () => {
  const LEER = 'Noch keine Einträge.';

  it('zeigt den Leertext, wenn die Menge leer und der Abruf durch ist', () => {
    renderTabelle({ eintraege: [], leerText: LEER });
    expect(screen.getByText(LEER)).toBeInTheDocument();
  });

  it('unterdrückt den Leertext, solange geladen wird', () => {
    renderTabelle({ eintraege: [], leerText: LEER, ladend: true });
    expect(screen.queryByText(LEER)).not.toBeInTheDocument();
  });

  it('unterdrückt den Leertext im Fehlerfall', () => {
    renderTabelle({ eintraege: [], leerText: LEER, fehler: true });
    expect(screen.queryByText(LEER)).not.toBeInTheDocument();
  });

  it('reicht den Ladezustand bis an die Tabelle durch', () => {
    // `.ant-spin-spinning`, nicht `.ant-spin`: den Wrapper rendert antds Spin auch im
    // Ruhezustand, eine Zusicherung darauf wäre unabhängig vom Prop grün (gemessen).
    const { container } = renderTabelle({ eintraege: [], ladend: true });
    expect(container.querySelector('.ant-spin-spinning')).toBeInTheDocument();
  });
});
