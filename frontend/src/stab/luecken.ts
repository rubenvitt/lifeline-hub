import { schlechtesterZustand, type AbrufZustand } from '../api/abrufZustand';
import type {
  Einheit,
  Einsatzabschnitt,
  Fernmeldeskizze,
  KommunikationsStelle,
  SkizzenVerbindung,
  Sprechgruppe,
  Verbindungsstatus,
} from '../api/types';
import { FUEHRUNGSSTELLE_STELLE, type FuehrungsstelleQuelle } from './fuehrungsstelle';
import { vergleicheSprechgruppen } from './sprechgruppenOrdnung';

/**
 * Lücken als reine Filter über bereits geladene Listen (Stab-Spec LFH-46, Entscheidung 15:
 * keine zweite Verdichtung). Wo eine Zahl auf dem Funkplan (LFH-548) und später auf der
 * Stabzeile (ST6) steht, kommt sie aus DIESER Funktion.
 *
 * Eine Lücke ohne geladene Daten hat keine Zahl: `treffer` bleibt leer, und der Zustand sagt,
 * warum. Aufrufer zeigen dann „—" mit Grund, nie „0".
 */
export interface Quelle<T> {
  zustand: AbrufZustand;
  daten: readonly T[];
}

export interface Luecke<T> {
  zustand: AbrufZustand;
  treffer: T[];
}

function filtere<T>(q: Quelle<T>, trifft: (x: T) => boolean): Luecke<T> {
  if (q.zustand !== 'daten') return { zustand: q.zustand, treffer: [] };
  return { zustand: 'daten', treffer: q.daten.filter(trifft) };
}

export function abschnitteOhneSprechgruppe(
  abschnitte: Quelle<Einsatzabschnitt>,
): Luecke<Einsatzabschnitt> {
  return filtere(abschnitte, (a) => a.sprechgruppen.length === 0);
}

export function einheitenOhneSprechgruppe(einheiten: Quelle<Einheit>): Luecke<Einheit> {
  return filtere(einheiten, (e) => e.sprechgruppen.length === 0);
}

export function einheitenOhneErreichbarkeit(einheiten: Quelle<Einheit>): Luecke<Einheit> {
  return filtere(einheiten, (e) => !e.erreichbarkeit?.trim());
}

/** Weitere Träger von Sprechgruppen (LFH-893): externe Stellen und Komponenten der Skizze. */
export interface WeitereKanalQuellen {
  stellen: Quelle<KommunikationsStelle>;
  skizze: SkizzenQuelle;
}

/**
 * Einsatzlokale Sprechgruppen, die weder ein Abschnitt, eine Einheit noch die eigene
 * Führungsstelle (LFH-849) trägt — und, mit `weitere`, auch keine externe Stelle und keine
 * Komponente der Skizze (LFH-893, Review O2: dieselben Träger wie {@link kanalbelegung}, sonst
 * zählte eine Sprechgruppe nur an einer Komponente zugleich als „ohne Zuordnung“ und „nur ein
 * Teilnehmer“). Fehlt eine Strukturquelle, wäre jede Zahl geraten. Fehlt eine der weiteren
 * Quellen, urteilt die Regel nur, wenn die Struktur schon jede lokale Sprechgruppe trägt.
 *
 * @param weitere fehlt das Argument, hat der Aufrufer Stellen und Skizze nicht als Quelle: dann
 *   zählen nur Abschnitte, Einheiten und Führungsstelle. Funkplan-Seite und Übernahme in den
 *   Lagebericht reichen beide mit.
 */
