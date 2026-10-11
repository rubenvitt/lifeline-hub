import { describe, expect, it } from 'vitest';
import { istVersionVor } from './version';
import { istUngelesen } from './useVersionsstand';

describe('istVersionVor', () => {
  it('ordnet nach Haupt-, Neben- und Patchnummer', () => {
    expect(istVersionVor('1.0.0', '1.0.1')).toBe(true);
    expect(istVersionVor('1.2.0', '1.10.0')).toBe(true);
    expect(istVersionVor('2.0.0', '1.9.9')).toBe(false);
  });

  it('ordnet Vorabversionen numerisch, nicht als Text', () => {
    expect(istVersionVor('1.0.0-alpha.99', '1.0.0-alpha.100')).toBe(true);
    expect(istVersionVor('1.0.0-alpha.106', '1.0.0-alpha.100')).toBe(false);
  });

  it('stellt Alpha vor Beta und beide vor die stabile Version', () => {
    expect(istVersionVor('1.0.0-alpha.106', '1.0.0-beta.1')).toBe(true);
    expect(istVersionVor('1.0.0-beta.3', '1.0.0')).toBe(true);
    expect(istVersionVor('1.0.0', '1.0.0-alpha.106')).toBe(false);
  });

  it('ist bei gleicher Version falsch', () => {
    expect(istVersionVor('1.0.0-alpha.106', '1.0.0-alpha.106')).toBe(false);
  });

  it('nimmt eine unlesbare Version als verschieden, damit kein Hinweis verloren geht', () => {
    expect(istVersionVor('irgendwas', '1.0.0')).toBe(true);
    expect(istVersionVor('1.0.0', '1.0.0')).toBe(false);
  });
});

describe('istUngelesen', () => {
  it('gilt, solange der Lesestand vor der laufenden Version liegt', () => {
    expect(istUngelesen({ laufend: '1.0.0-alpha.106', gelesen_bis: '1.0.0-alpha.100' })).toBe(true);
    expect(istUngelesen({ laufend: '1.0.0-alpha.106', gelesen_bis: '1.0.0-alpha.106' })).toBe(
      false,
    );
  });

  it('gilt nach einer Rückkehr auf eine ältere Version nicht', () => {
    expect(istUngelesen({ laufend: '1.0.0-alpha.100', gelesen_bis: '1.0.0-alpha.106' })).toBe(
      false,
    );
  });

  it('gilt ohne Stand oder ohne Lesestand nicht', () => {
    expect(istUngelesen(undefined)).toBe(false);
    expect(istUngelesen({ laufend: '1.0.0-alpha.106' })).toBe(false);
  });
});
