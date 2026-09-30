import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * Le service worker apprend, à chaque build, ce qu'il doit garder.
 *
 * `public/sw.js` est copié tel quel dans `dist/` : sans ce greffon, son cache
 * portait un nom fixe (`provo-v3`), les fichiers de chaque version s'y
 * empilaient pour toujours, et comme le fichier ne changeait jamais, le
 * téléphone ne voyait même pas qu'une nouvelle version était en ligne.
 *
 * Après le build, trois lignes de `dist/sw.js` sont réécrites :
 *  · VERSION : l'empreinte de la liste des fichiers produits ; elle ne change
 *    que si l'app change, donc pas de mise à jour pour rien ;
 *  · PRECACHE : ces fichiers, pour que tout l'écran existe hors ligne, même
 *    ce qu'on n'a jamais ouvert en ligne ;
 *  · VERSION_OCR : la version de tesseract.js, qui nomme le cache du moteur.
 */
function versionnerServiceWorker() {
  let dist = 'dist'
  return {
    name: 'provo-service-worker',
    apply: 'build',
    configResolved(config) {
      dist = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const sw = resolve(dist, 'sw.js')
      if (!existsSync(sw)) return
      const fichiers = readdirSync(resolve(dist, 'assets'))
        .filter(f => /\.(js|css)$/.test(f))
        .map(f => `/assets/${f}`)
        .sort()
      const precache = ['/manifest.json', '/icon-192.png', ...fichiers]
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const ocr = JSON.parse(readFileSync(resolve('node_modules/tesseract.js/package.json'), 'utf8')).version

      let code = readFileSync(sw, 'utf8')
      const remplacer = (ligne, valeur) => {
        if (!code.includes(ligne)) throw new Error(`sw.js : ligne introuvable, le greffon ne peut pas la réécrire : ${ligne}`)
        code = code.replace(ligne, valeur)
      }
      remplacer("const VERSION = 'dev';", `const VERSION = '${version}';`)
      remplacer('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(precache)};`)
      remplacer("const VERSION_OCR = 'dev';", `const VERSION_OCR = '${ocr}';`)
      writeFileSync(sw, code)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionnerServiceWorker()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: app-code deploys don't re-download React/Supabase,
        // and the browser caches them across versions.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('leaflet')) return 'vendor-leaflet';
          }
        },
      },
    },
  },
})