export function lokaleSprechgruppenOhneZuordnung(
  sprechgruppen: Quelle<Sprechgruppe>,
  abschnitte: Quelle<Einsatzabschnitt>,
  einheiten: Quelle<Einheit>,
  fuehrungsstelle: FuehrungsstelleQuelle,
  weitere?: WeitereKanalQuellen,
): Luecke<Sprechgruppe> {
  const zustand = schlechtesterZustand(
    sprechgruppen.zustand,
    abschnitte.zustand,
    einheiten.zustand,
    fuehrungsstelle.zustand,
  );
  if (zustand !== 'daten') return { zustand, treffer: [] };
  const zugeordnet = new Set<number>();
  for (const a of abschnitte.daten) for (const s of a.sprechgruppen) zugeordnet.add(s.id);
  for (const e of einheiten.daten) for (const s of e.sprechgruppen) zugeordnet.add(s.id);
  for (const s of fuehrungsstelle.daten?.sprechgruppen ?? []) zugeordnet.add(s.id);
  const offen = () => sprechgruppen.daten.filter((s) => s.einsatz_lokal && !zugeordnet.has(s.id));
  if (weitere) {
    if (weitere.stellen.zustand === 'daten') {
      for (const st of weitere.stellen.daten) {
        if (st.stellenart === 'funktion') continue;
        for (const k of st.sprechgruppen) zugeordnet.add(k.sprechgruppe.id);
      }
    }
    if (weitere.skizze.zustand === 'daten') {
      for (const ko of weitere.skizze.daten?.komponenten ?? []) {
        for (const s of ko.sprechgruppen) zugeordnet.add(s.id);
      }
    }
    const fehlt = schlechtesterZustand(weitere.stellen.zustand, weitere.skizze.zustand);
    if (fehlt !== 'daten' && offen().length > 0) return { zustand: fehlt, treffer: [] };
  }
  return { zustand, treffer: offen() };
}

/**
 * Fehlt der Draht zur Leitstelle? Die eine Regel für Kommunikationsplan, Funkplan und
 * Fernmeldeskizze (LFH-848, erweitert LFH-893 D11). Eine Leitstelle gilt als verbunden, wenn sie
 * eine Verbindung im Kommunikationsplan, einen Kanal (Sprechgruppe) oder eine Verbindung in der
 * Skizze trägt; erst wenn keine Stelle der Art Leitstelle verbunden ist, fehlt sie.
 *
 * - Ohne geladene Stellen gibt es kein Urteil; der Zustand sagt warum.
 * - Fehlen nur die Verbindungen der Skizze, urteilt die Regel aus den übrigen Angaben, wenn diese
 *   schon eine Verbindung belegen, sonst steht der Zustand der Skizze (Spec-Delta
 *   `stab-kommunikationsplan`, „Lücke ‚Leitstelle‘“).
 *
 * @param skizzenVerbindungen die Verbindungen der Fernmeldeskizze. Fehlt das Argument, hat der
 *   Aufrufer die Skizze noch nicht als Quelle (Übergang bis LFH-893 2.6/7.4): dann zählen nur
 *   Kommunikationsplan und Kanäle.
 */
export function leitstelleOhneVerbindung(
  stellen: Quelle<KommunikationsStelle>,
  skizzenVerbindungen?: Quelle<SkizzenVerbindung>,
): {
  zustand: AbrufZustand;
  fehlt: boolean;
} {
  if (stellen.zustand !== 'daten') return { zustand: stellen.zustand, fehlt: false };
  const leitstellen = stellen.daten.filter((s) => s.stellenart === 'leitstelle');
  const ohneSkizze = leitstellen.some(
    (s) => s.verbindungen.length > 0 || s.sprechgruppen.length > 0,
  );
  if (ohneSkizze || skizzenVerbindungen == null) return { zustand: 'daten', fehlt: !ohneSkizze };
  if (skizzenVerbindungen.zustand !== 'daten') {
    return { zustand: skizzenVerbindungen.zustand, fehlt: false };
  }
  const ids = new Set(leitstellen.map((s) => s.id));
  const trifft = (b: SkizzenVerbindung['von']) =>
    b.art === 'stelle' && b.id != null && ids.has(b.id);
  const verbunden = skizzenVerbindungen.daten.some((v) => trifft(v.von) || trifft(v.nach));
  return { zustand: 'daten', fehlt: !verbunden };
}

