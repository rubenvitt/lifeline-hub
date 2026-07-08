import type {
  Einheit,
  EinsatzPersonal,
  EinsatzFahrzeug,
  EinsatzMaterial,
  Einsatzabschnitt,
  Staerke,
  StatusKategorie,
  StaerkePosition,
  MaterialStatus,
} from '../api/types';

export interface StaerkeSumme {
  fuehrer: number;
  unterfuehrer: number;
  mannschaft: number;
  gesamt: number;
}
export interface StatusVerteilung {
  verfuegbar: number;
  gebunden: number;
  nicht_verfuegbar: number;
  ohne: number;
}
export type ZeilenArt = 'abschnitt' | 'einheit' | 'mittel';
export type MittelArt = 'fahrzeug' | 'person' | 'material';

/** Eine Zeile im Meldebild-Baum (antd-Table `children`-fähig). */
export interface MeldebildZeile {
  key: string;
  art: ZeilenArt;
  mittelArt: MittelArt | null;
  bezeichnung: string;
  detail: string | null;
  staerke: StaerkeSumme;
  soll: StaerkeSumme | null;
  statusKategorie: StatusKategorie | null;
  statusLabel: string | null;
  menge: number | null;
  personalVerteilung: StatusVerteilung | null;
  fahrzeugVerteilung: StatusVerteilung | null;
  children?: MeldebildZeile[];
}

export interface Verdichtung {
  staerke: StaerkeSumme;
  soll: StaerkeSumme | null;
  personalStatus: StatusVerteilung;
  fahrzeugStatus: StatusVerteilung;
  materialStatus: Record<MaterialStatus, number>;
  anzahlPersonal: number;
  anzahlFahrzeuge: number;
  anzahlMaterialPositionen: number;
}

export interface Kraeftebild {
  baum: MeldebildZeile[];
  verdichtung: Verdichtung;
}

export const OHNE_ABSCHNITT_KEY = 'ab-ohne';
export const OHNE_EINHEIT_KEY_PREFIX = 'eh-ohne';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Person ohne Stärke-Position zählt als Mannschaft, damit die Summe der Köpfe
// stets der Personenzahl entspricht (Stärkenachweis-Invariante).
const POS_NULL_FALLBACK: StaerkePosition = 'mannschaft';

const leereStaerke = (): StaerkeSumme => ({
  fuehrer: 0,
  unterfuehrer: 0,
  mannschaft: 0,
  gesamt: 0,
});

const leereVert = (): StatusVerteilung => ({
  verfuegbar: 0,
  gebunden: 0,
  nicht_verfuegbar: 0,
  ohne: 0,
});

function addPosition(s: StaerkeSumme, pos: StaerkePosition | null | undefined): void {
  const k = pos ?? POS_NULL_FALLBACK;
  s[k] += 1;
  s.gesamt += 1;
}

function addStaerke(z: StaerkeSumme, q: StaerkeSumme): void {
  z.fuehrer += q.fuehrer;
  z.unterfuehrer += q.unterfuehrer;
  z.mannschaft += q.mannschaft;
  z.gesamt += q.gesamt;
}

function addKategorie(v: StatusVerteilung, k: StatusKategorie | null | undefined): void {
  if (k === 'verfuegbar') v.verfuegbar++;
  else if (k === 'gebunden') v.gebunden++;
  else if (k === 'nicht_verfuegbar') v.nicht_verfuegbar++;
  else v.ohne++;
}

function addVerteilung(z: StatusVerteilung, q: StatusVerteilung): void {
  z.verfuegbar += q.verfuegbar;
  z.gebunden += q.gebunden;
  z.nicht_verfuegbar += q.nicht_verfuegbar;
  z.ohne += q.ohne;
}

