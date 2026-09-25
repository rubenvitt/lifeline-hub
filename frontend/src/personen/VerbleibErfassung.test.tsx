import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Betreuungsstelle, ModulOverrides } from '../api/types';
import { server } from '../test/server';
import { einsatzKeys } from '../api/queryKeys';
import { renderMitProviders } from '../test/utils';
import VerbleibErfassung from './VerbleibErfassung';

/**
 * Verbleib-Dialog auf der Erfassungs-Hülle (LFH-674, design.md D6). Die Pure-Kerne
 * (Felder je Art, Vorbelegung, Body) prüft `verbleibErfassungKern.test.ts`; hier geht es um das,
 * was erst das Rendern zeigt: Struktur der Hülle, Feldbudget, die Datenquellen-Grenze zur
 * Betreuung und den tatsächlich gesendeten Body.
 */

const stelle = (teil: Partial<Betreuungsstelle> & { id: number; bezeichnung: string }) =>
  ({
    einsatz_id: 1,
    art: 'notunterkunft',
    status: 'in_betrieb',
    angelegt_at: '2026-09-24 08:00:00',
    ...teil,
  }) as Betreuungsstelle;

const NORD = stelle({ id: 7, bezeichnung: 'NU Turnhalle Nord' });
const SUED = stelle({ id: 8, bezeichnung: 'NU Schule Süd' });

let gesendet: Record<string, unknown>[];
let betreuungAbrufe: number;
let overrides: ModulOverrides;
let postAntwort: () => Response;

beforeEach(() => {
  gesendet = [];
  betreuungAbrufe = 0;
  overrides = {};
  postAntwort = () =>
    HttpResponse.json(
      {
        id: 1,
        einsatz_id: 1,
        person_id: 2,
        art: 'notunterkunft',
        zeitpunkt_at: '',
        erfasst_von: 1,
      },
      { status: 201 },
    );
  server.use(
    http.get('/api/auth/me', () =>
      HttpResponse.json({
        id: 1,
        anzeigename: 'F',
        benutzername: 'f',
        system_rolle: 'keiner',
        org_rolle: 'fuehrungskraft',
      }),
    ),
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json(overrides)),
    http.get('/api/einsaetze/1/betreuung', () => {
      betreuungAbrufe += 1;
      return HttpResponse.json({ bezirke: [], stellen: [NORD, SUED] });
    }),
    http.post('/api/einsaetze/1/personen/2/verbleib', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return postAntwort();
    }),
  );
});

function zeige() {
  const onErfasst = vi.fn();
  const onSchliessen = vi.fn();
  const r = renderMitProviders(
    <VerbleibErfassung
      einsatzId={1}
      personId={2}
      onErfasst={onErfasst}
      onSchliessen={onSchliessen}
    />,
  );
  return { ...r, onErfasst, onSchliessen };
}

type Nutzer = ReturnType<typeof userEvent.setup>;

async function waehle(user: Nutzer, feld: string, eintrag: string) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('combobox', { name: feld }));
  await user.click(await screen.findByTitle(eintrag));
}

const feldZahl = (dialog: HTMLElement) => dialog.querySelectorAll('.ant-form-item').length;

describe('VerbleibErfassung — Hülle und Feldbudget', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Erfassen' }).closest('form')).not.toBeNull();
  });

  it('Transport: höchstens drei sichtbare Felder, die Notiz erst nach dem Aufklappen', async () => {
    const user = userEvent.setup();
    zeige();
    await waehle(user, 'Art', 'Transport');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Transportmittel (RTW/KTW …)')).toBeInTheDocument();
    expect(feldZahl(dialog)).toBe(3);
    expect(within(dialog).queryByLabelText('Notiz')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(within(dialog).getByLabelText('Notiz')).toBeInTheDocument());
    expect(feldZahl(dialog)).toBeGreaterThan(3);
  });

  it('Transportmittel nur beim Transport', async () => {
    const user = userEvent.setup();
    zeige();
    await waehle(user, 'Art', 'Entlassung vor Ort');
    expect(screen.queryByLabelText('Transportmittel (RTW/KTW …)')).not.toBeInTheDocument();
  });
});