// ── Kanäle der Fernmeldeskizze (LFH-893 D2, D11) ───────────────────────────────────────────────

/** Die Daten der Fernmeldeskizze als Quelle; wie die Führungsstelle eine Angabe, keine Liste. */
export interface SkizzenQuelle {
  zustand: AbrufZustand;
  daten: Fernmeldeskizze | null;
}

/** Was die Kanalbelegung liest: die Strukturquellen des Funkplans plus Stellen und Skizze. */
export interface KanalQuellen {
  abschnitte: Quelle<Einsatzabschnitt>;
  einheiten: Quelle<Einheit>;
  fuehrungsstelle: FuehrungsstelleQuelle;
  /** Sprechgruppen des Einsatzes (Katalog und einsatzlokal). */
  sprechgruppen: Quelle<Sprechgruppe>;
  /** Die Stellen des Kommunikationsplans mit ihren Kanälen. */
  stellen: Quelle<KommunikationsStelle>;
  skizze: SkizzenQuelle;
}

/** Eine Stichleitung: das Element (Schlüssel wie in der Skizze, D2) und ihr Status (D7). */
export interface KanalTeilnehmer {
  element: string;
  status: Verbindungsstatus;
}

export interface Kanal {
  sprechgruppe: Sprechgruppe;
  teilnehmer: KanalTeilnehmer[];
}

/**
 * Die Kanalbelegung des Netzes: jede Sprechgruppe, die eine Stelle oder Komponente trägt, jede
 * einsatzlokale und jede mit Lagezeile (`sg-<id>`), mit ihren Teilnehmern in fester Folge
 * (Führungsstelle, Abschnitte, Einheiten, externe Stellen, Komponenten, je wie ihre Liste).
 * Führungsfunktionen sind nie Teilnehmer. Liest nur, was geladen ist: das Urteil über fehlende
 * Quellen fällen die Lücken, die Skizze nennt sie. Eine Lagezeile ohne bekannte Sprechgruppe ist
 * verwaist und fehlt.
 *
 * Die eine Belegung für die Schienen der Skizze (`stab/fernmeldeskizze.ts`) und die Lücke
 * {@link schienenMitEinemTeilnehmer}: Bild und Paneel zählen dieselben Stichleitungen.
 */
export function kanalbelegung(q: KanalQuellen): Map<number, Kanal> {
  const kanaele = new Map<number, Kanal>();
  const kanal = (s: Sprechgruppe): Kanal => {
    let k = kanaele.get(s.id);
    if (!k) {
      k = { sprechgruppe: s, teilnehmer: [] };
      kanaele.set(s.id, k);
    }
    return k;
  };
  const trage = (s: Sprechgruppe, element: string, status: Verbindungsstatus = 'bestehend') => {
    const k = kanal(s);
    // Doppelte Zuordnung derselben Stelle: eine Stichleitung.
    if (!k.teilnehmer.some((t) => t.element === element)) k.teilnehmer.push({ element, status });
  };
  const geladen = <T>(quelle: Quelle<T>): readonly T[] =>
    quelle.zustand === 'daten' ? quelle.daten : [];

  if (q.fuehrungsstelle.zustand === 'daten') {
    for (const s of q.fuehrungsstelle.daten?.sprechgruppen ?? []) trage(s, 'fs');
  }
  for (const a of geladen(q.abschnitte)) for (const s of a.sprechgruppen) trage(s, `ab-${a.id}`);
  for (const e of geladen(q.einheiten)) for (const s of e.sprechgruppen) trage(s, `eh-${e.id}`);
  for (const st of geladen(q.stellen)) {
    if (st.stellenart === 'funktion') continue;
    for (const k of st.sprechgruppen) trage(k.sprechgruppe, `ks-${st.id}`, k.status);
  }
  const skizze = q.skizze.zustand === 'daten' ? q.skizze.daten : null;
  for (const ko of skizze?.komponenten ?? []) {
    for (const s of ko.sprechgruppen) trage(s, `ko-${ko.id}`);
  }

  const bekannt = new Map(geladen(q.sprechgruppen).map((s) => [s.id, s]));
  for (const s of bekannt.values()) if (s.einsatz_lokal) kanal(s);
  for (const l of skizze?.lage ?? []) {
    const m = /^sg-(\d+)$/.exec(l.element);
    const s = m ? bekannt.get(Number(m[1])) : undefined;
    if (s) kanal(s);
  }
  return kanaele;
}

