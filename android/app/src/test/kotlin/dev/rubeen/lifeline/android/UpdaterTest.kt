package dev.rubeen.lifeline.android

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import dev.rubeen.lifeline.android.ui.LifelineThema
import dev.rubeen.lifeline.android.update.Installation
import dev.rubeen.lifeline.android.update.Installationsstatus
import dev.rubeen.lifeline.android.update.PaketErsetzt
import dev.rubeen.lifeline.android.update.Updateabruf
import dev.rubeen.lifeline.android.update.UpdatePruefung
import dev.rubeen.lifeline.android.update.Updater
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Installzeitpunkt
import dev.rubeen.lifeline.kern.Kanal
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.Serverablage
import dev.rubeen.lifeline.kern.ShellAbruf
import dev.rubeen.lifeline.kern.Updatestand
import java.io.File
import java.time.Duration
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking

/**
 * Der Updater (Entwurf D9): Manifest des eigenen Kanals, APK nur von GitHub mit passender
 * `sha256`, Installation nie mitten in der Arbeit. GitHub ersetzt ein Testserver: jede geprüfte
 * `https`-Adresse geht an ihn, mit dem Host als erstem Pfadteil.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class UpdaterTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @get:Rule
    val ordner = TemporaryFolder()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val app = context as LifelineApp
    private val einstellungen = context.getSharedPreferences("lifeline", Context.MODE_PRIVATE)
    private val updateOrdner = File(context.noBackupFilesDir, "update")
    private var jetzt = 1_800_000_000_000L
    private val minute = 60_000L

    private val apk = ByteArray(200_000) { (it % 251).toByte() }
    private val sha = MessageDigest.getInstance("SHA-256").digest(apk).joinToString("") { "%02x".format(it) }
    private val apkUrl = "https://github.com/rubenvitt/lifeline-hub/releases/download/v1.0.0-alpha.6/lifeline-hub-android-1.0.0-alpha.6.apk"
    private val alphaManifest = "/github.com/rubenvitt/lifeline-hub/releases/download/android-alpha/android.json"

    /** Antworten des Testservers je Pfad (Host vorn); alles andere 404. */
    private val antworten = mutableMapOf<String, () -> MockResponse>()
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                antworten[request.path]?.invoke() ?: MockResponse().setResponseCode(404)
        }
        start()
    }
    private val abruf = Updateabruf { uri -> URI(server.url("/${uri.host}${uri.rawPath}").toString()) }

    private val scope = CoroutineScope(Dispatchers.Unconfined + Job())

    init {
        // Ohne Vorgabe darf die App nicht installieren; die meisten Fälle brauchen die Erlaubnis.
        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
    }

    @After
    fun ende() {
        scope.cancel()
        server.shutdown()
    }

    private fun updater(version: String = "1.0.0-alpha.5", code: Int = 100) =
        Updater(context, abruf, { jetzt }, version, code, Installation(context))

    private fun manifest(version: String = "1.0.0-alpha.6", code: Int = 101, url: String = apkUrl, pruefsumme: String = sha) {
        antworten[alphaManifest] = {
            MockResponse().setBody("""{"version":"$version","version_code":$code,"url":"$url","sha256":"$pruefsumme"}""")
        }
    }

    private fun github(pfad: String, antwort: () -> MockResponse) {
        antworten["/" + URI(pfad).host + URI(pfad).rawPath] = antwort
    }

    private fun apkAntwort() = MockResponse().setBody(Buffer().write(apk))

    /** Pfade der Anfragen seit dem letzten Aufruf. */
    private fun pfade(): List<String> =
        generateSequence { server.takeRequest(50, TimeUnit.MILLISECONDS) }.map { it.path!! }.toList()

    private fun bereit(): Updater {
        manifest()
        github(apkUrl, ::apkAntwort)
        return updater().also { assertEquals(Updatestand.BEREIT, runBlocking { it.pruefen() }) }
    }

    private val sitzungen: List<PackageInstaller.SessionInfo>
        get() = context.packageManager.packageInstaller.allSessions

    // Prüfen und Laden

    @Test
    fun `Manifest mit neuerer Version lädt und prüft die Prüfsumme`() {
        manifest(pruefsumme = "0".repeat(64))
        github(apkUrl, ::apkAntwort)
        val updater = updater()

        assertEquals(Updatestand.FEHLER, runBlocking { updater.pruefen() })
        assertEquals("die APK mit falscher Prüfsumme ist gelöscht", emptyList<String>(), updateOrdner.list()?.toList().orEmpty())
        assertFalse(updater.isBereit)

        manifest()
        assertEquals(Updatestand.BEREIT, runBlocking { updater.pruefen(erzwingen = true) })
        assertEquals(Updatestand.BEREIT, updater.stand.value)
        val datei = File(updateOrdner, "101.apk")
        assertTrue(datei.readBytes().contentEquals(apk))
        assertEquals(listOf("101.apk"), updateOrdner.list()!!.toList())
        assertEquals(101, einstellungen.getInt(Updater.BEREIT_CODE, -1))
        assertEquals(listOf(alphaManifest, "/github.com" + URI(apkUrl).rawPath, alphaManifest, "/github.com" + URI(apkUrl).rawPath), pfade())
    }

    @Test
    fun `GitHub leitet auf seinen Download-Host weiter`() {
        val ziel = "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc"
        manifest()
        github(apkUrl) { MockResponse().setResponseCode(302).setHeader("Location", ziel) }
        github(ziel, ::apkAntwort)

        assertEquals(Updatestand.BEREIT, runBlocking { updater().pruefen() })
        assertEquals("/release-assets.githubusercontent.com/github-production-release-asset/1/abc", pfade().last())
    }

    @Test
    fun `Download von fremdem Host wird nicht geladen`() {
        manifest(url = "https://example.com/lifeline.apk")
        github("https://example.com/lifeline.apk", ::apkAntwort)

        assertEquals(Updatestand.FEHLER, runBlocking { updater().pruefen() })
        assertEquals("nur das Manifest wurde gefragt", listOf(alphaManifest), pfade())

        // Auch eine Weiterleitung von GitHub weg wird nicht verfolgt.
        manifest()
        github(apkUrl) { MockResponse().setResponseCode(302).setHeader("Location", "https://example.com/lifeline.apk") }

        assertEquals(Updatestand.FEHLER, runBlocking { updater().pruefen(erzwingen = true) })
        assertEquals(listOf(alphaManifest, "/github.com" + URI(apkUrl).rawPath), pfade())
        assertEquals(emptyList<String>(), updateOrdner.list()?.toList().orEmpty())
    }

    @Test
    fun `ein älteres oder gleiches Release ist kein Update`() {
        manifest(version = "1.0.0-alpha.5", code = 100)
        github(apkUrl, ::apkAntwort)

        assertEquals(Updatestand.KEINS, runBlocking { updater().pruefen() })
        assertEquals(listOf(alphaManifest), pfade())
    }

    @Test
    fun `geprüft wird höchstens alle vier Stunden, Jetzt prüfen sofort`() {
        manifest(version = "1.0.0-alpha.5", code = 100)
        val updater = updater()

        runBlocking { updater.pruefen() }
        jetzt += 3 * 60 * minute
        runBlocking { updater.pruefen() }
        assertEquals(1, server.requestCount)

        runBlocking { updater.pruefen(erzwingen = true) }
        assertEquals(2, server.requestCount)

        jetzt += 4 * 60 * minute
        runBlocking { updater.pruefen() }
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `ohne Netz bleibt ein bereites Update bereit`() {
        val updater = bereit()
        antworten.clear()

        assertEquals(Updatestand.BEREIT, runBlocking { updater.pruefen(erzwingen = true) })
        assertTrue(updater.isBereit)
    }

    @Test
    fun `ein bereites Update übersteht einen Neustart und verschwindet nach dem Update`() {
        bereit()

        val neu = updater()
        assertEquals(Updatestand.BEREIT, neu.stand.value)
        assertTrue(neu.isBereit)

        // Die neue Fassung läuft: das installierte Update wird weggeräumt.
        val danach = updater(version = "1.0.0-alpha.6", code = 101)
        assertEquals(Updatestand.KEINS, danach.stand.value)
        assertFalse(danach.isBereit)
        assertEquals(emptyList<String>(), updateOrdner.list()?.toList().orEmpty())
    }

    // Kanal

    @Test
    fun `Kanal bleibt nach einem Update auf stabil Alpha`() {
        einstellungen.edit(commit = true) { putString(Updater.KANAL, "alpha") }
        manifest(version = "1.0.0", code = 200)

        val updater = updater(version = "1.0.0", code = 200)

        assertEquals(Kanal.ALPHA, updater.kanal)
        assertEquals("alpha", einstellungen.getString(Updater.KANAL, null))
        runBlocking { updater.pruefen() }
        assertEquals(listOf(alphaManifest), pfade())
    }

    @Test
    fun `beim ersten Start wird der Kanal aus der Version gespeichert`() {
        val updater = updater(version = "1.2.0-beta.3", code = 300)

        assertEquals(Kanal.BETA, updater.kanal)
        assertEquals("beta", einstellungen.getString(Updater.KANAL, null))
        // Ein späterer Bau mit anderer Version ändert ihn nicht.
        assertEquals(Kanal.BETA, updater(version = "1.2.0", code = 400).kanal)
    }

    @Test
    fun `ohne Kanal keine Prüfung`() {
        manifest()
        val updater = updater(version = "0.0.0-dev", code = 1)

        assertNull(updater.kanal)
        assertEquals(Updatestand.KEINS, runBlocking { updater.pruefen(erzwingen = true) })
        assertEquals(0, server.requestCount)
        assertFalse(einstellungen.contains(Updater.KANAL))
    }

    // Installation

    @Test
    fun `die Sitzung verlangt keine Rückfrage, wo das System es zulässt`() {
        val parameter = Installation.sitzungsParameter(context.packageName)

        assertEquals(PackageInstaller.SessionParams.MODE_FULL_INSTALL, ReflectionHelpers.getField<Int>(parameter, "mode"))
        assertEquals(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED, ReflectionHelpers.getField<Int>(parameter, "requireUserAction"))
        assertEquals(context.packageName, ReflectionHelpers.getField<String>(parameter, "appPackageName"))
    }

    @Test
    fun `beim Start vor der Oberfläche wird installiert`() {
        val updater = bereit()

        val weg = runBlocking { updater.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) }

        assertEquals(Installzeitpunkt.Weg.INSTALLIEREN, weg)
        assertEquals(Updatestand.INSTALLIERT_GLEICH, updater.stand.value)
        assertEquals(1, sitzungen.size)
    }

    @Test
    fun `im Vordergrund installiert der Updater nicht von selbst`() {
        val updater = bereit()

        assertEquals(Installzeitpunkt.Weg.HINWEIS, runBlocking { updater.installieren(Installzeitpunkt.Lage.VORDERGRUND) })
        assertEquals(Updatestand.BEREIT, updater.stand.value)
        assertTrue(sitzungen.isEmpty())

        // Erst die Person mit „Jetzt installieren“.
        runBlocking { updater.installierenAufWunsch() }
        assertEquals(1, sitzungen.size)
    }

    @Test
    fun `im Hintergrund erst nach 15 Minuten und nur ohne Rückfrage`() {
        val updater = bereit()
        val h = Installzeitpunkt.Lage.HINTERGRUND
        // Erstes Update: installiert hat der Browser, das System würde fragen.
        shadowOf(context.packageManager).setInstallSourceInfo(context.packageName, "com.android.chrome", "com.android.chrome")

        assertEquals(Installzeitpunkt.Weg.WARTEN, runBlocking { updater.installieren(h, jetzt - 14 * minute) })
        assertEquals(Installzeitpunkt.Weg.HINWEIS, runBlocking { updater.installieren(h, jetzt - 15 * minute) })
        assertTrue(sitzungen.isEmpty())

        shadowOf(context.packageManager).setInstallSourceInfo(context.packageName, context.packageName, context.packageName)
        assertEquals(Installzeitpunkt.Weg.INSTALLIEREN, runBlocking { updater.installieren(h, jetzt - 15 * minute) })
        assertEquals(1, sitzungen.size)
    }

    @Test
    fun `ohne Erlaubnis führt der Hinweis in die Systemeinstellung`() {
        val updater = bereit()
        shadowOf(context.packageManager).setCanRequestPackageInstalls(false)

        assertEquals(Installzeitpunkt.Weg.HINWEIS, runBlocking { updater.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) })
        assertEquals(Updatestand.ERLAUBNIS_FEHLT, updater.stand.value)
        assertTrue(sitzungen.isEmpty())
        val einstellung = Installation.erlaubnisIntent(context)
        assertEquals(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, einstellung.action)
        assertEquals("package:${context.packageName}", einstellung.dataString)

        // Zurück aus der Systemeinstellung mit Erlaubnis.
        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
        updater.aktualisiereStand()
        assertEquals(Updatestand.BEREIT, updater.stand.value)
    }

    private fun status(status: Int, vordergrund: Boolean, bestaetigung: Intent? = null) {
        val intent = Intent(context, Installationsstatus::class.java)
            .putExtra(PackageInstaller.EXTRA_STATUS, status)
            .putExtra(Installation.EXTRA_VORDERGRUND, vordergrund)
        bestaetigung?.let { intent.putExtra(Intent.EXTRA_INTENT, it) }
        Installationsstatus().onReceive(context, intent)
    }

    @Test
    fun `eine Rückfrage des Systems zeigt die App nur im Vordergrund`() {
        val updater = bereit().also { app.updater = it }
        val bestaetigung = Intent("android.content.pm.action.CONFIRM_INSTALL")

        runBlocking { updater.installieren(Installzeitpunkt.Lage.HINTERGRUND, jetzt - 20 * minute) }
        status(PackageInstaller.STATUS_PENDING_USER_ACTION, vordergrund = false, bestaetigung)
        assertEquals(Updatestand.BEREIT, updater.stand.value)
        assertNull(shadowOf(app).nextStartedActivity)

        runBlocking { updater.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) }
        status(PackageInstaller.STATUS_PENDING_USER_ACTION, vordergrund = true, bestaetigung)
        assertEquals(Updatestand.INSTALLIERT_GLEICH, updater.stand.value)
        assertEquals("android.content.pm.action.CONFIRM_INSTALL", shadowOf(app).nextStartedActivity.action)

        // Abgelehnt: das Update bleibt bereit.
        status(PackageInstaller.STATUS_FAILURE_ABORTED, vordergrund = true)
        assertEquals(Updatestand.BEREIT, updater.stand.value)
        assertTrue(updater.isBereit)
    }

    @Test
    fun `eine Sperre des Geräts zeigt Installation blockiert und wird nicht still wiederholt`() {
        val updater = bereit().also { app.updater = it }
        runBlocking { updater.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) }

        status(PackageInstaller.STATUS_FAILURE_BLOCKED, vordergrund = true)

        assertEquals(Updatestand.BLOCKIERT, updater.stand.value)
        val neu = updater()
        assertEquals(Updatestand.BLOCKIERT, neu.stand.value)
        assertEquals(Installzeitpunkt.Weg.HINWEIS, runBlocking { neu.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) })
        assertEquals(1, sitzungen.size)
        // „Jetzt prüfen“ hebt die Sperre auf, damit die Person es erneut versuchen kann.
        assertEquals(Updatestand.BEREIT, runBlocking { neu.pruefen(erzwingen = true) })
    }

    @Test
    fun `eine fehlgeschlagene Installation verwirft die APK`() {
        val updater = bereit().also { app.updater = it }

        status(PackageInstaller.STATUS_FAILURE_INVALID, vordergrund = false)

        assertEquals(Updatestand.FEHLER, updater.stand.value)
        assertFalse(updater.isBereit)
        assertEquals(emptyList<String>(), updateOrdner.list()?.toList().orEmpty())
    }

    // Hintergrundarbeit

    private fun workManager(): WorkManager {
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        return WorkManager.getInstance(context)
    }

    /** Ein `CoroutineWorker` läuft auf eigenen Fäden; der Test wartet höchstens fünf Sekunden. */
    private fun warteAufEnde(work: WorkManager, id: UUID): WorkInfo.State {
        repeat(250) {
            shadowOf(Looper.getMainLooper()).idle()
            val zustand = work.getWorkInfoById(id).get()!!.state
            if (zustand.isFinished) return zustand
            Thread.sleep(20)
        }
        return work.getWorkInfoById(id).get()!!.state
    }

    @Test
    fun `die regelmäßige Prüfung läuft alle vier Stunden und nur mit Netz`() {
        val work = workManager()

        UpdatePruefung.planen(context)

        val info = work.getWorkInfosForUniqueWork(UpdatePruefung.PRUEFUNG).get().single()
        assertEquals(4 * 60 * minute, info.periodicityInfo!!.repeatIntervalMillis)
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
    }

    @Test
    fun `ON_STOP plant die Installation nach 15 Minuten, ON_START bricht sie ab`() {
        val work = workManager()

        UpdatePruefung.verlassen(context, jetzt)
        val info = work.getWorkInfosForUniqueWork(UpdatePruefung.HINTERGRUND).get().single()
        assertEquals(WorkInfo.State.ENQUEUED, info.state)
        assertEquals(15 * minute, info.initialDelayMillis)

        UpdatePruefung.rueckkehr(context)
        assertEquals(WorkInfo.State.CANCELLED, work.getWorkInfosForUniqueWork(UpdatePruefung.HINTERGRUND).get().single().state)
    }

    @Test
    fun `nach 15 Minuten im Hintergrund installiert die Arbeit ohne Rückfrage`() {
        val work = workManager()
        app.updater = bereit()
        shadowOf(context.packageManager).setInstallSourceInfo(context.packageName, context.packageName, context.packageName)

        UpdatePruefung.verlassen(context, jetzt)
        jetzt += 15 * minute
        val id = work.getWorkInfosForUniqueWork(UpdatePruefung.HINTERGRUND).get().single().id
        WorkManagerTestInitHelper.getTestDriver(context)!!.setInitialDelayMet(id)

        assertEquals(WorkInfo.State.SUCCEEDED, warteAufEnde(work, id))
        assertEquals(1, sitzungen.size)
        assertEquals(Updatestand.INSTALLIERT_GLEICH, app.updater.stand.value)
    }

    /** Review K1: liegt die Oberfläche inzwischen vorn, installiert die Arbeit nicht. */
    @Test
    fun `steht die Oberfläche wieder vorn, installiert die Arbeit nicht`() {
        val work = workManager()
        app.updater = bereit()
        shadowOf(context.packageManager).setInstallSourceInfo(context.packageName, context.packageName, context.packageName)
        UpdatePruefung.verlassen(context, jetzt)
        jetzt += 15 * minute
        // Die Person öffnet die App, bevor `cancelUniqueWork` die fällige Arbeit erreicht.
        app.imVordergrund = true
        val id = work.getWorkInfosForUniqueWork(UpdatePruefung.HINTERGRUND).get().single().id
        WorkManagerTestInitHelper.getTestDriver(context)!!.setInitialDelayMet(id)

        assertEquals(WorkInfo.State.SUCCEEDED, warteAufEnde(work, id))
        assertTrue(sitzungen.isEmpty())
        assertEquals(Updatestand.BEREIT, app.updater.stand.value)
    }

    /** Review K1: kommt die Oberfläche während des Kopierens nach vorn, übergibt die Arbeit nicht. */
    @Test
    fun `kommt die Oberfläche während des Kopierens nach vorn, wird die Sitzung verworfen`() {
        manifest()
        github(apkUrl, ::apkAntwort)
        // Gefragt wird erst nach dem Kopieren, unmittelbar vor `commit`.
        val updater = Updater(context, abruf, { jetzt }, "1.0.0-alpha.5", 100, Installation(context), imVordergrund = { true })
        assertEquals(Updatestand.BEREIT, runBlocking { updater.pruefen() })
        shadowOf(context.packageManager).setInstallSourceInfo(context.packageName, context.packageName, context.packageName)

        val weg = runBlocking { updater.installieren(Installzeitpunkt.Lage.HINTERGRUND, jetzt - 15 * minute) }

        assertEquals(Installzeitpunkt.Weg.INSTALLIEREN, weg)
        assertTrue("nicht übergeben, verworfen", sitzungen.isEmpty())
        assertEquals(Updatestand.BEREIT, updater.stand.value)
    }

    // Nach dem Update

    @Test
    fun `nach dem Update meldet sich die App, wenn Meldungen erlaubt sind`() {
        val verwaltung = context.getSystemService(NotificationManager::class.java)
        app.updater = updater()

        PaketErsetzt().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))
        assertTrue("ohne Berechtigung keine Meldung", shadowOf(verwaltung).allNotifications.isEmpty())

        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        PaketErsetzt().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

        val meldung = shadowOf(verwaltung).allNotifications.single()
        assertEquals("lifeline", meldung.channelId)
        assertEquals("Lifeline aktualisiert – zum Öffnen tippen", meldung.extras.getString("android.title"))
        assertEquals(MainActivity::class.java.name, shadowOf(meldung.contentIntent).savedIntent.component!!.className)
    }

    // Oberfläche

    @Test
    fun `Start mit bereitem Update zeigt die Seite Lifeline wird aktualisiert`() {
        workManager()
        app.updater = bereit()
        app.webviewFabrik = AttrappenFabrik()

        ActivityScenario.launch(MainActivity::class.java).use { szenario ->
            compose.onNodeWithText("Lifeline wird aktualisiert").assertExists()
            szenario.onActivity { activity ->
                assertNull("die Oberfläche lädt nicht", activity.modell.webView)
                assertEquals(1, sitzungen.size)

                // Die Person lehnt die Rückfrage des Systems ab: die App startet wie sonst.
                status(PackageInstaller.STATUS_FAILURE_ABORTED, vordergrund = true)
                assertFalse(activity.modell.zeigtUpdate)
                assertSame(Ablauf.Seite.Onboarding, activity.modell.seite)
            }
            compose.onNodeWithText("Lifeline wird aktualisiert").assertDoesNotExist()
        }
    }

    @Test
    fun `eine aufgegebene Installation verwirft ihre Sitzung, das Update bleibt bereit`() {
        val updater = bereit()
        runBlocking { updater.installieren(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE) }
        assertEquals(1, sitzungen.size)

        updater.abandonInstallation()

        assertTrue(sitzungen.isEmpty())
        assertEquals(Updatestand.BEREIT, updater.stand.value)
        assertTrue("die APK bleibt", updater.isBereit)
    }

    /** Review K2: ein Neubau der Activity (Schriftgröße, vom System verworfen) installiert nicht. */
    @Test
    fun `ein Neubau der Activity installiert nicht, der Hinweis bleibt`() {
        workManager()
        app.updater = bereit()
        app.webviewFabrik = AttrappenFabrik()

        Robolectric.buildActivity(MainActivity::class.java).setup(android.os.Bundle()).use { steuerung ->
            val modell = steuerung.get().modell
            assertFalse(modell.zeigtUpdate)
            assertTrue(sitzungen.isEmpty())
            assertEquals(Updatestand.BEREIT, app.updater.stand.value)
            assertSame(Ablauf.Seite.Onboarding, modell.seite)
        }
    }

    private fun warte(sekunden: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(sekunden))

    @Test
    fun `zurück aus der Rückfrage ohne Ergebnis lädt nach 3 Sekunden die Oberfläche`() {
        workManager()
        app.updater = bereit()
        app.webviewFabrik = AttrappenFabrik()

        ActivityScenario.launch(MainActivity::class.java).use { szenario ->
            compose.onNodeWithText("Lifeline wird aktualisiert").assertExists()
            // Die Rückfrage des Systems verdeckt die App und geht ohne Ergebnis weg.
            status(PackageInstaller.STATUS_PENDING_USER_ACTION, vordergrund = true, Intent("android.content.pm.action.CONFIRM_INSTALL"))
            szenario.moveToState(Lifecycle.State.STARTED)
            szenario.moveToState(Lifecycle.State.RESUMED)

            warte(2)
            szenario.onActivity { assertTrue("noch in der Frist", it.modell.zeigtUpdate) }
            warte(1)

            szenario.onActivity { activity ->
                assertFalse(activity.modell.zeigtUpdate)
                assertSame(Ablauf.Seite.Onboarding, activity.modell.seite)
            }
            assertEquals("der Hinweis bleibt", Updatestand.BEREIT, app.updater.stand.value)
            // Die übergebene Sitzung ist verworfen: das System installiert nicht später unter der Oberfläche.
            assertTrue(sitzungen.isEmpty())
            compose.onNodeWithText("Lifeline wird aktualisiert").assertDoesNotExist()
        }
    }

    @Test
    fun `ohne Ergebnis lädt die Oberfläche spätestens nach 60 Sekunden`() {
        workManager()
        app.updater = bereit()
        app.webviewFabrik = AttrappenFabrik()

        ActivityScenario.launch(MainActivity::class.java).use { szenario ->
            warte(59)
            szenario.onActivity { assertTrue(it.modell.zeigtUpdate) }
            warte(1)

            szenario.onActivity { assertFalse(it.modell.zeigtUpdate) }
            assertEquals(Updatestand.BEREIT, app.updater.stand.value)
            assertTrue("die Sitzung ist verworfen", sitzungen.isEmpty())
        }
    }

    @Test
    fun `ein wartendes Update zeigt einen Punkt am Knopf zur Serverliste`() {
        val updater = updater()
        val ablage = Serverablage(ordner.root).also { it.save(AppModell.beispielliste()) }
        val modell = AppModell(
            testzustand = null,
            version = "1.0.0-alpha.5",
            build = 100,
            einstellungen = null,
            scope = scope,
            context = context,
            fabrik = AttrappenFabrik(),
            ablage = ablage,
            // Die Prüfung des Servers läuft, solange der Test schaut: der Knopf steht über ihr.
            abrufen = { _: ServerAdresse -> awaitCancellation() },
            dienste = Dienstattrappe(),
            updater = updater,
        )
        modell.start()
        assertTrue(modell.seite is Ablauf.Seite.Pruefung)
        Robolectric.buildActivity(ComponentActivity::class.java).setup().get().setContent {
            LifelineThema { Wurzel(modell) }
        }
        compose.onNodeWithTag("serverliste-knopf").assertExists()
        compose.onNodeWithTag("update-hinweis", useUnmergedTree = true).assertDoesNotExist()

        manifest()
        github(apkUrl, ::apkAntwort)
        runBlocking { updater.pruefen() }

        assertEquals(Updatestand.BEREIT, modell.updatestand)
        compose.onNodeWithTag("update-hinweis", useUnmergedTree = true).assertExists()
        // Im Vordergrund bleibt es beim Hinweis: keine Installation unter der Hand.
        modell.imVordergrund()
        assertTrue(sitzungen.isEmpty())
    }
}
