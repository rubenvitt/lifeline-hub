import { expect, type Page } from '@playwright/test';

/**
 * Hängender Baum-Einzug in `Datensicht` (LFH-977): Messung und Zusicherungen für jede Baumtabelle.
 *
 * antd setzt Einzug (`.ant-table-row-indent`, 1 px hoch) und Aufklappsymbol als FLOATS vor den
 * Zelleninhalt. Fließt der Inhalt daneben, landet jede Folgezeile unter den 1 px am linken
 * Zellrand, und ein zu breites atomares Inline-Element (Titel-Link, `inline-flex`) rutscht ganz
 * unter die Floats: der Text steht links von seiner Elternzeile, das Symbol allein darüber.
 *
 * Gemessen wird am TEXT, nicht an Zellen oder Hüllen: der Textanfang ist das linke Ende der ersten
 * Zeilenbox des ersten nichtleeren Textknotens (`Range.getClientRects`), Folgezeilen sind alle
 * weiteren Zeilenboxen der Zelle.
 */

const SUBPIXEL = 0.5;

export interface BaumZeile {
  schluessel: string;
  text: string;
  /** Aus antds `indent-level-N`, die einzige Tiefe, die die Tabelle selbst zeichnet. */
  ebene: number;
  /** Linkes Ende der ersten Zeilenbox. */
  anfang: number;
  /**
   * Linkes Ende des Zelleninhalts hinter Einzug und Symbol, Zeichen (`EinheitZeichen`) und
   * Folgezeilen eingeschlossen: das Minimum über die Boxen aller übrigen Elemente der Zelle.
   */
  inhalt: number;
  /** Linkestes Ende aller Zeilenboxen (Folgezeilen eingeschlossen). */
  linkesteZeile: number;
  /** Rechtes Ende der längsten Zeilenbox und rechte Innenkante der Zelle. */
  textRechts: number;
  zelleRechts: number;
  /** Anzahl verschiedener Zeilenoberkanten: > 1 heißt, der Text bricht um. */
  zeilen: number;
  ersteOben: number;
  ersteUnten: number;
  /** Echtes Aufklappsymbol (kein Platzhalter eines Blatts), sonst `null`. */
  symbol: { oben: number; unten: number } | null;
}

/** Misst jede Baumzeile unter `wurzel` (CSS-Selektor des Tabellenbereichs). */
export function baumLage(page: Page, wurzel: string): Promise<BaumZeile[]> {
  return page.evaluate(async (selektor) => {
    await document.fonts.ready;
    const bereich = document.querySelector(selektor);
    if (!bereich) throw new Error(`Baumwurzel fehlt: ${selektor}`);
    return Array.from(bereich.querySelectorAll('tr.ant-table-row')).map((tr) => {
      const zelle = tr.querySelector('td.ant-table-cell-with-append');
      if (!zelle) throw new Error(`Zeile ohne Baumzelle: ${tr.getAttribute('data-row-key')}`);
      const einzug = zelle.querySelector('.ant-table-row-indent');
      const ebene = Number(/indent-level-(\d+)/.exec(einzug?.className ?? '')?.[1] ?? 0);
      const kasten: DOMRect[] = [];
      let text = '';
      const gang = document.createTreeWalker(zelle, NodeFilter.SHOW_TEXT);
      for (let knoten = gang.nextNode(); knoten; knoten = gang.nextNode()) {
        if (!knoten.textContent?.trim()) continue;
        text += knoten.textContent;
        const bereich = document.createRange();
        bereich.selectNodeContents(knoten);
        for (const r of Array.from(bereich.getClientRects())) if (r.width > 0) kasten.push(r);
      }
      if (kasten.length === 0) throw new Error(`Baumzelle ohne Text: ${tr.textContent}`);
      const symbol = zelle.querySelector(
        '.ant-table-row-expand-icon:not(.ant-table-row-expand-icon-spaced)',
      );
      const s = symbol?.getBoundingClientRect();
      // Jedes Element, das weder Einzug noch Symbol ist noch eines davon enthält: so zählt eine
      // Hülle um Symbol und Text nicht, der Textblock daneben schon (unabhängig vom Aufbau).
      const randKnoten = Array.from(
        zelle.querySelectorAll('.ant-table-row-indent, .ant-table-row-expand-icon'),
      );
      const inhalt = Array.from(zelle.querySelectorAll('*'))
        .filter((e) => !randKnoten.some((r) => e === r || e.contains(r) || r.contains(e)))
        .flatMap((e) => Array.from(e.getClientRects()))
        .filter((r) => r.width > 0)
        .map((r) => r.left);
      return {
        schluessel: tr.getAttribute('data-row-key') ?? '',
        text: text.trim(),
        ebene,
        anfang: kasten[0].left,
        inhalt: Math.min(...inhalt, ...kasten.map((r) => r.left)),
        textRechts: Math.max(...kasten.map((r) => r.right)),
        zelleRechts:
          zelle.getBoundingClientRect().right - parseFloat(getComputedStyle(zelle).paddingRight),
        linkesteZeile: Math.min(...kasten.map((r) => r.left)),
        zeilen: new Set(kasten.map((r) => Math.round(r.top))).size,
        ersteOben: kasten[0].top,
        ersteUnten: kasten[0].bottom,
        symbol: s ? { oben: s.top, unten: s.bottom } : null,
      };
    });
  }, wurzel);
}