/** Converts a backend Staerke (F/UF/M, no gesamt) to StaerkeSumme. */
function staerkeAusBackend(s: Staerke): StaerkeSumme {
  return {
    fuehrer: s.fuehrer,
    unterfuehrer: s.unterfuehrer,
    mannschaft: s.mannschaft,
    gesamt: s.fuehrer + s.unterfuehrer + s.mannschaft,
  };
}

function addSoll(acc: StaerkeSumme | null, add: StaerkeSumme): StaerkeSumme {
  if (acc === null) return { ...add };
  return {
    fuehrer: acc.fuehrer + add.fuehrer,
    unterfuehrer: acc.unterfuehrer + add.unterfuehrer,
    mannschaft: acc.mannschaft + add.mannschaft,
    gesamt: acc.gesamt + add.gesamt,
  };
}

// ── Core aggregation ──────────────────────────────────────────────────────────

interface EinheitResult {
  zeile: MeldebildZeile;
  gesammeltesSoll: StaerkeSumme | null;
}

/**
 * Build a single Einheit tree node (including child-Einheiten and mittel rows).
 * Returns the completed MeldebildZeile plus the accumulated Soll from this unit
 * and all descendants.
 */
function baueEinheitZeile(
  einheit: Einheit,
  childEinheiten: Einheit[],
  childrenByEinheit: Map<number, Einheit[]>,
  personalByEinheit: Map<number | null, EinsatzPersonal[]>,
  fahrzeugeByEinheit: Map<number | null, EinsatzFahrzeug[]>,
  materialByEinheit: Map<number | null, EinsatzMaterial[]>,
): EinheitResult {
  const staerke = leereStaerke();
  const personalVert = leereVert();
  const fahrzeugVert = leereVert();

  const children: MeldebildZeile[] = [];

  // Personal-Mittel rows for this Einheit
  const ownPersonal = personalByEinheit.get(einheit.id) ?? [];
  for (const ep of ownPersonal) {
    const ps = leereStaerke();
    addPosition(ps, ep.staerke_position);
    addPosition(staerke, ep.staerke_position);
    addKategorie(personalVert, ep.status_kategorie);
    const detail = ep.funktion ?? null;
    children.push({
      key: `ep-${ep.id}`,
      art: 'mittel',
      mittelArt: 'person',
      bezeichnung: ep.name,
      detail,
      staerke: ps,
      soll: null,
      statusKategorie: ep.status_kategorie ?? null,
      statusLabel: ep.status_label ?? null,
      menge: null,
      personalVerteilung: null,
      fahrzeugVerteilung: null,
    });
  }

  // Fahrzeug-Mittel rows
  const ownFahrzeuge = fahrzeugeByEinheit.get(einheit.id) ?? [];
  for (const ef of ownFahrzeuge) {
    addKategorie(fahrzeugVert, ef.status_kategorie);
    children.push({
      key: `ef-${ef.id}`,
      art: 'mittel',
      mittelArt: 'fahrzeug',
      bezeichnung: ef.funkrufname,
      detail: ef.fahrzeugtyp ?? null,
      staerke: leereStaerke(),
      soll: null,
      statusKategorie: ef.status_kategorie ?? null,
      statusLabel: ef.status_label ?? null,
      menge: null,
      personalVerteilung: null,
      fahrzeugVerteilung: null,
    });
  }

  // Material-Mittel rows
  const ownMaterial = materialByEinheit.get(einheit.id) ?? [];
  for (const em of ownMaterial) {
    children.push({
      key: `em-${em.id}`,
      art: 'mittel',
      mittelArt: 'material',
      bezeichnung: em.bezeichnung,
      detail: null,
      staerke: leereStaerke(),
      soll: null,
      statusKategorie: null,
      statusLabel: em.status,
      menge: em.menge,
      personalVerteilung: null,
      fahrzeugVerteilung: null,
    });
  }

  // Recurse into child Einheiten
  let gesammeltesSoll: StaerkeSumme | null = null;
  for (const kindEinheit of childEinheiten) {
    const kindChildren = childrenByEinheit.get(kindEinheit.id) ?? [];
    const kindResult = baueEinheitZeile(
      kindEinheit,
      kindChildren,
      childrenByEinheit,
      personalByEinheit,
      fahrzeugeByEinheit,
      materialByEinheit,
    );
    addStaerke(staerke, kindResult.zeile.staerke);
    addVerteilung(personalVert, kindResult.zeile.personalVerteilung ?? leereVert());
    addVerteilung(fahrzeugVert, kindResult.zeile.fahrzeugVerteilung ?? leereVert());
    if (kindResult.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, kindResult.gesammeltesSoll);
    }
    children.push(kindResult.zeile);
  }

  // Soll for this unit
  const eigenesSoll = einheit.soll != null ? staerkeAusBackend(einheit.soll) : null;
  if (eigenesSoll !== null) {
    gesammeltesSoll = addSoll(gesammeltesSoll, eigenesSoll);
  }

  const detail = [einheit.typ_label, einheit.fuehrer_name].filter(Boolean).join(' · ') || null;

  const zeile: MeldebildZeile = {
    key: `eh-${einheit.id}`,
    art: 'einheit',
    mittelArt: null,
    bezeichnung: einheit.name,
    detail,
    staerke,
    // Bewusst das eigene Soll der Einheit (nicht kumuliert): die UI v1 zeigt am
    // Knoten nur das eigene Soll; das kumulierte Soll fließt in die Verdichtung.
    soll: eigenesSoll,
    statusKategorie: null,
    statusLabel: null,
    menge: null,
    personalVerteilung: personalVert,
    fahrzeugVerteilung: fahrzeugVert,
    children: children.length > 0 ? children : undefined,
  };

  return { zeile, gesammeltesSoll };
}

