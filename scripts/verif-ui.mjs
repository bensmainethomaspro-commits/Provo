#!/usr/bin/env node
/**
 * Vérification d'interface mesurée — le garde-fou avant livraison.
 *
 * `/audit` juge : il propose des améliorations, avec du discernement.
 * Ce script, lui, ne juge rien. Il mesure quatre choses qu'on ne peut pas
 * évaluer à l'œil et sur lesquelles je me suis déjà trompé :
 *
 *   1. contraste du texte (WCAG AA)     — lisible dehors, en plein soleil ?
 *   2. cibles tactiles (44 px)          — atteignable avec un pouce ?
 *   3. débordement horizontal           — la page part-elle en travers ?
 *   4. action principale hors écran     — faut-il scroller pour valider ?
 *
 * Les deux thèmes sont parcourus, sur le plus petit écran cible.
 * Sortie : un tableau de chiffres et un code de sortie. 0 = rien à signaler.
 *
 * Usage : node scripts/verif-ui.mjs [--url http://localhost:4173] [--json]
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { trip, settings } from './ui-fixture.mjs';

// Playwright cherche une version précise du binaire ; l'environnement peut en
// avoir une autre. Plutôt que d'exiger une variable à chaque appel, on prend
// le premier Chromium réellement présent.
const trouverChromium = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(racine)) return undefined;
  for (const dossier of readdirSync(racine).filter(d => d.startsWith('chromium')).sort()) {
    for (const bin of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
                       'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = `${racine}/${dossier}/${bin}`;
      if (existsSync(p)) return p;
    }
  }
  return undefined; // Playwright se débrouillera — ou dira clairement pourquoi.
};

const args = process.argv.slice(2);
const URL_BASE = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:4173';
const JSON_OUT = args.includes('--json');
const LARGEUR = 390, HAUTEUR = 844;
const CIBLE_MIN = 44;          // Apple HIG et WCAG 2.2 AAA
const CONTRASTE_NORMAL = 4.5;  // WCAG AA, texte courant
const CONTRASTE_GRAND = 3.0;   // WCAG AA, ≥ 24 px ou ≥ 18,66 px gras

// ── Sondes exécutées dans la page ────────────────────────────────────────────
// Écrites en une seule chaîne : elles tournent dans le contexte du navigateur.
const SONDES = `(() => {
  const lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  // Le fond réel d'un texte n'est presque jamais sur son propre élément :
  // il faut remonter jusqu'au premier ancêtre opaque, en composant les alphas.
  //
  // Un dégradé ou une photo de fond n'a pas UNE couleur : selon l'endroit où
  // tombe le texte, le contraste change du tout au tout. Le calculer quand
  // même produirait des défauts imaginaires — c'est exactement la faute que
  // ce script existe pour empêcher. On mesure donc au chiffre près quand le
  // fond est uni, et on renvoie le reste à l'œil, sans le compter en défaut.
  const fondReel = (el) => {
    let couches = [], n = el;
    while (n && n !== document.documentElement.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return { incertain: true };
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { couches.push(c); if (c.a >= 0.999) break; }
      n = n.parentElement;
    }
    // La dernière couche opaque sert de base ; les précédentes sont des
    // voiles qu'on compose par-dessus, du plus profond au plus proche.
    const opaque = couches.length && couches[couches.length - 1].a >= 0.999;
    let out = opaque ? couches[couches.length - 1].rgb : [255, 255, 255];
    for (let i = (opaque ? couches.length - 2 : couches.length - 1); i >= 0; i--) {
      const c = couches[i];
      out = out.map((v, k) => Math.round(c.rgb[k] * c.a + v * (1 - c.a)));
    }
    return { fond: out };
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const nomme = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 44);

  // 1 · Contraste — uniquement les nœuds qui portent vraiment du texte.
  const contraste = [], incertains = [];
  const vus = new Set();
  document.querySelectorAll('body *').forEach(el => {
    if (!visible(el)) return;
    const propre = [...el.childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim()).join(' ');
    if (!propre) return;
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) return;
    const cle = propre.slice(0, 30) + '|' + el.className;
    if (vus.has(cle)) return;
    const fond = fondReel(el);
    if (fond.incertain) {
      vus.add(cle);
      incertains.push({ texte: propre.slice(0, 40), classe: String(el.className).slice(0, 38) });
      return;
    }
    const px = parseFloat(s.fontSize), gras = parseInt(s.fontWeight, 10) >= 700;
    const seuil = (px >= 24 || (px >= 18.66 && gras)) ? ${CONTRASTE_GRAND} : ${CONTRASTE_NORMAL};
    const bg = fond.fond;
    // Un texte semi-transparent se compose lui aussi sur son fond.
    const fgc = fg.a >= 0.999 ? fg.rgb : fg.rgb.map((v, k) => Math.round(v * fg.a + bg[k] * (1 - fg.a)));
    const r = ratio(fgc, bg);
    if (r < seuil) {
      vus.add(cle);
      contraste.push({ texte: propre.slice(0, 40), classe: String(el.className).slice(0, 38),
        ratio: Math.round(r * 100) / 100, seuil, px: Math.round(px) });
    }
  });

  // 2 · Cibles tactiles — un pouce ne vise pas mieux que 44 px.
  const cibles = [];
  const vusC = new Set();
  document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea')
    .forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) >= ${CIBLE_MIN} - 0.5) return;
      const cle = String(el.className) + '|' + nomme(el);
      if (vusC.has(cle)) return;
      vusC.add(cle);
      cibles.push({ libelle: nomme(el) || '(sans libellé)', classe: String(el.className).slice(0, 38),
        l: Math.round(r.width), h: Math.round(r.height) });
    });

  // 3 · Débordement horizontal — la page ne doit jamais partir de travers.
  const de = document.documentElement;
  const deborde = Math.max(0, Math.round(de.scrollWidth - de.clientWidth));
  const coupables = [];
  if (deborde > 0) {
    document.querySelectorAll('body *').forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        coupables.push({ classe: String(el.className).slice(0, 38),
          gauche: Math.round(r.left), droite: Math.round(r.right) });
      }
    });
  }

  // 4 · Action principale hors écran — « il faut scroller pour rien ».
  const horsEcran = [];
  document.querySelectorAll('.btn--primary, [type="submit"], .sheet__footer button')
    .forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.top >= window.innerHeight - 4) {
        horsEcran.push({ libelle: nomme(el), bas: Math.round(r.bottom), ecran: window.innerHeight });
      }
    });

  // 5 · Boutons muets — une icône seule sans nom n'est lisible par personne.
  const muets = [];
  document.querySelectorAll('button, [role="button"]').forEach(el => {
    if (!visible(el)) return;
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    const nom = el.getAttribute('aria-label') || el.getAttribute('title');
    // Un glyphe isolé (✕, ⋯, ▾) ne dit rien à un lecteur d'écran.
    if (!nom && (!t || /^[\\p{Emoji}\\p{P}\\p{S}\\s]{1,3}$/u.test(t))) {
      muets.push({ contenu: t.slice(0, 12) || '(vide)', classe: String(el.className).slice(0, 38) });
    }
  });

  return { contraste, incertains, cibles, deborde, coupables, horsEcran, muets };
})()`;

// ── Parcours ─────────────────────────────────────────────────────────────────
const ECRANS = [
  { nom: 'Accueil', aller: async () => {} },
  { nom: "Aujourd'hui", aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Aujourd'hui/i); } },
  { nom: 'Planning', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Planning/i); } },
  { nom: 'Réserve', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Réserve/i); } },
  { nom: 'Dépenses', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Dépenses/i); } },
  { nom: 'Carte', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Carte/i); await p.waitForTimeout(1200); } },
  {
    nom: 'Fiche activité',
    aller: async (p) => {
      await ouvrirVoyage(p); await onglet(p, /Planning/i);
      const c = p.locator('.activity-card').first();
      if (await c.count()) { await c.click(); await p.waitForTimeout(500); }
      const e = p.locator('button', { hasText: /Modifier|✏️/ }).first();
      if (await e.count()) { await e.click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(700); }
    },
  },
];

const ouvrirVoyage = async (p) => {
  const c = p.locator('.trip-card').first();
  if (await c.count()) { await c.click(); await p.waitForTimeout(800); }
};
const onglet = async (p, re) => {
  let t = p.locator('.tab-btn', { hasText: re });
  if (!(await t.count())) {
    const plus = p.locator('.tab-btn', { hasText: '⋯' });
    if (await plus.count()) { await plus.click(); await p.waitForTimeout(400); }
    t = p.locator('button', { hasText: re });
  }
  if (await t.count()) { await t.first().click(); await p.waitForTimeout(800); }
};

// Un serveur éteint doit se dire en une phrase, pas en pile d'appels : ce
// script est censé tourner à chaque livraison, il ne doit jamais faire peur.
try {
  await fetch(URL_BASE + '/', { signal: AbortSignal.timeout(4000) });
} catch {
  console.error(`\n✗ Rien ne répond sur ${URL_BASE}. Démarre l'aperçu d'abord :\n`
    + `    npm run build\n`
    + `    (setsid npx vite preview --port 4173 --strictPort &) ; sleep 3\n`);
  process.exit(2);
}

const navigateur = await chromium.launch({ executablePath: trouverChromium() });
const rapport = [];

for (const theme of ['light', 'dark']) {
  const ctx = await navigateur.newContext({
    viewport: { width: LARGEUR, height: HAUTEUR }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true, locale: 'fr-FR',
  });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('pageerror', e => erreurs.push(String(e).slice(0, 160)));
  // Le réseau extérieur n'est ni nécessaire ni fiable ici : on l'isole pour
  // que deux exécutions donnent le même résultat.
  await p.route('**/*', r => r.request().url().startsWith(URL_BASE) ? r.fallback() : r.abort());
  await p.addInitScript(([t, s, th]) => {
    localStorage.setItem('provo_trips', t);
    localStorage.setItem('provo_settings', s);
    localStorage.setItem('provo_theme', th);
  }, [JSON.stringify([trip]), JSON.stringify(settings), theme]);

  for (const ecran of ECRANS) {
    await p.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    try { await ecran.aller(p); } catch { /* écran absent : rien à mesurer */ }
    await p.waitForTimeout(400);
    const r = await p.evaluate(SONDES);
    rapport.push({ theme, ecran: ecran.nom, ...r, erreurs: [...erreurs] });
    erreurs.length = 0;
  }
  await ctx.close();
}
await navigateur.close();

