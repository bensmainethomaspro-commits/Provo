#!/bin/bash
# Génère le keystore de signature pour l'APK release
# À exécuter UNE SEULE FOIS sur ta machine, puis conserver le fichier en sécurité

echo "=== Génération du keystore Provo ==="
echo ""
echo "Tu vas devoir entrer :"
echo "  - Un mot de passe pour le keystore (ex: MotDePasse123!)"
echo "  - Ton prénom/nom (pour le certificat)"
echo ""

keytool -genkey -v \
  -keystore release.keystore \
  -alias provo \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "${KEYSTORE_PASSWORD:-changeme}" \
  -keypass "${KEY_PASSWORD:-changeme}" \
  -dname "CN=Provo App, OU=Mobile, O=Provo, L=Paris, S=IDF, C=FR"

echo ""
echo "=== Keystore créé : release.keystore ==="
echo ""
echo "Convertis-le en base64 pour GitHub Secrets :"
echo "  Linux/Mac : base64 -w 0 release.keystore"
echo "  Windows   : certutil -encode release.keystore keystore.b64 && type keystore.b64"
echo ""
echo "⚠️  NE COMMIT PAS release.keystore — il est dans .gitignore"