/**
 * Build a section (Abschnitt) node recursively.
 */
function baueAbschnittZeile(
  abschnitt: Einsatzabschnitt,
  kindAbschnitte: Einsatzabschnitt[],
  abschnittKinderMap: Map<number, Einsatzabschnitt[]>,
  topEinheitenByAbschnitt: Map<number | null, Einheit[]>,
  childrenByEinheit: Map<number, Einheit[]>,
  personalByEinheit: Map<number | null, EinsatzPersonal[]>,
  fahrzeugeByEinheit: Map<number | null, EinsatzFahrzeug[]>,
  materialByEinheit: Map<number | null, EinsatzMaterial[]>,
): { zeile: MeldebildZeile; gesammeltesSoll: StaerkeSumme | null } {
  const staerke = leereStaerke();
  const personalVert = leereVert();
  const fahrzeugVert = leereVert();
  const children: MeldebildZeile[] = [];
  let gesammeltesSoll: StaerkeSumme | null = null;

  // Top-level Einheiten belonging to this Abschnitt
  const topEinheiten = topEinheitenByAbschnitt.get(abschnitt.id) ?? [];
  for (const einheit of topEinheiten) {
    const kindEinheiten = childrenByEinheit.get(einheit.id) ?? [];
    const result = baueEinheitZeile(
      einheit,
      kindEinheiten,
      childrenByEinheit,
      personalByEinheit,
      fahrzeugeByEinheit,
      materialByEinheit,
    );
    addStaerke(staerke, result.zeile.staerke);
    addVerteilung(personalVert, result.zeile.personalVerteilung ?? leereVert());
    addVerteilung(fahrzeugVert, result.zeile.fahrzeugVerteilung ?? leereVert());
    if (result.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
    }
    children.push(result.zeile);
  }

  // Child Abschnitte
  for (const kindAbschnitt of kindAbschnitte) {
    const kindAbschnittKinder = abschnittKinderMap.get(kindAbschnitt.id) ?? [];
    const result = baueAbschnittZeile(
      kindAbschnitt,
      kindAbschnittKinder,
      abschnittKinderMap,
      topEinheitenByAbschnitt,
      childrenByEinheit,
      personalByEinheit,
      fahrzeugeByEinheit,
      materialByEinheit,
    );
    addStaerke(staerke, result.zeile.staerke);
    addVerteilung(personalVert, result.zeile.personalVerteilung ?? leereVert());
    addVerteilung(fahrzeugVert, result.zeile.fahrzeugVerteilung ?? leereVert());
    if (result.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
    }
    children.push(result.zeile);
  }

  const zeile: MeldebildZeile = {
    key: `ab-${abschnitt.id}`,
    art: 'abschnitt',
    mittelArt: null,
    bezeichnung: abschnitt.name,
    detail: null,
    staerke,
    soll: null,
    statusKategorie: null,
    statusLabel: null,
    menge: null,
    personalVerteilung: personalVert,
    fahrzeugVerteilung: fahrzeugVert,
    children: children.length > 0 ? children : undefined,
  };

  return { zeile, gesammeltesSoll };
}