/**
 * Sprechgruppen mit genau einem Teilnehmer (Stelle oder Komponente): ein Kanal, auf dem niemand
 * antwortet. Eine einsatzlokale ohne Teilnehmer zählt weiter nur bei
 * {@link lokaleSprechgruppenOhneZuordnung}; eine Katalog-Schiene ohne Teilnehmer (nur Lagezeile)
 * zählt hier. Treffer TMO vor DMO. Fehlt eine Quelle, wäre jede Zahl geraten: dann der Zustand.
 */
export function schienenMitEinemTeilnehmer(q: KanalQuellen): Luecke<Sprechgruppe> {
  const zustand = schlechtesterZustand(
    q.abschnitte.zustand,
    q.einheiten.zustand,
    q.fuehrungsstelle.zustand,
    q.sprechgruppen.zustand,
    q.stellen.zustand,
    q.skizze.zustand,
  );
  if (zustand !== 'daten') return { zustand, treffer: [] };
  const treffer = [...kanalbelegung(q).values()]
    .filter(
      (k) =>
        k.teilnehmer.length === 1 || (k.teilnehmer.length === 0 && !k.sprechgruppe.einsatz_lokal),
    )
    .map((k) => k.sprechgruppe)
    .sort(vergleicheSprechgruppen);
  return { zustand, treffer };
}

// ── Verbindungen (LFH-625 D3) ──────────────────────────────────────────────────────────────────

/**
 * Das Urteil über die Verbindung einer Stelle zu ihrer übergeordneten Stelle — die eine Regel für
 * die Kante der Fernmeldeskizze (`stab/fernmeldeskizze.ts`) und die Lücke im Funkplan.
 *
 * - `gemeinsam`: die Sprechgruppen, die beiden zugeordnet sind, nach Betriebsart (Bezeichnungen).
 * - `keine`: beide Seiten haben Sprechgruppen, aber keine gemeinsame.
 * - `ohne-urteil`: einer Seite fehlt jede Sprechgruppe (die Lücke steht schon am Knoten, doppelt
 *   gezählt hieße eine Ursache zweimal melden), oder es gibt keine übergeordnete Stelle.
 *
 * Verglichen wird die Sprechgruppe selbst (`id`): ein einsatzlokaler und ein Stammdaten-Eintrag
 * können dieselbe Bezeichnung tragen.
 */
export type Kante =
  { art: 'gemeinsam'; tmo: string[]; dmo: string[] } | { art: 'keine' } | { art: 'ohne-urteil' };

export function verbindungsurteil(
  oben: readonly Sprechgruppe[],
  unten: readonly Sprechgruppe[],
): Kante {
  if (oben.length === 0 || unten.length === 0) return { art: 'ohne-urteil' };
  const obenIds = new Set(oben.map((s) => s.id));
  const gemeinsam = unten.filter((s) => obenIds.has(s.id));
  if (gemeinsam.length === 0) return { art: 'keine' };
  return {
    art: 'gemeinsam',
    tmo: gemeinsam.filter((s) => s.betriebsart === 'TMO').map((s) => s.bezeichnung),
    dmo: gemeinsam.filter((s) => s.betriebsart === 'DMO').map((s) => s.bezeichnung),
  };
}

export interface Stelle {
  art: 'abschnitt' | 'einheit';
  id: number;
  name: string;
}

/** Die eigene Führungsstelle als Gegenstelle der obersten Abschnitte (LFH-849). Keine Zeile in
 * einer Liste, daher ohne ID. */
