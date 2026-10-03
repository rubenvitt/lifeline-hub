import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Upload } from 'antd';
import { describe, expect, it } from 'vitest';

/**
 * Wächter für den Timer-Drain in ./setup.ts (LFH-784): antds Upload-Listeneintrag setzt beim
 * Mounten einen 300-ms-Timer, den er beim Unmount nicht abräumt. Diese Datei endet deshalb
 * ABSICHTLICH direkt nach dem Upload. Wartet der Drain am Dateiende zu kurz, feuert der Timer nach
 * dem jsdom-Abbau, und Vitest meldet „window is not defined“ als Unhandled Error — der Lauf ist
 * rot, obwohl der Test selbst grün ist. Hinter den letzten Test gehört hier nichts mehr.
 *
 * Lokal ist die Datei auch mit zu kurzem Drain meist grün, weil der Worker vor dem Timer endet;
 * rot wird sie unter Last. Reproduzierbar macht das die Probe im PR zu LFH-784 (Hauptprozess
 * kurz blockiert, stdout-Pipe des Workers voll).
 */
describe('Timer-Drain nach einer Upload-Liste (LFH-784)', () => {
  it('endet direkt nach dem Mount eines Upload-Listeneintrags', async () => {
    const { container } = render(
      <Upload beforeUpload={() => false}>
        <button type="button">Datei wählen</button>
      </Upload>,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, new File(['x'], 'dach.jpg'));
    expect(container.querySelector('.ant-upload-list-item')).not.toBeNull();
  });
});