// ── Filter API ────────────────────────────────────────────────────────────────

export interface Rohdaten {
  abschnitte: Einsatzabschnitt[];
  einheiten: Einheit[];
  personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[];
  material: EinsatzMaterial[];
}

export interface FilterWerte {
  abschnittId: number | null;
  traeger: string | null;
  kategorie: StatusKategorie | null;
  suche: string;
}

export function filtereKraefte(roh: Rohdaten, f: FilterWerte): Rohdaten {
  const s = f.suche.trim().toLowerCase();
  const treffer = (txt: (string | null | undefined)[]) => !s || txt.some((t) => t?.toLowerCase().includes(s));
  // v1-Annahme: Untereinheiten tragen die `abschnitt_id` ihrer Elterneinheit. Sonst würden
  // Kräfte einer Untereinheit ohne eigene `abschnitt_id` beim Abschnitts-Filter herausfallen
  // (echtes Sub-Section-roll-in ist v2).
  const einheitErlaubt = (e: Einheit) => f.abschnittId == null || e.abschnitt_id === f.abschnittId;
  const erlaubteEinheiten = new Set(roh.einheiten.filter(einheitErlaubt).map((e) => e.id));
  const abschnittOk = (einheit_id: number | null | undefined) =>
    f.abschnittId == null || (einheit_id != null && erlaubteEinheiten.has(einheit_id));
  const traegerOk = (traeger: string | null | undefined) => !f.traeger || traeger === f.traeger;
  const passt = (einheit_id: number | null | undefined, traeger: string | null | undefined, kat: StatusKategorie | null | undefined, txt: (string | null | undefined)[]) =>
    abschnittOk(einheit_id) && traegerOk(traeger) && (!f.kategorie || kat === f.kategorie) && treffer(txt);
  return {
    abschnitte: f.abschnittId == null ? roh.abschnitte : roh.abschnitte.filter((a) => a.id === f.abschnittId),
    einheiten: roh.einheiten.filter(einheitErlaubt),
    personal: roh.personal.filter((x) => passt(x.einheit_id, x.traegerorganisation, x.status_kategorie, [x.name, x.funktion])),
    fahrzeuge: roh.fahrzeuge.filter((x) => passt(x.einheit_id, x.traegerorganisation, x.status_kategorie, [x.funkrufname, x.fahrzeugtyp])),
    // Material hat keine `status_kategorie` (eigene Achse) → NICHT der Kategorie-Filterung unterwerfen.
    material: roh.material.filter((x) => abschnittOk(x.einheit_id) && traegerOk(x.traegerorganisation) && treffer([x.bezeichnung])),
  };
}

// ── Formatierung ──────────────────────────────────────────────────────────────

/** Formatiert eine Stärke als „F/UF/M//Ges" (BOS-Doppelstrich vor Gesamt; z. B. „1/0/5//6"). */
export function staerkeText(s: StaerkeSumme): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}//${s.gesamt}`;
}

// ── Markdown-Renderer ─────────────────────────────────────────────────────────

