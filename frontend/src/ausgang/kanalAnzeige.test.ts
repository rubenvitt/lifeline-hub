import { describe, expect, it } from 'vitest';
import { kanalKurz } from './kanalAnzeige';

describe('kanalKurz', () => {
  it('nennt_email_mail_und_matrix_matrix', () => {
    expect(kanalKurz('email')).toBe('Mail');
    expect(kanalKurz('matrix')).toBe('Matrix');
  });

  it('gibt_anderen_kanaelen_ein_eigenes_wort', () => {
    expect(kanalKurz('fax')).toBe('Fax');
    expect(kanalKurz('threema')).toBe('Threema');
  });
});
