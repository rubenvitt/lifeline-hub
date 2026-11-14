import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../../api/client';
import { oeffneKontextmenue } from '../../test/kontextmenue';
import { waehle } from '../../test/auswahlListe';
import { setzeViewportBreite } from '../../test/viewport';

dayjs.extend(utc);

/**
 * Gemeinsamer Testsatz des Plan-Editors (Change `y106s29r-blockplan-kern`, Aufgabe 1.5, design.md
 * D6): dieselben Fälle gegen den Schichtplan im Einsatz (`SchichtplanAnsicht`) und den Plan einer
 * Vorplanung (`PlanungSchichtplan`). Beide werden zu Hüllen um einen Editor; dieser Satz bleibt
 * dabei unverändert grün und prüft deshalb nur Beobachtbares: Rollen, Texte, Aufrufe der API.
 *
 * Eine Hülle liefert die Render-Funktion, die Attrappen der fünf API-Aufrufe und ihren Stand mit
 * zwei Blöcken: A an „RTW 1“ mit einer eingeteilten Person, B an „RTW 2“ ohne. Beide Posten
 * stehen unter dem Abschnitt „Nord“. In der Seitenleiste steht „Carl Coe“ (Stamm-Personal 60).
 *
 * jsdom rechnet kein Layout: für Zug und Ablage setzt {@link stelleRechtecke} die Rechtecke von
 * Blöcken, Person und Zieh-Schatten; die Breite des Rasters bleibt bei der Vorgabe ohne Messung.
 */

const STUNDE = 3_600_000;

export type ApiMock = Mock<(...args: unknown[]) => Promise<unknown>>;

/** Die Schreib- und Lesewege, die der Editor ruft; je Hülle auf ihr API-Modul gelegt. */
export interface PlanEditorApi {
  /** Plan laden (Einsatz `fetchSchichtplan`, Planung `loadPlanung`). */
  load: ApiMock;
  /** Block anlegen: `(planId, body)`. */
  create: ApiMock;
  /** Block ändern: `(planId, blockId, body)`. */
  update: ApiMock;
  /** Block löschen: `(planId, blockId, version)`. */
  delete: ApiMock;
  /** Schichten erzeugen: `(planId, body)`. */
  erzeugen: ApiMock;
}

export interface PlanEditorBlock {
  id: number;
  version: number;
  /** Beginn und Ende in ms; beide im Raster der vorgewählten Zeitspanne und auf 5 min. */
  von: number;
  bis: number;
}

export interface PlanEditorHuelle {
  /** Name des Rasters: „Schichtplan“ bzw. „Planung“. */
  beschriftung: string;
  /** Titel eines Fehlers über dem Raster: „Schichtplan nicht geändert“ bzw. „Planung …“. */
  fehlerTitel: string;
  /** Kennung des Plans im ersten Argument jedes Aufrufs (Einsatz- bzw. Planungs-ID). */
  planId: number;
  api: PlanEditorApi;
  /** Block A an „RTW 1“ (Soll 2, mit Person) und B an „RTW 2“ (leer). */
  bloecke: { a: PlanEditorBlock; b: PlanEditorBlock };
  /** Antwort des Servers: der ganze Stand, ohne die genannten Blöcke, mit `neu` Blöcken mehr. */
  stand: (o?: { ohne?: number[]; neu?: number }) => unknown;
  /** Der Posten im Body („RTW 1“): Einsatz `{ posten: … }`, Planung `{ posten_id }`. */
  postenRtw1: Record<string, unknown>;
  /** Die Personen von Block A als Eingabe im Body. */
  personenA: unknown[];
  /** Rendert die Hülle; `personalGesperrt` nur, wo die Hülle Freigaben kennt. */
  zeige: (o?: { personalGesperrt?: boolean }) => void;
  /**
   * Wie die Kopie eines gezogenen Blocks seine Personen mitnimmt. Einsatz: mit Freigabe Personal
   * ja, ohne nein; Vorplanung: immer.
   */
  kopieVarianten: { titel: string; personalGesperrt?: boolean; mitPersonen: boolean }[];
}

/** Wire-Zeit (UTC ohne Zone) eines Zeitpunkts in ms. */
const wire = (ms: number) => dayjs.utc(ms).format('YYYY-MM-DD HH:mm:ss');

const PERSON = 'Carl Coe';
const PERSON_EINGABE = { art: 'stamm', personal_id: 60 };

// ── Layout für jsdom ─────────────────────────────────────────────────────────────────────────

interface Rechteck {
  left: number;
  top: number;
  width: number;
  height: number;
}

