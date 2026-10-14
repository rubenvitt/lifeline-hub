import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { listeVon, oeffne, optionenVon, waehle } from '../test/auswahlListe';
import { ApiError } from '../api/client';
import type { Einheit, Uhs } from '../api/types';
import MaterialOrt, {
  ortFilter,
  ortSuchText,
  type MaterialOrtKontext,
  type MaterialOrtProps,
} from './MaterialOrt';
import { buildEinheitOptions } from './kraeftebaumKern';

const einheiten = [
  { id: 1, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null },
  { id: 2, name: 'Staffel B', ueber_einheit_id: null, abschnitt_id: null },
  { id: 3, name: 'Rettungsstaffel', ueber_einheit_id: null, abschnitt_id: null },
] as Einheit[];
const uhsListe = [
  { id: 7, bezeichnung: 'Turnhalle', status: 'aktiv' },
  { id: 8, bezeichnung: 'UHS Schule', status: 'geplant' },
  { id: 9, bezeichnung: 'Zelt Nord', status: 'aufgeloest' },
] as Uhs[];

function kontext(
  p: {
    einheit?: Partial<MaterialOrtKontext['einheit']>;
    uhs?: Partial<MaterialOrtKontext['uhs']>;
  } = {},
): MaterialOrtKontext {
  return {
    einsatzId: 1,
    einheit: {
      lesbar: true,
      bedienbar: true,
      optionen: buildEinheitOptions(einheiten, []),
      name: (id) => einheiten.find((e) => e.id === id)?.name,
      ...p.einheit,
    },
    uhs: {
      lesbar: true,
      bedienbar: true,
      liste: uhsListe,
      ...p.uhs,
    },
    fahrzeug: { lesbar: true, name: (id) => (id === 4 ? 'Florian 1/83-1' : undefined) },
    bereitstellungsraum: { lesbar: true, name: (id) => (id === 6 ? 'BR Nord' : undefined) },
  };
}

function zeige(p: Partial<MaterialOrtProps> = {}) {
  const onEinheit = p.onEinheit ?? vi.fn().mockResolvedValue(undefined);
  const onUhs = p.onUhs ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <MaterialOrt
      kennung="Wolldecke"
      ort={null}
      kontext={kontext()}
      darfSchreiben={false}
      {...p}
      onEinheit={onEinheit}
      onUhs={onUhs}
    />,
  );
  return { onEinheit, onUhs };
}

