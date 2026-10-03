import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import PersonAnhaenge from './PersonAnhaenge';

const PFAD = '/api/einsaetze/1/personen/10/anhaenge';
const PERSON = { id: 10, registrier_nr: 7, storniert_at: null };

// Die Paneel-Form deckt `pages/schaeden/SchadenAnhaenge.test.tsx` ab; hier die Hülle
// „abschnitt“ des Bausteins `ErfassungsAnhaenge` an der Person.
describe('PersonAnhaenge (LFH-757)', () => {
  it('rendert ohne eigenes Paneel, „Datei ablegen“ über der Liste, Kennung im Namen', async () => {
    server.use(
      http.get(PFAD, () =>
        HttpResponse.json([
          {
            id: 5,
            dateiname: 'verletzung.jpg',
            mime: 'image/jpeg',
            groesse: 2048,
            abgelegt_von_name: 'Leitung',
            abgelegt_at: '2026-10-02 10:30:00',
          },
        ]),
      ),
    );
    renderMitProviders(<PersonAnhaenge einsatzId={1} person={PERSON} darfSchreiben />);
    const bereich = screen.getByRole('region', { name: 'Fotos und Dateien' });
    const link = await within(bereich).findByRole('link', {
      name: /^verletzung\.jpg, .*Datei von Person R-007 herunterladen$/,
    });
    expect(document.querySelector('[data-lfh="paneel"]')).toBeNull();
    const knopf = within(bereich).getByRole('button', { name: 'Datei ablegen' });
    expect(
      knopf.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
      'der Knopf steht vor der Liste',
    ).toBeTruthy();
    expect(within(bereich).getByText('1 Datei')).toBeInTheDocument();
    expect(link.closest('[data-lfh="person-anhang-zeile"]')).not.toBeNull();
  });

  // LFH-757 × LFH-759: jeder Abruf an der Person ist ein protokollierter Zugriff. Ein
  // Vorschaubild je Zeile schriebe schon beim Aufklappen eine Audit-Zeile je Foto.
  it('kein Vorschaubild, auch nicht an einem Foto', async () => {
    const abrufe: string[] = [];
    server.use(
      http.get(PFAD, () =>
        HttpResponse.json([
          {
            id: 5,
            dateiname: 'verletzung.jpg',
            mime: 'image/jpeg',
            groesse: 2048,
            abgelegt_von_name: 'Leitung',
            abgelegt_at: '2026-10-02 10:30:00',
          },
        ]),
      ),
      http.get(`${PFAD}/5/datei`, ({ request }) => {
        abrufe.push(request.url);
        return new HttpResponse(null, { status: 200 });
      }),
    );
    renderMitProviders(<PersonAnhaenge einsatzId={1} person={PERSON} darfSchreiben />);
    await screen.findByRole('link', { name: /^verletzung\.jpg, / });
    expect(document.querySelector('[data-lfh="download-anker-mit-vorschau"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Vorschau|Großansicht/ })).toBeNull();
    expect(abrufe, 'kein Abruf der Datei ohne Klick').toEqual([]);
  });

  it.each([
    ['ohne Schreibrecht', PERSON, false],
    ['storniert', { ...PERSON, storniert_at: '2026-10-02 10:00:00' }, true],
  ])('%s: weder Ablegen noch Entfernen', async (_fall, person, darfSchreiben) => {
    server.use(http.get(PFAD, () => HttpResponse.json([])));
    renderMitProviders(
      <PersonAnhaenge einsatzId={1} person={person} darfSchreiben={darfSchreiben} />,
    );
    const bereich = screen.getByRole('region', { name: 'Fotos und Dateien' });
    await within(bereich).findByText('Noch keine Fotos oder Dateien');
    expect(within(bereich).queryByRole('button')).toBeNull();
  });
});