/**
 * Die Akzeptanzkriterien je Zeile: Text rechts vom Textanfang der Elternzeile (die nächste
 * vorausgehende Zeile eine Ebene höher), Folgezeilen nicht links vom eigenen Textanfang, kein
 * Text über die Zelle hinaus, das Symbol in derselben Zeile wie der Textanfang.
 *
 * `vergleich: 'inhalt'` misst die Stufe am Inhaltsanfang statt am Text: im Meldebild trägt die
 * Einheit ein Zeichen vor dem Namen, ihre Kräfte nicht, der Text der Kinder steht dort also
 * bewusst links vom Namen der Einheit.
 */
export function pruefeHaengendenEinzug(
  zeilen: BaumZeile[],
  wo: string,
  vergleich: 'text' | 'inhalt' = 'text',
) {
  const lage = (z: BaumZeile) => (vergleich === 'text' ? z.anfang : z.inhalt);
  for (const [i, z] of zeilen.entries()) {
    const name = `${wo}: „${z.text}“ (Ebene ${z.ebene})`;
    expect(
      z.linkesteZeile,
      `${name}: Folgezeile ${z.linkesteZeile}px links vom Textanfang ${z.anfang}px`,
    ).toBeGreaterThanOrEqual(z.anfang - SUBPIXEL);
    expect(
      z.textRechts,
      `${name}: Text ragt bis ${z.textRechts}px über die Zelle (${z.zelleRechts}px) hinaus`,
    ).toBeLessThanOrEqual(z.zelleRechts + SUBPIXEL);
    if (z.symbol) {
      expect(
        z.symbol.oben < z.ersteUnten && z.symbol.unten > z.ersteOben,
        `${name}: Symbol ${z.symbol.oben}–${z.symbol.unten}px nicht in der ersten Textzeile ${z.ersteOben}–${z.ersteUnten}px`,
      ).toBe(true);
    }
    if (z.ebene === 0) continue;
    const eltern = zeilen
      .slice(0, i)
      .reverse()
      .find((e) => e.ebene === z.ebene - 1);
    expect(eltern, `${name}: keine Elternzeile davor`).toBeDefined();
    expect(
      lage(z),
      `${name}: ${vergleich}anfang ${lage(z)}px nicht rechts von „${eltern!.text}“ (${lage(eltern!)}px)`,
    ).toBeGreaterThan(lage(eltern!) + SUBPIXEL);
  }
}