function rendereMeldebildZeileMarkdown(zeile: MeldebildZeile, tiefe: number): string {
  const zeilen: string[] = [];

  if (zeile.art === 'abschnitt') {
    // Abschnitte tragen keinen Einzug — die Tiefe steckt in der Heading-Hierarchie (## / ###).
    const prefix = tiefe === 0 ? '##' : '###';
    zeilen.push(`${prefix} ${zeile.bezeichnung}`);
    zeilen.push(`Stärke (F/UF/M//Ges): ${staerkeText(zeile.staerke)}`);
  } else if (zeile.art === 'einheit') {
    const einzug = '  '.repeat(Math.max(0, tiefe - 1));
    const detail = zeile.detail ? ` (${zeile.detail})` : '';
    zeilen.push(`${einzug}- **${zeile.bezeichnung}**${detail} — Stärke: ${staerkeText(zeile.staerke)}`);
  } else {
    // mittel
    const einzug = '  '.repeat(Math.max(0, tiefe - 1));
    if (zeile.mittelArt === 'person') {
      const detail = zeile.detail ? ` (${zeile.detail})` : '';
      const status = zeile.statusLabel ?? zeile.statusKategorie ?? '';
      zeilen.push(`${einzug}  - 👤 ${zeile.bezeichnung}${detail}${status ? ` [${status}]` : ''}`);
    } else if (zeile.mittelArt === 'fahrzeug') {
      const detail = zeile.detail ? ` (${zeile.detail})` : '';
      const status = zeile.statusLabel ?? zeile.statusKategorie ?? '';
      zeilen.push(`${einzug}  - 🚒 ${zeile.bezeichnung}${detail}${status ? ` [${status}]` : ''}`);
    } else {
      const menge = zeile.menge != null ? ` ×${zeile.menge}` : '';
      const status = zeile.statusLabel ?? '';
      zeilen.push(`${einzug}  - 📦 ${zeile.bezeichnung}${menge}${status ? ` [${status}]` : ''}`);
    }
  }

  if (zeile.children) {
    for (const kind of zeile.children) {
      zeilen.push(rendereMeldebildZeileMarkdown(kind, tiefe + 1));
    }
  }

  return zeilen.join('\n');
}

/**
 * Rendert ein Kraeftebild als lesbares Markdown. Deterministisch — keine Date-Aufrufe.
 * Der `stand`-String wird von außen übergeben.
 */
