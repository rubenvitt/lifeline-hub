import LifelineKern
import SwiftUI

/// Serverliste als Blatt (Spec `ios-huelle`, „Mehrere Server lassen sich verwalten“): Name,
/// Adresse, zuletzt verbunden; wechseln, umbenennen, hinzufügen. Entfernen kommt mit tasks.md
/// 8.11 (Rückfrage, Datenspeicher löschen).
struct ServerlisteView: View {
    @Environment(AppModell.self) private var modell
    @State private var umbenennen: ServerEintrag?
    @State private var neuerName = ""
    @State private var zeigtHinzufuegen = false

    var body: some View {
        NavigationStack {
            List {
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
        }
    }

    private func zeile(_ eintrag: ServerEintrag) -> some View {
        let istAktiv = eintrag.id == modell.liste.aktiv?.id
        return Button {
            if !istAktiv { modell.wechseln(eintrag) }
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
        .swipeActions(edge: .trailing) {
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
        }
    }

    private func zuletzt(_ eintrag: ServerEintrag) -> String {
        guard let zeit = eintrag.zuletztVerbunden else { return "Noch nie verbunden" }
        return "Zuletzt verbunden " + zeit.formatted(date: .abbreviated, time: .shortened)
    }
}
