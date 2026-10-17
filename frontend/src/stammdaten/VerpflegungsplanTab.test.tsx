import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { VerpflegungVorlage } from '../api/types';
import { VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import { adminFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { mahlzeit, verpflegungsplan } from '../test/verpflegungVorlageDaten';
import VerpflegungsplanTab from './VerpflegungsplanTab';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

interface Anfrage {
  methode: string;
  pfad: string;
  body: unknown;
}

/** Liefert den Plan und schreibt jede Schreibanfrage mit; `antwort` ersetzt die 200/201. */
function render(
  benutzer: typeof admin,
  plan: VerpflegungVorlage[] = verpflegungsplan(),
  antwort?: () => Response,
) {
  const anfragen: Anfrage[] = [];
  const lesen: string[] = [];
  const schreib = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    anfragen.push({ methode: request.method, pfad: url.pathname, body: await request.json() });
    return antwort
      ? antwort()
      : HttpResponse.json(plan[0], { status: request.method === 'POST' ? 201 : 200 });
  };
  server.use(
    meHandler(benutzer),
    http.get('/api/verpflegung-vorlagen', ({ request }) => {
      lesen.push(new URL(request.url).search);
      return HttpResponse.json(plan);
    }),
    http.post('/api/verpflegung-vorlagen', schreib),
    http.patch('/api/verpflegung-vorlagen/:id', schreib),
  );
  const user = userEvent.setup();
  renderMitProviders(<VerpflegungsplanTab />);
  return { anfragen, lesen, user };
}

/** Die Zeile einer Mahlzeit (Leitspalte trägt die Bezeichnung). */
async function zeile(bezeichnung: string): Promise<HTMLElement> {
  const zelle = await screen.findByText(bezeichnung);
  return zelle.closest('tr')!;
}

function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('VerpflegungsplanTab (LLH-1058)', () => {
  it('liest auch die deaktivierten und zeigt die Zeiten taktisch, die Nacht mit Folgetag', async () => {
    const plan = [...verpflegungsplan(), mahlzeit({ id: 5, bezeichnung: 'Kaffee', aktiv: false })];
    const { lesen } = render(admin, plan);
    const fruehstueck = await zeile('Frühstück');
    expect(within(fruehstueck).getByText('0630–0800')).toBeInTheDocument();
    expect(within(fruehstueck).getByText('Aktiv')).toBeInTheDocument();
    const nacht = await zeile('Nachtverpflegung');
    expect(within(nacht).getByText('2300–0100')).toBeInTheDocument();
    expect(within(nacht).getByText('+1 Tag')).toBeInTheDocument();
    expect(within(nacht).getByText('kalt')).toBeInTheDocument();
    expect(within(fruehstueck).queryByText('+1 Tag')).toBeNull();
    expect(within(await zeile('Kaffee')).getByText('Inaktiv')).toBeInTheDocument();
    expect(lesen).toContain('?nur_aktive=false');
  });

  it('legt eine Mahlzeit an: die Maske liest 630 und 0800 als 06:30 und 08:00', async () => {
    const { anfragen, user } = render(admin, []);
    await user.click(await screen.findByRole('button', { name: 'Mahlzeit anlegen' }));
    await user.type(within(dialog()).getByLabelText('Bezeichnung'), 'Frühstück');
    await user.type(within(dialog()).getByLabelText('Beginn'), '630');
    await user.type(within(dialog()).getByLabelText('Ende'), '0800');
    await user.click(within(dialog()).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0]).toEqual({
      methode: 'POST',
      pfad: '/api/verpflegung-vorlagen',
      body: { bezeichnung: 'Frühstück', beginn: '06:30', ende: '08:00' },
    });
  });

  it('eine unlesbare Uhrzeit und Ende gleich Beginn stehen am Feld und gehen nicht hinaus', async () => {
    const { anfragen, user } = render(admin, []);
    await user.click(await screen.findByRole('button', { name: 'Mahlzeit anlegen' }));
    await user.type(within(dialog()).getByLabelText('Bezeichnung'), 'Mittag');
    await user.type(within(dialog()).getByLabelText('Beginn'), '6.30');
    await user.type(within(dialog()).getByLabelText('Ende'), '1200');
    await user.click(within(dialog()).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog()).findByText('Uhrzeit wie 0630')).toBeInTheDocument();
    await user.clear(within(dialog()).getByLabelText('Beginn'));
    await user.type(within(dialog()).getByLabelText('Beginn'), '12:00');
    await user.click(within(dialog()).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog()).findByText('Ende gleich Beginn')).toBeInTheDocument();
    expect(anfragen).toHaveLength(0);
  });

  it('ein Ende vor dem Beginn zeigt den Folgetag und wird angelegt', async () => {
    const { anfragen, user } = render(admin, []);
    await user.click(await screen.findByRole('button', { name: 'Mahlzeit anlegen' }));
    await user.type(within(dialog()).getByLabelText('Bezeichnung'), 'Nacht');
    await user.type(within(dialog()).getByLabelText('Beginn'), '2300');
    await user.type(within(dialog()).getByLabelText('Ende'), '0100');
    expect(await within(dialog()).findByText('Ende am Folgetag')).toBeInTheDocument();
    await user.click(within(dialog()).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0].body).toEqual({ bezeichnung: 'Nacht', beginn: '23:00', ende: '01:00' });
  });

  it('eine zu lange Bezeichnung wird nicht gesendet und nicht gekürzt', async () => {
    const { anfragen, user } = render(admin, []);
    await user.click(await screen.findByRole('button', { name: 'Mahlzeit anlegen' }));
    const lang = 'x'.repeat(VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX + 1);
    fireEvent.change(within(dialog()).getByLabelText('Bezeichnung'), { target: { value: lang } });
    await user.type(within(dialog()).getByLabelText('Beginn'), '0630');
    await user.type(within(dialog()).getByLabelText('Ende'), '0800');
    await user.click(within(dialog()).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect((within(dialog()).getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(lang),
    );
    expect(anfragen).toHaveLength(0);
  });

  it('Bearbeiten schickt nur die geänderten Felder; Art leeren schickt null', async () => {
    const { anfragen, user } = render(admin);
    await user.click(within(await zeile('Mittag')).getByRole('button', { name: 'Bearbeiten' }));
    const beginn = within(dialog()).getByLabelText('Beginn') as HTMLInputElement;
    expect(beginn.value).toBe('1200');
    await user.clear(beginn);
    await user.type(beginn, '1130');
    // Art „warm“ leeren über das Löschkreuz der Auswahl.
    const art = within(dialog()).getByLabelText('Art').closest('.ant-select')!;
    await user.hover(art);
    await user.click(art.querySelector('.ant-select-clear')!);
    await user.click(within(dialog()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0]).toEqual({
      methode: 'PATCH',
      pfad: '/api/verpflegung-vorlagen/2',
      body: { beginn: '11:30', verpflegungsart: null },
    });
  });

  it('Deaktivieren und Aktivieren schalten ohne Rückfrage', async () => {
    const plan = [mahlzeit({ id: 1 }), mahlzeit({ id: 5, bezeichnung: 'Kaffee', aktiv: false })];
    const { anfragen, user } = render(admin, plan);
    await user.click(
      within(await zeile('Frühstück')).getByRole('button', { name: 'Deaktivieren' }),
    );
    await user.click(within(await zeile('Kaffee')).getByRole('button', { name: 'Aktivieren' }));
    await waitFor(() => expect(anfragen).toHaveLength(2));
    expect(anfragen).toEqual([
      { methode: 'PATCH', pfad: '/api/verpflegung-vorlagen/1', body: { aktiv: false } },
      { methode: 'PATCH', pfad: '/api/verpflegung-vorlagen/5', body: { aktiv: true } },
    ]);
  });

  it('ein abgelehntes Aktivieren nennt den Grund über der Tabelle', async () => {
    const plan = [mahlzeit({ id: 5, bezeichnung: 'Kaffee', aktiv: false })];
    const { user } = render(admin, plan, () =>
      HttpResponse.json(
        { error: 'Eine aktive Mahlzeit mit dieser Bezeichnung gibt es schon' },
        { status: 409 },
      ),
    );
    await user.click(within(await zeile('Kaffee')).getByRole('button', { name: 'Aktivieren' }));
    expect(
      await screen.findByText('Eine aktive Mahlzeit mit dieser Bezeichnung gibt es schon'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nicht aktiviert')).toBeInTheDocument();
  });

  it('ohne Admin-Recht: Anlegen gesperrt mit Grund, keine Zeilenaktionen', async () => {
    render(nichtAdmin);
    await zeile('Frühstück');
    expect(screen.getByRole('button', { name: 'Mahlzeit anlegen' })).toBeDisabled();
    expect(screen.getByText('Nur Ansicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deaktivieren' })).toBeNull();
  });
});
