// Helfer-App „Lifeline Helfer“ (ADR-0101, Regeln android/helfer/AGENTS.md): eigene native App mit
// Compose, eigene Application-ID, derselbe Signierschlüssel wie `:app`. Was ohne Android geht,
// entscheidet der Kern `dev.rubeen.lifeline:helferkern`; hier stehen Oberfläche, Dienst und
// Systemdienste. Plugins und Versionen wie `:app` (android/app/build.gradle.kts).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.roborazzi)
}

// Version der Helfer-App: eine Zählung für iOS und Android, `HELFER_VERSION` in
// scripts/ios/helfer-version.sh (einzige Stelle). `versionCode` setzt android-helfer.yml aus der
// Laufnummer (`HELFER_VERSION_CODE`); ein lokaler Bau hat 1.
val helferVersion: String = providers.fileContents(layout.projectDirectory.file("../../scripts/ios/helfer-version.sh"))
    .asText
    .map { text -> Regex("""(?m)^HELFER_VERSION="([^"]+)"""").find(text)?.groupValues?.get(1) ?: "0.0.0-dev" }
    .orElse("0.0.0-dev")
    .get()
val helferVersionCode: Int = providers.environmentVariable("HELFER_VERSION_CODE").orElse("1").get().toInt()

// Signatur der Release-APK: derselbe Schlüssel wie die Lifeline-App (android/AGENTS.md,
// „Signierschlüssel wechselt nie“; Spec „Ablage im Repo, Bauen, Verteilen“). android-helfer.yml legt
// den Keystore aus ANDROID_KEYSTORE_BASE64 ab und setzt die vier Variablen; fehlt eine, entsteht eine
// unsignierte APK (lokal und in android-pruefung.yml).
val keystorePath: String? = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
val keystorePassword: String? = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val signingKeyAlias: String? = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val signingKeyPassword: String? = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
val isReleaseSigned: Boolean =
    listOf(keystorePath, keystorePassword, signingKeyAlias, signingKeyPassword).all { !it.isNullOrEmpty() }

android {
    namespace = "dev.rubeen.lifeline.helfer"
    // Wie `:app`: übersetzt gegen 37.1 (Compose-BOM), Laufzeitverhalten targetSdk 36.
    compileSdk {
        version = release(37) { minorApiLevel = 1 }
    }

    defaultConfig {
        applicationId = "dev.rubeen.lifeline.helfer"
        minSdk = 29
        targetSdk = 36
        versionName = helferVersion
        versionCode = helferVersionCode

        // Nur die ABIs echter Geräte: ML Kit (QR-Code) bringt native Bibliotheken je ABI mit.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    signingConfigs {
        if (isReleaseSigned) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Ohne R8 wie `:app`: die App ist dünn, die Wire-Typen liegen im Kern.
            isMinifyEnabled = false
            if (isReleaseSigned) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        // `android-all` vom Spiegel wie in `:app` (Kopf von kern/settings.gradle.kts).
        unitTests.all {
            it.systemProperty(
                "robolectric.dependency.repo.url",
                "https://maven-central.storage-download.googleapis.com/maven2",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

// Bildlauf: jede Seite als Bild unter `build/bilder/` (Bilder der Änderung), ohne Sollbilder.
roborazzi {
    outputDir = layout.buildDirectory.dir("bilder")
}

dependencies {
    implementation("dev.rubeen.lifeline:helferkern")
    // `ServerAdresse` steht in der API des Helfer-Kerns (`HelferZiel.server`).
    implementation("dev.rubeen.lifeline:kern")
    // Die Wire-Typen des Kerns sind `@Serializable`; ihre Laufzeit braucht auch die App.
    implementation(libs.kotlinx.serialization.json)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    // `ViewModel`/`viewModelScope`, `LocalLifecycleOwner` und `Dispatchers.Main` ausdrücklich, nicht
    // nur transitiv über activity-compose und Compose.
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.camera.mlkit.vision)
    implementation(libs.mlkit.barcode)

    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