// ── Restitution ──────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify(rapport, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('écran', 18) + pad('thème', 8) + pad('contraste', 11)
    + pad('cibles', 9) + pad('déborde', 9) + pad('hors écran', 12) + 'muets');
  console.log('─'.repeat(76));
  for (const l of rapport) {
    console.log(pad(l.ecran, 18) + pad(l.theme, 8) + pad(l.contraste.length || '·', 11)
      + pad(l.cibles.length || '·', 9) + pad(l.deborde ? l.deborde + ' px' : '·', 9)
      + pad(l.horsEcran.length || '·', 12) + (l.muets.length || '·'));
  }

  const detail = (titre, tirer, format) => {
    const lignes = rapport.flatMap(l => tirer(l).map(x => `  ${l.ecran} · ${l.theme} — ${format(x)}`));
    if (!lignes.length) return;
    console.log(`\n${titre}`);
    // Les dix premiers suffisent à décider quoi corriger ; le reste noierait.
    console.log([...new Set(lignes)].slice(0, 10).join('\n'));
    const total = new Set(lignes).size;
    if (total > 10) console.log(`  … et ${total - 10} autres`);
  };

  detail('Contraste sous le seuil WCAG AA', l => l.contraste,
    x => `${x.ratio}:1 (seuil ${x.seuil}) — « ${x.texte} » [${x.classe}] ${x.px}px`);
  detail(`Cibles tactiles sous ${CIBLE_MIN} px`, l => l.cibles,
    x => `${x.l}×${x.h} — « ${x.libelle} » [${x.classe}]`);
  detail('Éléments hors du cadre horizontal', l => l.coupables,
    x => `${x.gauche} → ${x.droite} [${x.classe}]`);
  detail("Action principale sous la ligne de flottaison", l => l.horsEcran,
    x => `« ${x.libelle} » à ${x.bas} px pour un écran de ${x.ecran}`);
  detail('Boutons sans nom accessible', l => l.muets,
    x => `« ${x.contenu} » [${x.classe}]`);
  detail('Erreurs JavaScript', l => l.erreurs, x => x);
  // Non compté comme défaut : une photo de fond n'a pas de couleur unique.
  // La machine ne peut pas trancher — l'œil, si.
  detail('Fond non uni (dégradé ou photo) — à vérifier à l’œil, non compté', l => l.incertains,
    x => `« ${x.texte} » [${x.classe}]`);
}

const total = rapport.reduce((n, l) =>
  n + l.contraste.length + l.cibles.length + (l.deborde ? 1 : 0)
    + l.horsEcran.length + l.muets.length + l.erreurs.length, 0);
if (!JSON_OUT) console.log(`\n${total === 0 ? '✅ Rien à signaler.' : `⚠️  ${total} points mesurés à trancher.`}\n`);
process.exit(total === 0 ? 0 : 1);