export function rendereMeldebildMarkdown(bild: Kraeftebild, stand: string): string {
  const v = bild.verdichtung;
  const zeilen: string[] = [];

  zeilen.push('# Kräftemeldebild');
  zeilen.push('');
  zeilen.push(`**Stand:** ${stand}`);
  zeilen.push('');

  // Verdichtungsblock
  zeilen.push('## Lagebild gesamt');
  zeilen.push('');
  zeilen.push(`**Gesamtstärke (F/UF/M//Ges):** ${staerkeText(v.staerke)}`);
  zeilen.push(`**Fahrzeuge:** ${v.anzahlFahrzeuge} gesamt (frei: ${v.fahrzeugStatus.verfuegbar}, gebunden: ${v.fahrzeugStatus.gebunden}, n.v.: ${v.fahrzeugStatus.nicht_verfuegbar})`);
  zeilen.push(`**Material (Positionen):** ${v.anzahlMaterialPositionen}`);
  if (v.anzahlMaterialPositionen > 0) {
    const matTeile: string[] = [];
    if (v.materialStatus.einsatzbereit > 0) matTeile.push(`einsatzbereit: ${v.materialStatus.einsatzbereit}`);
    if (v.materialStatus.im_einsatz > 0) matTeile.push(`im Einsatz: ${v.materialStatus.im_einsatz}`);
    if (v.materialStatus.defekt > 0) matTeile.push(`defekt: ${v.materialStatus.defekt}`);
    if (v.materialStatus.verbraucht > 0) matTeile.push(`verbraucht: ${v.materialStatus.verbraucht}`);
    if (v.materialStatus.desinfektion_noetig > 0) matTeile.push(`Desinfektion nötig: ${v.materialStatus.desinfektion_noetig}`);
    if (matTeile.length > 0) zeilen.push(`  (${matTeile.join(', ')})`);
  }
  zeilen.push('');

  // Baum
  if (bild.baum.length > 0) {
    zeilen.push('## Kräftegliederung');
    zeilen.push('');
    for (const zeile of bild.baum) {
      zeilen.push(rendereMeldebildZeileMarkdown(zeile, 0));
      zeilen.push('');
    }
  }

  return zeilen.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export function baueKraeftebild(
  abschnitte: Einsatzabschnitt[],
  einheiten: Einheit[],
  personal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
): Kraeftebild {
  // ── Index: group by einheit_id ──────────────────────────────────────────
  const personalByEinheit = new Map<number | null, EinsatzPersonal[]>();
  for (const ep of personal) {
    const key = ep.einheit_id ?? null;
    if (!personalByEinheit.has(key)) personalByEinheit.set(key, []);
    personalByEinheit.get(key)!.push(ep);
  }

  const fahrzeugeByEinheit = new Map<number | null, EinsatzFahrzeug[]>();
  for (const ef of fahrzeuge) {
    const key = ef.einheit_id ?? null;
    if (!fahrzeugeByEinheit.has(key)) fahrzeugeByEinheit.set(key, []);
    fahrzeugeByEinheit.get(key)!.push(ef);
  }

  const materialByEinheit = new Map<number | null, EinsatzMaterial[]>();
  for (const em of material) {
    const key = em.einheit_id ?? null;
    if (!materialByEinheit.has(key)) materialByEinheit.set(key, []);
    materialByEinheit.get(key)!.push(em);
  }

  // ── Einheiten index ──────────────────────────────────────────────────────
  // Children by ueber_einheit_id (only top-level = ueber_einheit_id===null are exposed per abschnitt)
  const childrenByEinheit = new Map<number, Einheit[]>();
  // Top-level Einheiten per Abschnitt (ueber_einheit_id===null)
  const topEinheitenByAbschnitt = new Map<number | null, Einheit[]>();

  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      // child of another Einheit
      if (!childrenByEinheit.has(e.ueber_einheit_id)) childrenByEinheit.set(e.ueber_einheit_id, []);
      childrenByEinheit.get(e.ueber_einheit_id)!.push(e);
    } else {
      // top-level: belongs to an Abschnitt (or null → "Ohne Abschnitt")
      const key = e.abschnitt_id ?? null;
      if (!topEinheitenByAbschnitt.has(key)) topEinheitenByAbschnitt.set(key, []);
      topEinheitenByAbschnitt.get(key)!.push(e);
    }
  }

  // ── Abschnitte index ─────────────────────────────────────────────────────
  // Ein Abschnitt ist Wurzel, wenn er keinen Eltern-Abschnitt hat ODER sein
  // Eltern-Abschnitt nicht in der Eingabeliste vorhanden ist (Waisen-Promotion).
  // Das hält Tabelle↔Kopf konsistent, wenn der Filter nur einen Unter-Abschnitt
  // durchlässt, und härtet generell gegen dangling ueber_abschnitt_id-Referenzen.
  const abschnittIdSet = new Set<number>();
  for (const a of abschnitte) abschnittIdSet.add(a.id);

  const abschnittKinderMap = new Map<number, Einsatzabschnitt[]>();
  const topAbschnitte: Einsatzabschnitt[] = [];

  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id != null && abschnittIdSet.has(a.ueber_abschnitt_id)) {
      if (!abschnittKinderMap.has(a.ueber_abschnitt_id))
        abschnittKinderMap.set(a.ueber_abschnitt_id, []);
      abschnittKinderMap.get(a.ueber_abschnitt_id)!.push(a);
    } else {
      topAbschnitte.push(a);
    }
  }

  // ── Build tree ───────────────────────────────────────────────────────────
  const baum: MeldebildZeile[] = [];
  let gesammeltesSoll: StaerkeSumme | null = null;

  for (const abschnitt of topAbschnitte) {
    const kindAbschnitte = abschnittKinderMap.get(abschnitt.id) ?? [];
    const result = baueAbschnittZeile(
      abschnitt,
      kindAbschnitte,
      abschnittKinderMap,
      topEinheitenByAbschnitt,
      childrenByEinheit,
      personalByEinheit,
      fahrzeugeByEinheit,
      materialByEinheit,
    );
    if (result.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
    }
    baum.push(result.zeile);
  }

  // ── Catch-all: "Ohne Abschnitt" ──────────────────────────────────────────
  // Einheiten with abschnitt_id===null (and ueber_einheit_id===null already top-level)
  const ohneAbschnittEinheiten = topEinheitenByAbschnitt.get(null) ?? [];
  // Mittel with einheit_id===null: pseudo-Einheit "Ohne Einheit"
  const ohneEinheitPersonal = personalByEinheit.get(null) ?? [];
  const ohneEinheitFahrzeuge = fahrzeugeByEinheit.get(null) ?? [];
  const ohneEinheitMaterial = materialByEinheit.get(null) ?? [];

  const hasOhne =
    ohneAbschnittEinheiten.length > 0 ||
    ohneEinheitPersonal.length > 0 ||
    ohneEinheitFahrzeuge.length > 0 ||
    ohneEinheitMaterial.length > 0;

  if (hasOhne) {
    const ohneAbschnittStaerke = leereStaerke();
    const ohneAbschnittPersonalVert = leereVert();
    const ohneAbschnittFahrzeugVert = leereVert();
    const ohneAbschnittChildren: MeldebildZeile[] = [];

    // Real Einheiten without Abschnitt
    for (const einheit of ohneAbschnittEinheiten) {
      const kindEinheiten = childrenByEinheit.get(einheit.id) ?? [];
      const result = baueEinheitZeile(
        einheit,
        kindEinheiten,
        childrenByEinheit,
        personalByEinheit,
        fahrzeugeByEinheit,
        materialByEinheit,
      );
      addStaerke(ohneAbschnittStaerke, result.zeile.staerke);
      addVerteilung(ohneAbschnittPersonalVert, result.zeile.personalVerteilung ?? leereVert());
      addVerteilung(ohneAbschnittFahrzeugVert, result.zeile.fahrzeugVerteilung ?? leereVert());
      if (result.gesammeltesSoll !== null) {
        gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
      }
      ohneAbschnittChildren.push(result.zeile);
    }

    // Pseudo-Einheit "Ohne Einheit" for mittel with einheit_id===null
    if (
      ohneEinheitPersonal.length > 0 ||
      ohneEinheitFahrzeuge.length > 0 ||
      ohneEinheitMaterial.length > 0
    ) {
      const ohneEinheitStaerke = leereStaerke();
      const ohneEinheitPersonalVert = leereVert();
      const ohneEinheitFahrzeugVert = leereVert();
      const ohneEinheitChildren: MeldebildZeile[] = [];

      for (const ep of ohneEinheitPersonal) {
        const ps = leereStaerke();
        addPosition(ps, ep.staerke_position);
        addPosition(ohneEinheitStaerke, ep.staerke_position);
        addKategorie(ohneEinheitPersonalVert, ep.status_kategorie);
        ohneEinheitChildren.push({
          key: `ep-${ep.id}`,
          art: 'mittel',
          mittelArt: 'person',
          bezeichnung: ep.name,
          detail: ep.funktion ?? null,
          staerke: ps,
          soll: null,
          statusKategorie: ep.status_kategorie ?? null,
          statusLabel: ep.status_label ?? null,
          menge: null,
          personalVerteilung: null,
          fahrzeugVerteilung: null,
        });
      }

      for (const ef of ohneEinheitFahrzeuge) {
        addKategorie(ohneEinheitFahrzeugVert, ef.status_kategorie);
        ohneEinheitChildren.push({
          key: `ef-${ef.id}`,
          art: 'mittel',
          mittelArt: 'fahrzeug',
          bezeichnung: ef.funkrufname,
          detail: ef.fahrzeugtyp ?? null,
          staerke: leereStaerke(),
          soll: null,
          statusKategorie: ef.status_kategorie ?? null,
          statusLabel: ef.status_label ?? null,
          menge: null,
          personalVerteilung: null,
          fahrzeugVerteilung: null,
        });
      }

      for (const em of ohneEinheitMaterial) {
        ohneEinheitChildren.push({
          key: `em-${em.id}`,
          art: 'mittel',
          mittelArt: 'material',
          bezeichnung: em.bezeichnung,
          detail: null,
          staerke: leereStaerke(),
          soll: null,
          statusKategorie: null,
          statusLabel: em.status,
          menge: em.menge,
          personalVerteilung: null,
          fahrzeugVerteilung: null,
        });
      }

      addStaerke(ohneAbschnittStaerke, ohneEinheitStaerke);
      addVerteilung(ohneAbschnittPersonalVert, ohneEinheitPersonalVert);
      addVerteilung(ohneAbschnittFahrzeugVert, ohneEinheitFahrzeugVert);

      ohneAbschnittChildren.push({
        key: `${OHNE_EINHEIT_KEY_PREFIX}-0`,
        art: 'einheit',
        mittelArt: null,
        bezeichnung: 'Ohne Einheit',
        detail: null,
        staerke: ohneEinheitStaerke,
        soll: null,
        statusKategorie: null,
        statusLabel: null,
        menge: null,
        personalVerteilung: ohneEinheitPersonalVert,
        fahrzeugVerteilung: ohneEinheitFahrzeugVert,
        children: ohneEinheitChildren.length > 0 ? ohneEinheitChildren : undefined,
      });
    }

    baum.push({
      key: OHNE_ABSCHNITT_KEY,
      art: 'abschnitt',
      mittelArt: null,
      bezeichnung: 'Ohne Abschnitt',
      detail: null,
      staerke: ohneAbschnittStaerke,
      soll: null,
      statusKategorie: null,
      statusLabel: null,
      menge: null,
      personalVerteilung: ohneAbschnittPersonalVert,
      fahrzeugVerteilung: ohneAbschnittFahrzeugVert,
      children: ohneAbschnittChildren.length > 0 ? ohneAbschnittChildren : undefined,
    });
  }

  // ── Verdichtung: computed from raw lists (NOT from tree) ─────────────────
  const verdichtungStaerke = leereStaerke();
  const personalStatus = leereVert();
  const fahrzeugStatus = leereVert();
  const materialStatus: Record<MaterialStatus, number> = {
    einsatzbereit: 0,
    im_einsatz: 0,
    defekt: 0,
    verbraucht: 0,
    desinfektion_noetig: 0,
  };

  for (const ep of personal) {
    addPosition(verdichtungStaerke, ep.staerke_position);
    addKategorie(personalStatus, ep.status_kategorie);
  }

  for (const ef of fahrzeuge) {
    addKategorie(fahrzeugStatus, ef.status_kategorie);
  }

  for (const em of material) {
    materialStatus[em.status] += 1;
  }

  return {
    baum,
    verdichtung: {
      staerke: verdichtungStaerke,
      soll: gesammeltesSoll,
      personalStatus,
      fahrzeugStatus,
      materialStatus,
      anzahlPersonal: personal.length,
      anzahlFahrzeuge: fahrzeuge.length,
      anzahlMaterialPositionen: material.length,
    },
  };
}
