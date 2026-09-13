import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Form, Input } from 'antd';
import Einstiegsfokus, { einstiegsAbschnitt } from './Einstiegsfokus';
import MarkdownEditor from '../components/MarkdownEditor';

describe('einstiegsAbschnitt', () => {
  const texte = (m: Record<string, string>) => (s: string) => m[s];

  it('nimmt den ersten Abschnitt OHNE Text', () => {
    expect(einstiegsAbschnitt(['a', 'b', 'c'], texte({ a: 'voll', b: '', c: 'auch voll' }))).toBe(
      'b',
    );
  });

  it('zählt Leerraum nicht als Text (wie `befuellteAbschnitte`)', () => {
    expect(einstiegsAbschnitt(['a', 'b'], texte({ a: '   \n ', b: 'voll' }))).toBe('a');
  });

  it('behandelt einen fehlenden Eintrag als leer', () => {
    // Der Serverstand führt nur die Abschnitte, die es gibt; die Vorlage gibt die Menge vor.
    expect(einstiegsAbschnitt(['a', 'b'], texte({ a: 'voll' }))).toBe('b');
  });

  it('fällt bei VOLLSTÄNDIG befülltem Bericht auf den ersten zurück (Gegenaussage)', () => {
    // „Gar keiner" wäre hier falsch: die Seite ist dann eine Überarbeitung, und der
    // Tastaturweg soll im Text beginnen statt auf `<body>`.
    expect(einstiegsAbschnitt(['a', 'b'], texte({ a: 'voll', b: 'voll' }))).toBe('a');
  });

  it('liefert bei leerer Vorlage nichts', () => {
    expect(einstiegsAbschnitt([], texte({}))).toBeUndefined();
  });
});

/** Zwei Abschnittsfelder wie in den Entwurfsseiten — `MarkdownEditor` über `Form.Item`. */
function Maske({ feld }: { feld?: string }) {
  const [form] = Form.useForm();
  return (
    <Form form={form}>
      <Form.Item label="Titel" name="titel">
        <Input />
      </Form.Item>
      <Form.Item label="Auftrag" name="auftrag">
        <MarkdownEditor />
      </Form.Item>
      <Form.Item label="Eigene Lage" name="eigene_lage">
        <MarkdownEditor />
      </Form.Item>
      <Einstiegsfokus form={form} feld={feld} />
    </Form>
  );
}

describe('Einstiegsfokus', () => {
  it('setzt den Fokus in das benannte Abschnittsfeld', () => {
    // Die tragende Mechanik-Aussage: `form.getFieldInstance` liefert die Ref des Kindes,
    // und `MarkdownEditor` reicht sie per `forwardRef` an antds `Input.TextArea` durch. Im
    // Repo gab es für diesen Weg vorher keinen Konsumenten — ohne den Test wäre die
    // Annahme „das Feld nimmt einen `focus()` an" ungeprüft.
    render(<Maske feld="eigene_lage" />);
    expect(screen.getByLabelText('Eigene Lage')).toHaveFocus();
  });

  it('lässt den Fokus in Ruhe, wenn kein Ziel benannt ist (Gegenaussage)', () => {
    render(<Maske />);
    expect(document.body).toHaveFocus();
  });

  it('STIEHLT keinen Fokus, der schon woanders liegt', async () => {
    // Beide Seiten zeigen bis zum Eintreffen der Daten einen `<Spin>`; das Formular — und
    // damit dieser Effekt — entsteht also Runden nach dem Seitenaufbau. Wer in dieser Zeit
    // die Kopfzeile anfasst, darf nicht aus seinem Ziel gerissen werden. Der Schalter
    // bildet genau diese Abfolge nach: erst Fokus, dann hängt das Formular ein.
    function Spaet() {
      const [da, setDa] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDa(true)}>
            Drucken
          </button>
          {da && <Maske feld="eigene_lage" />}
        </>
      );
    }
    render(<Spaet />);
    const knopf = screen.getByRole('button', { name: 'Drucken' });
    await userEvent.click(knopf);
    expect(await screen.findByLabelText('Eigene Lage')).toBeInTheDocument();
    expect(knopf).toHaveFocus();
  });

  it('friert das Ziel am Mount ein — eine neue Prop holt den Fokus NICHT zurück', () => {
    // Sonst spränge der Fokus weiter, sobald der erste Autosave den Serverstand ändert: der
    // eben befüllte Abschnitt ist dann nicht mehr der erste leere.
    //
    // GEMESSEN: der Fokus muss dafür ZWISCHENDURCH auf `<body>` fallen (jemand hat sein
    // Feld verlassen). Bleibt er im Feld, deckt schon der Diebstahl-Riegel den Fall ab —
    // ein Test ohne dieses `blur()` bleibt auch OHNE das Einfrieren grün und belegt nichts.
    const { rerender } = render(<Maske feld="auftrag" />);
    const auftrag = screen.getByLabelText('Auftrag');
    expect(auftrag).toHaveFocus();
    auftrag.blur();
    rerender(<Maske feld="eigene_lage" />);
    expect(screen.getByLabelText('Eigene Lage')).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});
