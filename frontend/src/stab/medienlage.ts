import type { AbrufZustand } from '../api/abrufZustand';
import type {
  InfotelefonAnliegen,
  InfotelefonZaehler,
  MedienkontaktArt,
  MedienkontaktKennzahlen,
  PressemitteilungStatus,
} from '../api/types';
import { ZUSTAND_GRUND } from './funkplan';
import type { Quelle } from './luecken';
import {
  ANLIEGEN_LABEL,
  ANLIEGEN_REIHENFOLGE,
  ART_REIHENFOLGE,
  MEDIENKONTAKT_ART_LABEL,
} from '../presse/labels';

/**
 * Die Medienlage des Sachgebiets S5 (LFH-554, Spec `stab-medienlage`): eine Verdichtung von
 * Presse-Log, Pressemitteilungen und Informationstelefon **ohne Personenbezug**. Sie steht als
 * Paneel auf der Presseseite und geht per „Aus S5 übernehmen“ in den Abschnitt „Medienlage“ des
 * Lagevortrags (DRK RLP, Punkt III).
 *
 * **Datenschutz strukturell:** `baueMedienlage` kopiert aus jeder Quelle NUR die freigegebenen
 * Felder (Zahlen und Medien der Kontakte; Titel, Version, Freigabezeit; Zahlen der Anrufe). Die
 * Kontakte kommen seit LFH-1075 als Kennzahlen vom Server, über den ganzen Bestand, auch wenn
 * die Presseseite die erledigten nur seitenweise lädt; die Anrufe seit LLH-732 ebenso aus
 * `…/infotelefon/zaehler`, auch wenn das Protokoll nur ein Fenster lädt. Ansprechperson,
 * Kontaktweg, Anrufername, Rückrufnummer, Notiz und Thema erreichen die Ableitung nie — auch
 * dann nicht, wenn der Aufrufer das volle DTO übergibt. Der Test pinnt ihre Abwesenheit.
 *
 * Eine Quelle ohne Daten liefert keine Zahl: ihr Teil trägt den Zustand, und die Anzeige sagt
 * „—“ mit Grund, nie „0“.
 */

/** Die Kennzahlen des Presse-Logs (`…/medienkontakte/kennzahlen`); `null` ohne Antwort. */
interface KontaktEingang {
  zustand: AbrufZustand;
  daten: Pick<MedienkontaktKennzahlen, 'gesamt' | 'offen' | 'je_art' | 'medien'> | null;
}
interface MitteilungEingang {
  titel: string;
  version: number;
  status: PressemitteilungStatus;
  freigegeben_at?: string | null;
}
/** Die Zählung des Informationstelefons (`…/infotelefon/zaehler`); `null` ohne Antwort. */
interface AnrufEingang {
  zustand: AbrufZustand;
  daten: Pick<InfotelefonZaehler, 'gesamt' | 'offen' | 'je_anliegen'> | null;
}

export interface MedienlageQuellen {
  kontakte: KontaktEingang;
  mitteilungen: Quelle<MitteilungEingang>;
  anrufe: AnrufEingang;
}

type Teil<T> =
  { zustand: 'daten'; werte: T } | { zustand: Exclude<Quelle<never>['zustand'], 'daten'> };

export interface Medienlage {
  kontakte: Teil<{
    gesamt: number;
    offen: number;
    jeArt: Record<MedienkontaktArt, number>;
    /** Die Namen der Medien (Redaktionen, keine Personen), jedes einmal, in der Folge des Presse-Logs (offene zuerst, dann jüngster Eingang). */
    medien: string[];
  }>;
  mitteilungen: Teil<{ freigegeben: { titel: string; version: number; freigegebenAt: string }[] }>;
  anrufe: Teil<{
    gesamt: number;
    offeneRueckrufe: number;
    jeAnliegen: Record<InfotelefonAnliegen, number>;
  }>;
}

function nullen<K extends string>(schluessel: readonly K[]): Record<K, number> {
  return Object.fromEntries(schluessel.map((k) => [k, 0])) as Record<K, number>;
}

function teil<E, W>(q: Quelle<E>, rechne: (daten: readonly E[]) => W): Teil<W> {
  if (q.zustand !== 'daten') return { zustand: q.zustand };
  return { zustand: 'daten', werte: rechne(q.daten) };
}