const RECHTECK_A: Rechteck = { left: 200, top: 0, width: 100, height: 30 };
const RECHTECK_B: Rechteck = { left: 400, top: 100, width: 100, height: 30 };
const RECHTECK_PERSON: Rechteck = { left: 0, top: 100, width: 100, height: 30 };

const alsDomRect = ({ left, top, width, height }: Rechteck) =>
  ({
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * Rechtecke für Blöcke, Personen und den Zieh-Schatten (in `position: fixed`, aus deren Stil); alle
 * übrigen Elemente behalten jsdoms Nullen, damit Raster und Spur bei ihren Vorgaben bleiben.
 */
function stelleRechtecke(bloecke: { a: PlanEditorBlock; b: PlanEditorBlock }) {
  const echt = Element.prototype.getBoundingClientRect;
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const id = this.getAttribute('data-block-id');
    if (id === String(bloecke.a.id)) return alsDomRect(RECHTECK_A);
    if (id === String(bloecke.b.id)) return alsDomRect(RECHTECK_B);
    if (this.getAttribute('data-lfh') === 'schichtplan-person') return alsDomRect(RECHTECK_PERSON);
    // dnd-kit misst den Schatten am ersten Kind seiner festen Hülle.
    const fest = [this, this.parentElement].find(
      (e): e is HTMLElement => e instanceof HTMLElement && e.style.position === 'fixed',
    );
    if (fest)
      return alsDomRect({
        left: parseFloat(fest.style.left),
        top: parseFloat(fest.style.top),
        width: parseFloat(fest.style.width),
        height: parseFloat(fest.style.height),
      });
    return echt.call(this);
  });
}

const zeiger = { pointerType: 'mouse', isPrimary: true, button: 0, pointerId: 1 };

/** Zieht einen Block im Raster waagerecht um `dx` px; mit `ctrlKey` als Kopie. */
function zieheBlock(block: HTMLElement, dx: number, tasten: { ctrlKey?: boolean } = {}) {
  const x = RECHTECK_A.left + RECHTECK_A.width / 2;
  fireEvent.pointerDown(block, { ...zeiger, ...tasten, clientX: x, clientY: 15 });
  fireEvent.pointerMove(document, { ...zeiger, ...tasten, clientX: x + dx, clientY: 15 });
  fireEvent.pointerUp(document, { ...zeiger, ...tasten, clientX: x + dx, clientY: 15 });
}

/** Pixel je Stunde des Rasters, aus der Breite von Block A. */
function pxJeStunde(block: HTMLElement, a: PlanEditorBlock): number {
  return parseFloat(block.style.width) / ((a.bis - a.von) / STUNDE);
}

/** Texte der Live-Regionen (die Ansagen beim Ziehen stehen in einer davon). */
const ansagen = () => screen.getAllByRole('status').map((s) => s.textContent ?? '');

// ── Der Satz ─────────────────────────────────────────────────────────────────────────────────