export interface FuehrungsstellenStelle {
  art: 'fuehrungsstelle';
  name: string;
}

export interface Verbindung {
  unten: Stelle;
  oben: Stelle | FuehrungsstellenStelle;
}

/**
 * Verbindungen ohne gemeinsame Sprechgruppe. Die Paare folgen der Platzierung des Funkplans und
 * des Organigramms (Spec `stab-fernmeldeskizze`, „Knotenaufbau“): oberster Abschnitt → eigene
 * Führungsstelle (LFH-849), Unterabschnitt → Abschnitt, oberste Einheit → Abschnitt, Untereinheit
 * → Einheit. Ein Abschnitt mit unbekanntem Oberabschnitt steht oben und urteilt gegen die
 * Führungsstelle; eine Einheit ohne bekannte übergeordnete Stelle hat kein Paar. Treffer erst der
 * Abschnitte, dann der Einheiten, je in der Reihenfolge ihrer Liste. Fehlt eine der Quellen, wäre
 * jede Zahl unvollständig: dann der Zustand statt einer Zahl.
 */
export function verbindungenOhneGemeinsameSprechgruppe(
  abschnitte: Quelle<Einsatzabschnitt>,
  einheiten: Quelle<Einheit>,
  fuehrungsstelle: FuehrungsstelleQuelle,
): Luecke<Verbindung> {
  const zustand = schlechtesterZustand(
    abschnitte.zustand,
    einheiten.zustand,
    fuehrungsstelle.zustand,
  );
  if (zustand !== 'daten') return { zustand, treffer: [] };
  // Ohne Sprechgruppe an der Führungsstelle urteilt `verbindungsurteil` „ohne-urteil“: keine Zahl.
  const fsSprechgruppen = fuehrungsstelle.daten?.sprechgruppen ?? [];
  const fsStelle: FuehrungsstellenStelle = { art: 'fuehrungsstelle', name: FUEHRUNGSSTELLE_STELLE };

  const abschnittJeId = new Map(abschnitte.daten.map((a) => [a.id, a]));
  const einheitJeId = new Map(einheiten.daten.map((e) => [e.id, e]));
  const stelleAbschnitt = (a: Einsatzabschnitt): Stelle => ({
    art: 'abschnitt',
    id: a.id,
    name: a.name,
  });
  const stelleEinheit = (e: Einheit): Stelle => ({ art: 'einheit', id: e.id, name: e.name });

  const treffer: Verbindung[] = [];
  for (const a of abschnitte.daten) {
    const oben = a.ueber_abschnitt_id != null ? abschnittJeId.get(a.ueber_abschnitt_id) : undefined;
    const urteil = verbindungsurteil(oben ? oben.sprechgruppen : fsSprechgruppen, a.sprechgruppen);
    if (urteil.art === 'keine') {
      treffer.push({ unten: stelleAbschnitt(a), oben: oben ? stelleAbschnitt(oben) : fsStelle });
    }
  }
  // Die übergeordnete Stelle einer Einheit: ihre Einheit, sonst (oberste Einheit) ihr Abschnitt.
  const obenVon = (
    e: Einheit,
  ): { stelle: Stelle; sprechgruppen: readonly Sprechgruppe[] } | null => {
    const einheit = e.ueber_einheit_id != null ? einheitJeId.get(e.ueber_einheit_id) : undefined;
    if (einheit) return { stelle: stelleEinheit(einheit), sprechgruppen: einheit.sprechgruppen };
    const a = e.abschnitt_id != null ? abschnittJeId.get(e.abschnitt_id) : undefined;
    return a ? { stelle: stelleAbschnitt(a), sprechgruppen: a.sprechgruppen } : null;
  };
  for (const e of einheiten.daten) {
    const oben = obenVon(e);
    if (oben && verbindungsurteil(oben.sprechgruppen, e.sprechgruppen).art === 'keine') {
      treffer.push({ unten: stelleEinheit(e), oben: oben.stelle });
    }
  }
  return { zustand, treffer };
}
