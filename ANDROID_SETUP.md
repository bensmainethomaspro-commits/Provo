# Provo — Distribution Android

## Architecture

```
Push code → GitHub Actions build l'APK → APK disponible en téléchargement
```

---

## Phase 1 : APK debug (gratuit, immédiat)

Chaque push sur `main` génère un APK debug téléchargeable dans l'onglet
**Actions → ton workflow → Artifacts** sur GitHub.

Limites du debug APK :
- Fonctionne parfaitement
- Affiche "app-debug.apk" comme nom
- Ne peut pas être publié sur le Play Store

---

## Phase 2 : APK release signé (nécessaire pour partager proprement)

### 1. Génère le keystore (UNE FOIS, sur ton PC)

Installe Java si pas déjà fait : https://adoptium.net

Puis dans un terminal :
```cmd
keytool -genkey -v -keystore release.keystore -alias provo -keyalg RSA -keysize 2048 -validity 10000
```
Mémorise bien le mot de passe — sans lui, impossible de mettre à jour l'app.

### 2. Convertis le keystore en base64

```cmd
certutil -encode release.keystore keystore_b64.txt
```
Ouvre `keystore_b64.txt` et copie tout le contenu (sans les lignes BEGIN/END).

### 3. Ajoute ces 4 secrets dans GitHub

GitHub → Settings → Secrets and variables → Actions → New repository secret

| Nom du secret      | Valeur                              |
|--------------------|-------------------------------------|
| `KEYSTORE_BASE64`  | Le contenu base64 du keystore       |
| `KEYSTORE_PASSWORD`| Le mot de passe du keystore         |
| `KEY_ALIAS`        | `provo`                             |
| `KEY_PASSWORD`     | Le mot de passe de la clé (idem)    |

### 4. Crée un tag pour déclencher une release

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions buildra l'APK signé et créera une Release avec le fichier APK
en téléchargement direct. Tu partages ce lien à tes utilisateurs.

---

## Phase 3 : Google Play Store (25 $ unique)

Une fois que tu as un APK release signé qui fonctionne :

1. Crée un compte Google Play Developer : https://play.google.com/console
2. Crée une nouvelle application
3. Upload le fichier `.aab` (bundle) plutôt que `.apk` :
   ```
   ./gradlew bundleRelease
   ```
4. Remplis la fiche store (description, captures d'écran, icône)
5. Soumets pour review (2-3 jours)

---

## Mises à jour

Pour mettre à jour l'app :
```bash
# Modifie le numéro de version dans android/app/build.gradle :
# versionCode 2   (incrémente à chaque release)
# versionName "1.1"

git tag v1.1.0
git push origin v1.1.0
```

Les utilisateurs qui ont installé depuis le Play Store reçoivent la mise à jour
automatiquement. Ceux qui ont l'APK direct doivent télécharger la nouvelle
version (leurs données sont conservées car même applicationId).

---

## Structure des fichiers importants

```
android/                    → Projet Android natif (commité dans git)
  app/
    build.gradle            → Version de l'app (versionCode, versionName)
    src/main/
      AndroidManifest.xml   → Permissions, config
      assets/public/        → Build web copié par Capacitor
      res/
        mipmap-*/           → Icônes de l'app
capacitor.config.json       → Config Capacitor
.github/workflows/
  build-android.yml         → Pipeline CI/CD
```