describe('MaterialOrt (LLH-1093, design.md D1–D3; LLH-1224 ein Ort)', () => {
  it('zeigt den einen Ort; die Namen führen in ihr Modul', () => {
    zeige({ ort: { art: 'einheit', id: 3 }, darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^Rettungsstaffel$/);
    expect(screen.getByRole('link', { name: 'Rettungsstaffel' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/3',
    );
    expect(ortSuchText({ einheit_id: 3 }, kontext())).toBe('Rettungsstaffel');
  });

  it('eine UHS steht als „UHS Turnhalle“ mit Sprung', () => {
    zeige({ ort: { art: 'uhs', id: 7 }, darfSchreiben: false });
    expect(screen.getByRole('link', { name: 'UHS Turnhalle' })).toHaveAttribute(
      'href',
      '/einsaetze/1/unfallhilfsstellen/7',
    );
    expect(ortSuchText({ uhs_id: 7 }, kontext())).toBe('UHS Turnhalle');
  });

  it('Fahrzeug und Bereitstellungsraum stehen mit Namen, kein Strich (Spec material-liste)', () => {
    zeige({ ort: { art: 'fahrzeug', id: 4 }, darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^Florian 1\/83-1$/);
    expect(ortSuchText({ br_id: 6 }, kontext())).toBe('BR Nord');
    expect(ortSuchText({ br_id: 6 }, { ...kontext(), bereitstellungsraum: undefined })).toBe(
      'zugeordnet',
    );
  });

  it('eine UHS, die schon „UHS“ heißt, bekommt das Wort nicht doppelt', () => {
    zeige({ ort: { art: 'uhs', id: 8 }, darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^UHS Schule$/);
  });

  it('ohne Leserecht auf Einheiten steht „zugeordnet“, nie ein Strich', () => {
    zeige({
      ort: { art: 'einheit', id: 3 },
      darfSchreiben: true,
      kontext: kontext({
        einheit: { lesbar: false, bedienbar: false, optionen: [], name: () => undefined },
      }),
    });
    const ort = screen.getByTestId('material-ort');
    expect(ort).toHaveTextContent('zugeordnet');
    expect(ort).not.toHaveTextContent('—');
    expect(screen.queryByRole('link')).toBeNull();
    expect(ortSuchText({ einheit_id: 3 }, kontext({ einheit: { lesbar: false } }))).toBe(
      'zugeordnet',
    );
  });

  it('ohne Ort und ohne Schreibrecht: „ohne Ort“, kein Strich', () => {
    zeige({ darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^ohne Ort$/);
  });

  it('leer und bedienbar: je Teil die Aufforderung mit Zeilenkennung', () => {
    zeige({ darfSchreiben: true });
    expect(screen.getByRole('button', { name: 'Einheit zu Wolldecke eintragen' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'UHS zu Wolldecke eintragen' })).toBeVisible();
  });

  it('Einheiten-Modul gesperrt: der Einheit-Teil ist nur lesbar, der UHS-Teil bedienbar', () => {
    zeige({
      ort: { art: 'einheit', id: 3 },
      darfSchreiben: true,
      kontext: kontext({ einheit: { bedienbar: false } }),
    });
    expect(screen.queryByRole('button', { name: /Einheit zu Wolldecke/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Rettungsstaffel' })).toBeInTheDocument();
    // Der Posten liegt an der Einheit, also an keiner UHS: der UHS-Teil ist leer, aber bedienbar.
    expect(screen.getByRole('button', { name: 'UHS zu Wolldecke eintragen' })).toBeVisible();
  });

  it('Umhängen: die Einheit übergibt neu und alt erst mit „Speichern“, die UHS bleibt unberührt', async () => {
    const { onEinheit, onUhs } = zeige({ ort: { art: 'einheit', id: 1 }, darfSchreiben: true });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Wolldecke bearbeiten' }));
    await waehle('Einheit zu Wolldecke', 'Staffel B');
    expect(onEinheit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Wolldecke speichern' }));
    await waitFor(() => expect(onEinheit).toHaveBeenCalledWith(2, 1));
    expect(onUhs).not.toHaveBeenCalled();
  });

  it('die Einheit-Wahl gliedert nach Abschnitt, „keine Einheit“ bleibt erste Wahl', async () => {
    const mitAbschnitt = [
      {
        id: 1,
        name: 'Staffel A',
        ueber_einheit_id: null,
        abschnitt_id: 5,
        abschnitt_name: 'EA Nord',
      },
      { id: 2, name: 'Staffel B', ueber_einheit_id: null, abschnitt_id: null },
    ] as Einheit[];
    const { onEinheit } = zeige({
      ort: { art: 'einheit', id: 1 },
      darfSchreiben: true,
      kontext: kontext({ einheit: { optionen: buildEinheitOptions(mitAbschnitt, []) } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Wolldecke bearbeiten' }));
    await oeffne('Einheit zu Wolldecke');
    const gruppen = listeVon('Einheit zu Wolldecke')!.querySelectorAll('.ant-select-item-group');
    expect([...gruppen].map((g) => g.textContent)).toEqual(['EA Nord', 'ohne Abschnitt']);
    expect(optionenVon('Einheit zu Wolldecke')).toEqual([
      'keine Einheit',
      'Staffel A',
      'Staffel B',
    ]);
    await waehle('Einheit zu Wolldecke', 'keine Einheit');
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Wolldecke speichern' }));
    await waitFor(() => expect(onEinheit).toHaveBeenCalledWith(null, 1));
  });

  it('die UHS-Wahl bietet geplante und aktive UHS und „keine UHS“, keine aufgelöste', async () => {
    const { onUhs } = zeige({ ort: { art: 'uhs', id: 7 }, darfSchreiben: true });
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke bearbeiten' }));
    await oeffne('UHS zu Wolldecke');
    expect(optionenVon('UHS zu Wolldecke')).toEqual(['keine UHS', 'UHS Turnhalle', 'UHS Schule']);
    await waehle('UHS zu Wolldecke', 'keine UHS');
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke speichern' }));
    await waitFor(() => expect(onUhs).toHaveBeenCalledWith(null));
  });

  it('eine aufgelöste UHS am Posten steht als gesperrte Option vorn, mit Namen statt ID', async () => {
    zeige({ ort: { art: 'uhs', id: 9 }, darfSchreiben: true });
    expect(screen.getByRole('button', { name: 'UHS zu Wolldecke bearbeiten' })).toHaveTextContent(
      'UHS Zelt Nord',
    );
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke bearbeiten' }));
    await oeffne('UHS zu Wolldecke');
    expect(optionenVon('UHS zu Wolldecke')).toEqual([
      'UHS Zelt Nord',
      'keine UHS',
      'UHS Turnhalle',
      'UHS Schule',
    ]);
    expect(optionenVon('UHS zu Wolldecke', '-disabled')).toEqual(['UHS Zelt Nord']);
    const auswahl = screen
      .getByRole('combobox', { name: 'UHS zu Wolldecke' })
      .closest('.ant-select')
      ?.querySelector('.ant-select-content');
    expect(auswahl).toHaveTextContent('UHS Zelt Nord');
    expect(auswahl?.textContent).not.toBe('9');
  });

  it('eine nicht gelistete UHS heißt in der Auswahl „zugeordnet“, gesperrt', async () => {
    zeige({ ort: { art: 'uhs', id: 42 }, darfSchreiben: true });
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke bearbeiten' }));
    await oeffne('UHS zu Wolldecke');
    expect(optionenVon('UHS zu Wolldecke', '-disabled')).toEqual(['zugeordnet']);
  });

  it('eine Ablehnung steht am Teil', async () => {
    const onUhs = vi.fn().mockRejectedValue(new ApiError(422, 'UHS ist aufgelöst'));
    zeige({ ort: null, darfSchreiben: true, onUhs });
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke eintragen' }));
    await waehle('UHS zu Wolldecke', 'UHS Turnhalle');
    await userEvent.click(screen.getByRole('button', { name: 'UHS zu Wolldecke speichern' }));
    expect(await screen.findByText(/UHS ist aufgelöst/)).toBeInTheDocument();
  });

  it('der Filter kennt „ohne Ort“ und je Ort einen Wert; ein Posten trifft genau einen', () => {
    const k = kontext();
    const posten = [
      { einheit_id: 3 },
      { einheit_id: null, uhs_id: null },
      { einheit_id: 1 },
      { uhs_id: 7 },
      { einsatz_fahrzeug_id: 4 },
      { br_id: 6 },
    ];
    const filter = ortFilter(posten, k);
    expect(filter.werte.map((w) => w.text)).toEqual([
      'ohne Ort',
      'Rettungsstaffel',
      'Staffel A',
      'Florian 1/83-1',
      'UHS Turnhalle',
      'BR Nord',
    ]);
    for (const p of posten) {
      const treffer = filter.werte.filter((w) => filter.trifft(p, w.value));
      expect(treffer, JSON.stringify(p)).toHaveLength(1);
    }
    const wert = (text: string) => filter.werte.find((w) => w.text === text)!.value;
    expect(filter.trifft(posten[0], wert('Rettungsstaffel'))).toBe(true);
    expect(filter.trifft(posten[1], wert('ohne Ort'))).toBe(true);
    expect(filter.trifft(posten[3], wert('UHS Turnhalle'))).toBe(true);
  });

  it('ohne Leserecht fasst ein Wert „Einheit zugeordnet“ alle Einheiten zusammen', () => {
    const k = kontext({ einheit: { lesbar: false } });
    const filter = ortFilter([{ einheit_id: 3 }, { einheit_id: 1 }], k);
    expect(filter.werte.map((w) => w.text)).toEqual(['ohne Ort', 'Einheit zugeordnet']);
    expect(filter.trifft({ einheit_id: 1 }, 'einheit:*')).toBe(true);
  });
});
