import { describe, expect, it } from 'vitest';
import { ZUGRIFF_ART_TEXT, zugriffArtText } from './zugriffArt';

describe('zugriffArtText (LFH-757)', () => {
  it('nennt jede Art des Zugriffsprotokolls im Klartext', () => {
    expect(ZUGRIFF_ART_TEXT).toEqual({
      detail: 'Detail geöffnet',
      export: 'Liste exportiert',
      druck: 'Liste gedruckt',
      anhang: 'Datei geladen',
    });
    expect(zugriffArtText('anhang')).toBe('Datei geladen');
  });
});
