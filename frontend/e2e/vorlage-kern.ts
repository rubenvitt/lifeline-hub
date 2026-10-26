import { expect, type Page } from '@playwright/test';

/**
 * Eine Einheiten-Vorlage über die API (LLH-1049), geteilt von `einheit-aus-vorlage.spec.ts` und
 * den Layout-Gates. Das e2e-Backend läuft ohne Demo-Daten, deshalb sät jeder Lauf seinen eigenen
 * „Sanitätszug“: Zug mit ELW, darunter eine Staffel mit zwei RTW, Besatzung auf den Fahrzeugen
 * und eine Kraft ohne Fahrzeug. Vorlagen und Stammdaten gelten für die ganze Organisation; der
 * Zeitstempel trennt parallele Läufe.
 */
export interface GesaeteVorlage {
  vorlageId: number;
  staffelId: number;
  /** Stamm-IDs der Fahrzeuge, für weitere Zuordnungen (LLH-1261). */
  fahrzeugIds: { elw: number; rtw1: number; rtw2: number };
  zug: string;
  staffel: string;
  fahrzeuge: { elw: string; rtw1: string; rtw2: string };
  personen: { fuehrer: string; anna: string; bert: string; cleo: string; dirk: string };
}

export async function seedeVorlage(page: Page, kennung = ''): Promise<GesaeteVorlage> {
  const marke = `${kennung}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const json = async (methode: 'post' | 'put', pfad: string, data: unknown) => {
    const antwort = await page.request[methode](pfad, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  const typen = (await (await page.request.get('/api/einheit-typen')).json()) as {
    id: number;
    label: string;
  }[];
  const typ = (label: string) => (typen.find((t) => t.label === label) ?? typen[0]).id;

  const fahrzeuge = {
    elw: `ELW 1 Musterstadt ${marke}`,
    rtw1: `RTW 1 Musterstadt ${marke}`,
    rtw2: `RTW 2 Musterstadt ${marke}`,
  };
  const fz: Record<keyof typeof fahrzeuge, number> = { elw: 0, rtw1: 0, rtw2: 0 };
  for (const [k, funkrufname] of Object.entries(fahrzeuge) as [keyof typeof fahrzeuge, string][]) {
    fz[k] = (await json('post', '/api/fahrzeuge', { funkrufname, fahrzeugtyp: 'RTW' })).id;
  }
  const personen = {
    fuehrer: `Zugführer-Musterstadt, Zora ${marke}`,
    anna: `Arndt, Anna ${marke}`,
    bert: `Brandt, Bert ${marke}`,
    cleo: `Cramer, Cleo ${marke}`,
    dirk: `Dahl, Dirk ${marke}`,
  };
  const ps: Record<keyof typeof personen, number> = {
    fuehrer: 0,
    anna: 0,
    bert: 0,
    cleo: 0,
    dirk: 0,
  };
  for (const [k, name] of Object.entries(personen) as [keyof typeof personen, string][]) {
    ps[k] = (await json('post', '/api/personal', { name })).id;
  }

  const zug = `Sanitätszug Musterstadt ${marke}`;
  const staffel = `Rettungsstaffel ${marke}`;
  const zugId = (await json('post', '/api/einheit-vorlagen', { name: zug, typ_id: typ('Zug') })).id;
  const staffelId = (
    await json('post', '/api/einheit-vorlagen', {
      name: staffel,
      typ_id: typ('Staffel'),
      ueber_vorlage_id: zugId,
    })
  ).id;
  await json('put', `/api/einheit-vorlagen/${zugId}/fahrzeuge`, { fahrzeug_ids: [fz.elw] });
  await json('put', `/api/einheit-vorlagen/${zugId}/personal`, {
    personal: [{ personal_id: ps.fuehrer, fahrzeug_id: fz.elw, staerke_position: 'fuehrer' }],
  });
  await json('put', `/api/einheit-vorlagen/${staffelId}/fahrzeuge`, {
    fahrzeug_ids: [fz.rtw1, fz.rtw2],
  });
  await json('put', `/api/einheit-vorlagen/${staffelId}/personal`, {
    personal: [
      { personal_id: ps.anna, fahrzeug_id: fz.rtw1 },
      { personal_id: ps.bert, fahrzeug_id: fz.rtw1 },
      { personal_id: ps.cleo, fahrzeug_id: fz.rtw2 },
      { personal_id: ps.dirk },
    ],
  });
  return {
    vorlageId: zugId,
    staffelId,
    fahrzeugIds: fz,
    zug,
    staffel,
    fahrzeuge,
    personen,
  };
}

/** Material der gesäten Staffel (LLH-1261): Wolldecken an der Einheit, ein Rucksack auf RTW 1. */
export interface GesaetesMaterial {
  decken: string;
  rucksack: string;
}

export async function seedeVorlagenMaterial(
  page: Page,
  v: GesaeteVorlage,
): Promise<GesaetesMaterial> {
  const marke = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const material = { decken: `Wolldecke ${marke}`, rucksack: `Sanitätsrucksack ${marke}` };
  const anlegen = async (bezeichnung: string, art: string) => {
    const antwort = await page.request.post('/api/material', { data: { bezeichnung, art } });
    expect(antwort.ok(), `Seeding Material: ${antwort.status()}`).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const decken = await anlegen(material.decken, 'verbrauchsgut');
  const rucksack = await anlegen(material.rucksack, 'geraet');
  const antwort = await page.request.put(`/api/einheit-vorlagen/${v.staffelId}/material`, {
    data: {
      material: [
        { material_id: decken, menge: 50 },
        { material_id: rucksack, menge: 1, fahrzeug_id: v.fahrzeugIds.rtw1 },
      ],
    },
  });
  expect(antwort.ok(), `Seeding Vorlagen-Material: ${antwort.status()}`).toBeTruthy();
  return material;
}
