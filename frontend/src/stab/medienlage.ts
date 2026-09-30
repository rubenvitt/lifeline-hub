import type {
  InfotelefonAnliegen,
  InfotelefonStatus,
  MedienkontaktArt,
  MedienkontaktStatus,
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
 * Felder (Art, Status, Medium; Titel, Version, Freigabezeit; Anliegen, Status). Ansprechperson,
 * Erreichbarkeit, Anrufername, Rückrufnummer, Notiz und Thema erreichen die Ableitung nie — auch
 * dann nicht, wenn der Aufrufer das volle DTO übergibt. Der Test pinnt ihre Abwesenheit.
 *
 * Eine Quelle ohne Daten liefert keine Zahl: ihr Teil trägt den Zustand, und die Anzeige sagt
 * „—“ mit Grund, nie „0“.
 */

interface KontaktEingang {
  art: MedienkontaktArt;
  status: MedienkontaktStatus;
  medium: string;
}
interface MitteilungEingang {
  titel: string;
  version: number;
  status: PressemitteilungStatus;
  freigegeben_at?: string | null;
}
interface AnrufEingang {
  anliegen: InfotelefonAnliegen;
  status: InfotelefonStatus;
}

export interface MedienlageQuellen {
  kontakte: Quelle<KontaktEingang>;
  mitteilungen: Quelle<MitteilungEingang>;
  anrufe: Quelle<AnrufEingang>;
}

type Teil<T> =
  { zustand: 'daten'; werte: T } | { zustand: Exclude<Quelle<never>['zustand'], 'daten'> };

export interface Medienlage {
  kontakte: Teil<{
    gesamt: number;
    offen: number;
    jeArt: Record<MedienkontaktArt, number>;
    /** Die Namen der Medien (Redaktionen, keine Personen), jedes einmal, in Eingangsfolge. */
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

export function baueMedienlage(q: MedienlageQuellen): Medienlage {
  return {
    kontakte: teil(q.kontakte, (daten) => {
      const jeArt = nullen(ART_REIHENFOLGE);
      const medien: string[] = [];
      let offen = 0;
      for (const k of daten) {
        jeArt[k.art] += 1;
        if (k.status === 'offen') offen += 1;
        const medium = k.medium.trim();
        if (medium && !medien.includes(medium)) medien.push(medium);
      }
      return { gesamt: daten.length, offen, jeArt, medien };
    }),
    mitteilungen: teil(q.mitteilungen, (daten) => ({
      freigegeben: daten
        .filter((m) => m.status === 'freigegeben' && m.freigegeben_at)
        .map((m) => ({ titel: m.titel, version: m.version, freigegebenAt: m.freigegeben_at! }))
        .sort((a, b) => a.freigegebenAt.localeCompare(b.freigegebenAt)),
    })),
    anrufe: teil(q.anrufe, (daten) => {
      const jeAnliegen = nullen(ANLIEGEN_REIHENFOLGE);
      let offeneRueckrufe = 0;
      for (const a of daten) {
        jeAnliegen[a.anliegen] += 1;
        if (a.status === 'offen') offeneRueckrufe += 1;
      }
      return { gesamt: daten.length, offeneRueckrufe, jeAnliegen };
    }),
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