describe('VerbleibErfassung — Betreuungsstelle (LFH-674)', () => {
  it('Notunterkunft: Stelle wählen belegt das Ziel vor und sendet die Kennung mit', async () => {
    const user = userEvent.setup();
    const { onErfasst, onSchliessen } = zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
    expect(screen.getByLabelText('Ziel')).toHaveValue('NU Turnhalle Nord');

    await user.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      art: 'notunterkunft',
      betreuungsstelle_id: 7,
      ziel: 'NU Turnhalle Nord',
    });
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfasst).toHaveBeenCalled();
  });

  it('eigener Text im Ziel bleibt beim Stellenwechsel stehen', async () => {
    const user = userEvent.setup();
    zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    await user.type(screen.getByLabelText('Ziel'), 'Halle 2, Eingang Ost');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
    expect(screen.getByLabelText('Ziel')).toHaveValue('Halle 2, Eingang Ost');
  });

  it('ein Stellenwechsel ersetzt eine unveränderte Vorbelegung', async () => {
    const user = userEvent.setup();
    zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Schule Süd');
    expect(screen.getByLabelText('Ziel')).toHaveValue('NU Schule Süd');
  });

  it('ein Artwechsel weg von der Notunterkunft schickt keinen Verweis mit (sonst 422)', async () => {
    const user = userEvent.setup();
    zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
    await waehle(user, 'Art', 'Transport');
    expect(screen.queryByRole('combobox', { name: 'Betreuungsstelle (optional)' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).not.toHaveProperty('betreuungsstelle_id');
    expect(gesendet[0]).toMatchObject({ art: 'transport', status: 'abtransportiert' });
  });

  /**
   * Widerlegbar gemacht (Review): Solange die Overrides NICHT geladen sind, fehlt die Auswahl
   * ohnehin (Rechte offen = „ausgeblendet"). Die Abwesenheit sagt also erst etwas, wenn die
   * Overrides nachweislich im Cache stehen — und der Gegenfall mit freiem Modul zeigt, dass
   * dieselbe Stelle des Tests die Auswahl sonst findet.
   */
  it.each([
    ['frei', {}, true],
    [
      'ausgeblendet',
      { betreuung: { einsatz_id: 1, modul_key: 'betreuung', sichtbar: false } },
      false,
    ],
  ] as const)(
    'Modul Betreuung %s: Auswahl erst nach geladenen Rechten entschieden',
    async (_, o, erwartet) => {
      const user = userEvent.setup();
      overrides = o as ModulOverrides;
      const { client } = zeige();
      await waehle(user, 'Art', 'Notunterkunft');
      await waitFor(() =>
        expect(client.getQueryState(einsatzKeys.modulOverrides(1))?.status).toBe('success'),
      );
      if (erwartet) {
        expect(
          await screen.findByRole('combobox', { name: 'Betreuungsstelle (optional)' }),
        ).toBeInTheDocument();
        await waitFor(() => expect(betreuungAbrufe).toBe(1));
      } else {
        expect(screen.queryByRole('combobox', { name: 'Betreuungsstelle (optional)' })).toBeNull();
        expect(betreuungAbrufe).toBe(0);
        expect(screen.getByLabelText('Ziel')).toBeInTheDocument();
      }
    },
  );

  /**
   * Das 403 wird angehalten: vorher steht die Auswahl (Client sagt „frei"), danach ist sie
   * weg — ohne Fehlermeldung. Ohne das Anhalten wäre „fehlt" schon vor der Antwort wahr.
   */
  it('ein 403 der Betreuung nimmt die Auswahl weg, ohne Fehler zu melden', async () => {
    const user = userEvent.setup();
    let freigeben!: () => void;
    const gehalten = new Promise<void>((r) => (freigeben = r));
    server.use(
      http.get('/api/einsaetze/1/betreuung', async () => {
        await gehalten;
        return new HttpResponse(null, { status: 403 });
      }),
    );
    zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    expect(
      await screen.findByRole('combobox', { name: 'Betreuungsstelle (optional)' }),
    ).toBeInTheDocument();
    freigeben();
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Betreuungsstelle (optional)' })).toBeNull(),
    );
    expect(screen.queryByText(/konnten nicht geladen werden/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ein anderer Fehler der Betreuung ist ein Ausfall und sagt sich am Feld', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/einsaetze/1/betreuung', () => new HttpResponse(null, { status: 500 })),
    );
    zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    expect(await screen.findByText(/Stellen konnten nicht geladen werden/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ziel')).toBeInTheDocument();
  });

  it('Artwechsel weg von der Notunterkunft leert eine unveränderte Vorbelegung', async () => {
    const user = userEvent.setup();
    zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
    expect(screen.getByLabelText('Ziel')).toHaveValue('NU Turnhalle Nord');
    await waehle(user, 'Art', 'Transport');
    expect(screen.getByLabelText('Ziel')).toHaveValue('');
  });

  it('eine Ablehnung steht im Dialog, die Felder bleiben stehen', async () => {
    const user = userEvent.setup();
    postAntwort = () =>
      HttpResponse.json({ error: 'Die Betreuungsstelle ist storniert' }, { status: 409 });
    const { onSchliessen } = zeige();
    await waehle(user, 'Art', 'Notunterkunft');
    await waehle(user, 'Betreuungsstelle (optional)', 'NU Turnhalle Nord');
    await user.click(screen.getByRole('button', { name: 'Erfassen' }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Verbleib nicht erfasst')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Ziel')).toHaveValue('NU Turnhalle Nord');
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});