export function planEditorFaelle(h: PlanEditorHuelle): void {
  const { a, b } = h.bloecke;
  const raster = () => screen.findByRole('region', { name: h.beschriftung });
  const blockA = async () => within(await raster()).findByRole('button', { name: /^RTW 1 / });
  const blockB = async () => within(await raster()).findByRole('button', { name: /^RTW 2 / });
  /** Die Body-Felder der Kopie von A an `von`/`bis` (Soll mit, Notiz nie). */
  const kopieVonA = (von: number, bis: number, mitPersonen: boolean) => ({
    ...h.postenRtw1,
    von: wire(von),
    bis: wire(bis),
    soll_anzahl: 2,
    quali_soll: null,
    ...(mitPersonen ? { personen: h.personenA } : {}),
  });

  let rechtecke: ReturnType<typeof stelleRechtecke> | null = null;
  beforeEach(() => {
    setzeViewportBreite(1440);
    h.api.load.mockResolvedValue(h.stand());
    h.api.create.mockResolvedValue(h.stand());
    h.api.update.mockResolvedValue(h.stand());
    h.api.delete.mockResolvedValue(undefined);
    h.api.erzeugen.mockResolvedValue(h.stand());
  });
  afterEach(() => {
    rechtecke?.mockRestore();
    rechtecke = null;
  });

  describe('Zug eines Blocks', () => {
    it('Verschieben um eine Stunde schickt Version, Beginn und Ende, keinen Posten', async () => {
      h.zeige();
      const block = await blockA();
      rechtecke = stelleRechtecke(h.bloecke);
      zieheBlock(block, pxJeStunde(block, a));
      await waitFor(() => expect(h.api.update).toHaveBeenCalledTimes(1));
      expect(h.api.update).toHaveBeenCalledWith(h.planId, a.id, {
        version: a.version,
        von: wire(a.von + STUNDE),
        bis: wire(a.bis + STUNDE),
      });
      expect(h.api.create).not.toHaveBeenCalled();
    });

    it('ein abgelehnter Zug steht über dem Raster als Fehler der Hülle', async () => {
      h.api.update.mockRejectedValue(new ApiError(409, 'Der Block wurde inzwischen geändert'));
      h.zeige();
      const block = await blockA();
      rechtecke = stelleRechtecke(h.bloecke);
      zieheBlock(block, pxJeStunde(block, a));
      expect(await screen.findByText(h.fehlerTitel)).toBeInTheDocument();
      expect(screen.getByText('Der Block wurde inzwischen geändert')).toBeInTheDocument();
    });
  });

  describe('Kopie eines Blocks', () => {
    for (const v of h.kopieVarianten) {
      it(`Strg-Zug kopiert an die neue Zeit, ${v.mitPersonen ? 'mit' : 'ohne'} Personen (${v.titel})`, async () => {
        h.zeige({ personalGesperrt: v.personalGesperrt });
        const block = await blockA();
        rechtecke = stelleRechtecke(h.bloecke);
        zieheBlock(block, 3 * pxJeStunde(block, a), { ctrlKey: true });
        await waitFor(() => expect(h.api.create).toHaveBeenCalledTimes(1));
        expect(h.api.create).toHaveBeenCalledWith(
          h.planId,
          kopieVonA(a.von + 3 * STUNDE, a.bis + 3 * STUNDE, v.mitPersonen),
        );
        expect(h.api.update).not.toHaveBeenCalled();
      });
    }

    it('„Als nächsten Block kopieren“ im Dialog legt den Folgeblock ohne Personen an', async () => {
      h.zeige();
      await userEvent.click(await blockA());
      const dialog = await screen.findByRole('dialog', { name: 'Block RTW 1' });
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Als nächsten Block kopieren' }),
      );
      await waitFor(() => expect(h.api.create).toHaveBeenCalledTimes(1));
      expect(h.api.create).toHaveBeenCalledWith(
        h.planId,
        kopieVonA(a.bis, a.bis + (a.bis - a.von), false),
      );
    });

    it('„Als nächsten Block kopieren“ im Kontextmenü kopiert ohne Personen und meldet es', async () => {
      h.zeige();
      const menue = await oeffneKontextmenue(await blockA());
      await userEvent.click(
        within(menue).getByRole('menuitem', { name: 'Als nächsten Block kopieren' }),
      );
      await waitFor(() => expect(h.api.create).toHaveBeenCalledTimes(1));
      expect(h.api.create).toHaveBeenCalledWith(
        h.planId,
        kopieVonA(a.bis, a.bis + (a.bis - a.von), false),
      );
      expect(await screen.findByText('Block kopiert')).toBeInTheDocument();
    });
  });

  describe('Löschen', () => {
    it('ein Löschen aus dem Kontextmenü schließt nicht den inzwischen offenen Dialog eines anderen Blocks', async () => {
      let loese: (v: unknown) => void = () => {};
      h.api.delete.mockImplementationOnce(
        () =>
          new Promise((r) => {
            loese = r;
          }),
      );
      h.zeige();
      const menue = await oeffneKontextmenue(await blockA());
      await userEvent.click(within(menue).getByRole('menuitem', { name: 'Block löschen …' }));
      const rueckfrage = await screen.findByRole('dialog', { name: 'Block löschen?' });
      await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Block löschen' }));
      await waitFor(() => expect(h.api.delete).toHaveBeenCalledWith(h.planId, a.id, a.version));

      // Während das Löschen läuft, öffnet der Dialog von B.
      fireEvent.click(await blockB());
      const dialogB = await screen.findByRole('dialog', { name: 'Block RTW 2' });
      const ladungen = h.api.load.mock.calls.length;
      h.api.load.mockResolvedValue(h.stand({ ohne: [a.id] }));
      loese(undefined);
      // Der Plan wird neu geholt; B bleibt offen.
      await waitFor(() => expect(h.api.load.mock.calls.length).toBeGreaterThan(ladungen));
      await waitFor(() =>
        expect(
          within(screen.getByRole('region', { name: h.beschriftung })).queryByRole('button', {
            name: /^RTW 1 /,
          }),
        ).toBeNull(),
      );
      expect(dialogB).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Block RTW 2' })).toBe(dialogB);
    });

    it('Löschen im Dialog löscht mit Version und schließt diesen Dialog', async () => {
      h.zeige();
      await userEvent.click(await blockB());
      const dialog = await screen.findByRole('dialog', { name: 'Block RTW 2' });
      h.api.load.mockResolvedValue(h.stand({ ohne: [b.id] }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Block löschen' }));
      const rueckfrage = await waitFor(() => {
        const p = document.querySelector<HTMLElement>('.ant-popconfirm');
        expect(p).not.toBeNull();
        return p!;
      });
      await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Block löschen' }));
      await waitFor(() => expect(h.api.delete).toHaveBeenCalledWith(h.planId, b.id, b.version));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Block RTW 2' })).toBeNull());
    });
  });

  describe('Schichten erzeugen', () => {
    it('schickt Posten, Zeitraum und Länge und meldet die Zahl der neuen Schichten', async () => {
      h.api.erzeugen.mockResolvedValue(h.stand({ neu: 2 }));
      h.zeige();
      await blockA();
      const knopf = screen.getByRole('button', { name: 'Schichten erzeugen' });
      await waitFor(() => expect(knopf).toBeEnabled());
      await userEvent.click(knopf);
      const dialog = await screen.findByRole('dialog', { name: 'Schichten erzeugen' });
      await waehle('Posten', 'RTW 1 · Nord');
      await userEvent.type(within(dialog).getByPlaceholderText('Beginn'), '12.06.27 08:00');
      await userEvent.type(within(dialog).getByPlaceholderText('Ende'), '12.06.27 16:00');
      await userEvent.type(within(dialog).getByLabelText('Länge je Schicht'), '4 h');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Schichten erzeugen' }));
      await waitFor(() => expect(h.api.erzeugen).toHaveBeenCalledTimes(1));
      expect(h.api.erzeugen).toHaveBeenCalledWith(h.planId, {
        ...h.postenRtw1,
        von: '2027-06-12 06:00:00',
        bis: '2027-06-12 14:00:00',
        laenge_minuten: 240,
      });
      expect(await screen.findByText('2 Schichten erzeugt')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Schichten erzeugen' })).toBeNull(),
      );
    });
  });

  describe('Person auf einen Block ziehen, mit Ansagen', () => {
    async function fassePerson() {
      const leiste = await screen.findByRole('complementary', { name: 'Personen zum Einteilen' });
      const person = await within(leiste).findByText(PERSON);
      await blockB();
      rechtecke = stelleRechtecke(h.bloecke);
      const zeile = person.closest<HTMLElement>('[data-lfh="schichtplan-person"]')!;
      const start = { clientX: 10, clientY: 110 };
      fireEvent.pointerDown(zeile, { ...zeiger, ...start });
      fireEvent.pointerMove(document, { ...zeiger, clientX: 30, clientY: 110 });
      await waitFor(() => expect(ansagen()).toContain(`${PERSON} gefasst.`));
    }

    it('über Block B und losgelassen: Ansagen nennen den Block, die Person wird eingeteilt', async () => {
      h.zeige();
      await fassePerson();
      fireEvent.pointerMove(document, { ...zeiger, clientX: 410, clientY: 110 });
      await waitFor(() =>
        expect(ansagen()).toContainEqual(
          expect.stringMatching(
            new RegExp(`^${PERSON} über Block RTW 2 \\d\\d:?\\d\\d–\\d\\d:?\\d\\d\\.$`),
          ),
        ),
      );
      fireEvent.pointerUp(document, { ...zeiger, clientX: 410, clientY: 110 });
      await waitFor(() =>
        expect(ansagen()).toContainEqual(
          expect.stringMatching(new RegExp(`^${PERSON} in Block RTW 2 .+ eingeteilt\\.$`)),
        ),
      );
      await waitFor(() => expect(h.api.update).toHaveBeenCalledTimes(1));
      expect(h.api.update).toHaveBeenCalledWith(h.planId, b.id, {
        version: b.version,
        personen: [PERSON_EINGABE],
      });
    });

    it('neben jedem Block losgelassen: die Ansage sagt, dass nichts geändert ist', async () => {
      h.zeige();
      await fassePerson();
      fireEvent.pointerMove(document, { ...zeiger, clientX: 10, clientY: 400 });
      fireEvent.pointerUp(document, { ...zeiger, clientX: 10, clientY: 400 });
      await waitFor(() => expect(ansagen()).toContain(`${PERSON} losgelassen, nichts geändert.`));
      expect(h.api.update).not.toHaveBeenCalled();
    });

    it('Escape bricht das Ziehen ab und sagt es an', async () => {
      h.zeige();
      await fassePerson();
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      await waitFor(() => expect(ansagen()).toContain(`Ziehen von ${PERSON} abgebrochen.`));
      expect(h.api.update).not.toHaveBeenCalled();
    });
  });
}