function kontakteTeil(q: KontaktEingang): Medienlage['kontakte'] {
  if (q.zustand !== 'daten') return { zustand: q.zustand };
  if (!q.daten) return { zustand: 'fehler' };
  const k = q.daten;
  const jeArt = nullen(ART_REIHENFOLGE);
  for (const art of ART_REIHENFOLGE) jeArt[art] = k.je_art[art];
  const medien: string[] = [];
  for (const m of k.medien) {
    const medium = m.trim();
    if (medium && !medien.includes(medium)) medien.push(medium);
  }
  return { zustand: 'daten', werte: { gesamt: k.gesamt, offen: k.offen, jeArt, medien } };
}

function anrufeTeil(q: AnrufEingang): Medienlage['anrufe'] {
  if (q.zustand !== 'daten') return { zustand: q.zustand };
  if (!q.daten) return { zustand: 'fehler' };
  const jeAnliegen = nullen(ANLIEGEN_REIHENFOLGE);
  for (const anliegen of ANLIEGEN_REIHENFOLGE) jeAnliegen[anliegen] = q.daten.je_anliegen[anliegen];
  return {
    zustand: 'daten',
    werte: { gesamt: q.daten.gesamt, offeneRueckrufe: q.daten.offen, jeAnliegen },
  };
}

export function baueMedienlage(q: MedienlageQuellen): Medienlage {
  return {
    kontakte: kontakteTeil(q.kontakte),
    mitteilungen: teil(q.mitteilungen, (daten) => ({
      freigegeben: daten
        .filter((m) => m.status === 'freigegeben' && m.freigegeben_at)
        .map((m) => ({ titel: m.titel, version: m.version, freigegebenAt: m.freigegeben_at! }))
        .sort((a, b) => a.freigegebenAt.localeCompare(b.freigegebenAt)),
    })),
    anrufe: anrufeTeil(q.anrufe),
  };
}

/** Markdown-Sonderzeichen in Freitext (Medium, Titel) entschärfen. */
function md(text: string): string {
  return text.replace(/([\\`*_[\]#|<>])/g, '\\$1');
}

function grund(t: { zustand: string }): string {
  return `— (${ZUSTAND_GRUND[t.zustand as keyof typeof ZUSTAND_GRUND]})`;
}

/**
 * Die Medienlage als Markdown für den Abschnitt „Medienlage“. `zeit` formatiert einen
 * Wire-Zeitpunkt (UTC ohne Zone) für die Anzeige, die Seite reicht die taktische DTG herein.
 */
export function rendereMedienlageMarkdown(m: Medienlage, zeit: (wire: string) => string): string {
  const zeilen: string[] = [];

  zeilen.push('**Medienkontakte**');
  if (m.kontakte.zustand !== 'daten') {
    zeilen.push(`- ${grund(m.kontakte)}`);
  } else {
    const k = m.kontakte.werte;
    const arten = ART_REIHENFOLGE.filter((a) => k.jeArt[a] > 0)
      .map((a) => `${MEDIENKONTAKT_ART_LABEL[a]} ${k.jeArt[a]}`)
      .join(', ');
    zeilen.push(`- ${k.gesamt} gesamt, davon ${k.offen} offen${arten ? ` (${arten})` : ''}`);
    if (k.medien.length > 0) zeilen.push(`- Medien: ${k.medien.map(md).join(', ')}`);
  }

  zeilen.push('', '**Pressemitteilungen**');
  if (m.mitteilungen.zustand !== 'daten') {
    zeilen.push(`- ${grund(m.mitteilungen)}`);
  } else if (m.mitteilungen.werte.freigegeben.length === 0) {
    zeilen.push('- keine freigegeben');
  } else {
    for (const p of m.mitteilungen.werte.freigegeben) {
      zeilen.push(`- ${zeit(p.freigegebenAt)} · ${md(p.titel)} (v${p.version})`);
    }
  }

  zeilen.push('', '**Informationstelefon**');
  if (m.anrufe.zustand !== 'daten') {
    zeilen.push(`- ${grund(m.anrufe)}`);
  } else {
    const a = m.anrufe.werte;
    zeilen.push(`- ${a.gesamt} Anrufe, davon ${a.offeneRueckrufe} Rückrufe offen`);
    const jeAnliegen = ANLIEGEN_REIHENFOLGE.filter((x) => a.jeAnliegen[x] > 0)
      .map((x) => `${ANLIEGEN_LABEL[x]} ${a.jeAnliegen[x]}`)
      .join(', ');
    if (jeAnliegen) zeilen.push(`- ${jeAnliegen}`);
  }
  return zeilen.join('\n');
}
