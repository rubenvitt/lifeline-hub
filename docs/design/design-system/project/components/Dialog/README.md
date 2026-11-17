# Dialog: ErfassungsModal (Felder und Fuß, Serienmodus)

Dieselbe Hülle als Dialog. `footer={null}`, weil die Knöpfe **im** Formular liegen;
`destroyOnHidden`, damit ein geschlossener Dialog keine Felder im Baum stehen lässt.

**`onCancel` wird umschlossen, nicht durchgereicht.** Von den vier Auswegen (Abbrechen,
Schließkreuz, Escape, Maske) läuft nur der erste durch das Formular, und `destroyOnHidden`
fängt die übrigen **nicht** auf: der Speicher von rc-field-form überlebt das Abhängen
(`preserve` per Vorgabe an) und gewinnt beim nächsten Öffnen gegen `initialValues`. Ein
Anlegen-Dialog trüge sonst die Werte des zuletzt bearbeiteten Datensatzes und legte ihn als
Dublette an.

Deshalb besitzen alle vier Wege denselben zentralen Abbruch: Knopf und Escape gehen direkt
durch `ErfassungsFormular.abbrechen`, Kreuz und Maske über `ErfassungsFormularSteuerung`.
Während die Mutation läuft, sind Kreuz und Maske zusätzlich sichtbar gesperrt.

Quelle: `frontend/src/components/Erfassung.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
