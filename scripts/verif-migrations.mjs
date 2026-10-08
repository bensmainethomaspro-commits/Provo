/**
 * Les fichiers de migration portent la version que la base a enregistrée.
 *
 * L'intégration GitHub de Supabase compare, à chaque commit sur `main`,
 * l'historique de la base (`supabase_migrations.schema_migrations`) aux
 * fichiers de `supabase/migrations/`. Une version de la base sans fichier
 * du même numéro, et le contrôle « Supabase Preview » échoue :
 * « Remote migration versions not found in local migrations directory ».
 *
 * Il a échoué sur chaque commit de `main` jusqu'au 8 octobre 2026. Les
 * migrations étaient appliquées par l'outil de la base (qui enregistre une
 * version à la seconde, `20260930151113`), mais rangées sous une date seule
 * (`20260930_pieces_jointes.sql`) ; deux fichiers partageaient même la version
 * `20260930`, et trois migrations de juin n'avaient jamais été versées au
 * dépôt.
 *
 * La règle : un fichier par migration appliquée, nommé
 * `<les 14 chiffres que la base a enregistrés>_<nom>.sql`. Pour connaître la
 * version : `select version, name from supabase_migrations.schema_migrations`.
 *
 * Ce script ne joint pas la base (aucun réseau ici) : il tient la forme, et
 * vérifie que les workflows citent des migrations qui existent.
 *
 * Usage :  node scripts/verif-migrations.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';

const racine = new URL('../', import.meta.url);
const DOSSIER = 'supabase/migrations';
const fichiers = readdirSync(new URL(DOSSIER, racine)).filter(f => f.endsWith('.sql')).sort();

let fautes = 0;
const faute = (msg) => { console.log(`✗ ${msg}`); fautes++; };

const versions = new Map();
for (const f of fichiers) {
  const m = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) {
    faute(`${f} : le nom doit être <14 chiffres de la version enregistrée par la base>_<nom>.sql`);
    continue;
  }
  if (versions.has(m[1])) faute(`${f} et ${versions.get(m[1])} portent la même version ${m[1]}`);
  versions.set(m[1], f);
}

// Un workflow qui lit une migration par son chemin casse en silence quand on
// la renomme : `setup-push.yml` lisait encore `20260806_push_subscriptions.sql`.
const WORKFLOWS = '.github/workflows';
for (const w of readdirSync(new URL(WORKFLOWS, racine)).filter(f => /\.ya?ml$/.test(f))) {
  const texte = readFileSync(new URL(`${WORKFLOWS}/${w}`, racine), 'utf8');
  for (const [, cite] of texte.matchAll(/supabase\/migrations\/([\w.-]+\.sql)/g)) {
    if (!fichiers.includes(cite)) faute(`${w} cite ${DOSSIER}/${cite}, qui n'existe pas`);
  }
}

if (fautes) process.exit(1);
console.log(`${fichiers.length} migrations, une version complète chacune, workflows à jour`);
