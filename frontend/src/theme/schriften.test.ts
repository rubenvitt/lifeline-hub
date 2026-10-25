/**
 * Schriften über die FontFace-API (LFH-1108, `druck/AGENTS.md`, Schriften im Druck). Die
 * CSS-Dateien werden als TEXT gelesen: Vitest liefert CSS über Vite-Importe leer.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHRIFT_FRIST_MS, SCHRIFTSCHNITTE, registerSchriften } from './schriften';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssDateien(verzeichnis: string, praefix = ''): [string, string][] {
  const treffer: [string, string][] = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) treffer.push(...cssDateien(pfad, rel));
    else if (eintrag.name.endsWith('.css')) treffer.push([rel, readFileSync(pfad, 'utf8')]);
  }
  return treffer;
}

describe('Schriften (LFH-1108)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('kein CSS der App meldet eine Schrift per @font-face an', () => {
    const verstoesse = cssDateien(SRC)
      .filter(([, inhalt]) => /@font-face/.test(inhalt.replace(/\/\*[\s\S]*?\*\//g, '')))
      .map(([pfad]) => pfad);
    expect(verstoesse).toEqual([]);
  });

  it('meldet jeden Schnitt sofort an, lädt die Bildschirm-Schnitte sofort und den Rest, sobald der Browser Luft hat', () => {
    vi.useFakeTimers();
    const { menge, geladen } = stubFontFace();

    void registerSchriften({ add: (s: StubSchnitt) => menge.push(s) } as unknown as FontFaceSet);

    expect(menge.map((s) => [s.family, s.descriptors])).toEqual(
      SCHRIFTSCHNITTE.map((s) => [
        s.familie,
        { weight: String(s.gewicht), style: 'normal', display: 'swap' },
      ]),
    );
    expect(menge[0].source).toBe(
      `url(${JSON.stringify(SCHRIFTSCHNITTE[0].datei)}) format('woff2')`,
    );
    // Vor dem ersten Bild nur, was der Bildschirm braucht (LLH-1272); der Rest kommt danach.
    expect(geladen).toEqual(BILDSCHIRM);
    vi.runAllTimers();
    expect([...geladen].sort()).toEqual(SCHRIFTSCHNITTE.map(name).sort());
  });
});

/** Die Schnitte, die das erste Bild trägt (LLH-1272, design.md D2), als `Familie Gewicht`. */
const BILDSCHIRM = [
  'LFH Archivo 400',
  'LFH Archivo 500',
  'LFH Archivo 600',
  'LFH Archivo Narrow 600',
  'LFH JetBrains Mono 400',
  'LFH JetBrains Mono 500',
];

const name = (s: { familie: string; gewicht: number }) => `${s.familie} ${s.gewicht}`;

class StubSchnitt {
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {}
  load(): Promise<StubSchnitt> {
    return Promise.resolve(this);
  }
}

/**
 * `FontFace` gestubbt: `geladen` zählt jedes `load()`, `antwort` entscheidet je Schnitt, wie sein
 * Laden ausgeht (Vorgabe: sofort fertig).
 */
function stubFontFace(antwort: (name: string) => Promise<unknown> = () => Promise.resolve()) {
  const geladen: string[] = [];
  class Schnitt extends StubSchnitt {
    load() {
      const n = `${this.family} ${this.descriptors.weight}`;
      geladen.push(n);
      return antwort(n).then(() => this);
    }
  }
  vi.stubGlobal('FontFace', Schnitt);
  return { menge: [] as StubSchnitt[], geladen };
}

/** Ob ein Promise erfüllt ist, nachdem die anstehenden Mikroaufgaben gelaufen sind. */
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  let fertig = false;
  void p.then(() => (fertig = true));
  await vi.advanceTimersByTimeAsync(0);
  return fertig;
}

describe('Bildschirm-Schriften vor dem ersten Bild (LLH-1272)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const anmelden = (menge: StubSchnitt[]) =>
    registerSchriften({ add: (s: StubSchnitt) => menge.push(s) } as unknown as FontFaceSet);

  it('kennzeichnet genau Archivo 400/500/600, Archivo Narrow 600 und JetBrains Mono 400/500', () => {
    expect(SCHRIFTSCHNITTE.filter((s) => s.bildschirm).map(name)).toEqual(BILDSCHIRM);
  });

  it('erfüllt sich, sobald die sechs Bildschirm-Schnitte geladen sind', async () => {
    vi.useFakeTimers();
    const offen = new Map<string, () => void>();
    const { menge, geladen } = stubFontFace(
      (n) => new Promise<void>((fertig) => offen.set(n, fertig)),
    );
    const bereit = anmelden(menge);
    expect(geladen).toEqual(BILDSCHIRM);
    for (const n of BILDSCHIRM.slice(0, -1)) offen.get(n)!();
    expect(await isSettled(bereit), 'ein Schnitt fehlt noch').toBe(false);
    offen.get(BILDSCHIRM[BILDSCHIRM.length - 1])!();
    expect(await isSettled(bereit)).toBe(true);
  });

  it(`erfüllt sich bei einem hängenden Schnitt genau nach ${SCHRIFT_FRIST_MS} ms, nicht davor`, async () => {
    vi.useFakeTimers();
    const { menge } = stubFontFace((n) =>
      n === 'LFH Archivo 500' ? new Promise<void>(() => {}) : Promise.resolve(),
    );
    const bereit = anmelden(menge);
    await vi.advanceTimersByTimeAsync(SCHRIFT_FRIST_MS - 1);
    expect(await isSettled(bereit), 'vor der Frist').toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await isSettled(bereit), 'nach der Frist').toBe(true);
  });

  it('erfüllt sich sofort, wenn ein Schnitt scheitert und die übrigen geladen sind', async () => {
    vi.useFakeTimers();
    const { menge } = stubFontFace((n) =>
      n === 'LFH JetBrains Mono 400' ? Promise.reject(new Error('404')) : Promise.resolve(),
    );
    expect(await isSettled(anmelden(menge))).toBe(true);
  });

  it('wartet auf keinen Schnitt außerhalb des Bildschirms', async () => {
    vi.useFakeTimers();
    const { menge } = stubFontFace((n) =>
      BILDSCHIRM.includes(n) ? Promise.resolve() : new Promise<void>(() => {}),
    );
    const bereit = anmelden(menge);
    vi.runAllTimers();
    expect(await isSettled(bereit)).toBe(true);
  });
});
