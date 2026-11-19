import LifelineKern
import SwiftUI

/// Serverliste als Blatt (Spec `ios-huelle`, „Mehrere Server lassen sich verwalten“): Name,
/// Adresse, zuletzt verbunden; wechseln, umbenennen, hinzufügen und entfernen (nicht den aktiven,
/// nach einer Rückfrage mit dem Hinweis auf nicht übertragene Einträge). „Zur Oberfläche“ und ein
/// Tipp auf den aktiven Server laden dessen Startadresse neu, der Weg zurück von einer fremden
/// Seite im Webview (`Ablauf`, `.zurOberflaeche`).
struct ServerlisteView: View {
    @Environment(AppModell.self) private var modell
    @State private var umbenennen: ServerEintrag?
    @State private var neuerName = ""
    @State private var zeigtHinzufuegen = false
    @State private var entfernen: ServerEintrag?

    var body: some View {
        NavigationStack {
            List {
                if modell.bietetZurOberflaeche {
                    Section {
                        Button("Zur Oberfläche", systemImage: "arrow.uturn.backward") {
                            modell.zurOberflaeche()
                        }
                        .accessibilityIdentifier("zur-oberflaeche")
                    } footer: {
                        Text("Lädt die Startseite von „\(modell.liste.aktiv?.name ?? "")“ neu.")
                    }
                }
                Section {
                    ForEach(modell.liste.eintraege) { eintrag in
                        zeile(eintrag)
                    }
                } footer: {
                    Text("Jeder Server hat seine eigene Anmeldung und seine eigenen Offline-Daten.")
                }
                Section {
                    NavigationLink {
                        EinstellungenView()
                    } label: {
                        Label("Einstellungen", systemImage: "gearshape")
                    }
                    .accessibilityIdentifier("einstellungen-link")
                }
            }
            .accessibilityIdentifier("serverliste")
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { modell.zeigtServerliste = false }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Server hinzufügen", systemImage: "plus") {
                        modell.onboarding = .start
                        zeigtHinzufuegen = true
                    }
                }
            }
            // Im Stapel statt als zweites Blatt: SwiftUI zeigt kein Blatt, während ein anderes schließt.
            .navigationDestination(isPresented: $zeigtHinzufuegen) {
                OnboardingView(alsBlatt: true, mitAbbrechen: false)
            }
            .alert(
                "Server umbenennen",
                isPresented: Binding(get: { umbenennen != nil }, set: { if !$0 { umbenennen = nil } }),
                presenting: umbenennen
            ) { eintrag in
                TextField(eintrag.adresse.host, text: $neuerName)
                Button("Sichern") { modell.rename(eintrag, to: neuerName) }
                Button("Abbrechen", role: .cancel) {}
            } message: { _ in
                Text("Ein leerer Name zeigt den Hostnamen.")
            }
            .confirmationDialog(
                entfernen.map(Serverentfernung.rueckfrageTitel) ?? "",
                isPresented: Binding(get: { entfernen != nil }, set: { if !$0 { entfernen = nil } }),
                titleVisibility: .visible,
                presenting: entfernen
            ) { eintrag in
                Button("Server entfernen", role: .destructive) { modell.entfernen(eintrag) }
                    .accessibilityIdentifier("entfernen-bestaetigen")
                Button("Abbrechen", role: .cancel) {}
            } message: { _ in
                Text(Serverentfernung.hinweis)
            }
            .alert(
                "Server nicht entfernt",
                isPresented: Binding(
                    get: { modell.entfernenFehler != nil },
                    set: { if !$0 { modell.entfernenFehler = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(modell.entfernenFehler ?? "")
            }
        }
    }

    private func zeile(_ eintrag: ServerEintrag) -> some View {
        let istAktiv = eintrag.id == modell.liste.aktiv?.id
        return Button {
            if istAktiv { modell.zurOberflaeche() } else { modell.wechseln(eintrag) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: istAktiv ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(istAktiv ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(eintrag.name).font(.body.weight(istAktiv ? .semibold : .regular))
                    Text(eintrag.adresse.text).font(.footnote).foregroundStyle(.secondary)
                    Text(zuletzt(eintrag)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if istAktiv {
                    Text("Aktiv").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(istAktiv ? .isSelected : [])
        // Ohne Durchwischen: nach einem langen Wisch über zwei Drittel der Zeile waren auf dem iPhone
        // weder die Aktionen offen noch die Rückfrage da (UI-Hierarchie im xcresult, Lauf
        // 44427089802). So bleiben die Aktionen nach jedem Wisch offen, Entfernen ist ein Tipp.
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Kein `role: .destructive`: der Eintrag verschwindet erst nach der Rückfrage.
            if modell.isEntfernbar(eintrag) {
                Button("Entfernen") { entfernen = eintrag }
                    .tint(.red)
            }
            Button("Umbenennen") {
                neuerName = eintrag.name
                umbenennen = eintrag
            }
            .tint(.blue)
        }
        .contextMenu {
            Button("Umbenennen", systemImage: "pencil") {
                neuerName = eintrag.name
                umbenennen = eintrag
            }
            if modell.isEntfernbar(eintrag) {
                Button("Entfernen", systemImage: "trash", role: .destructive) { entfernen = eintrag }
            }
        }
        .disabled(eintrag.id == modell.inEntfernung)
    }

    private func zuletzt(_ eintrag: ServerEintrag) -> String {
        guard let zeit = eintrag.zuletztVerbunden else { return "Noch nie verbunden" }
        return "Zuletzt verbunden " + zeit.formatted(date: .abbreviated, time: .shortened)
    }
}
