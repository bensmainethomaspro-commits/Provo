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
 *   5. action principale recouverte     — passe-t-elle sous un calque flottant ?
 *   6. calque plein écran prisonnier    — un ancêtre le réduit-il à sa boîte ?
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
  // Deux pièges qui faisaient compter des défauts imaginaires :
  //
  // 1. Un élément peut être opaque alors que son PARENT est à opacity 0 —
  //    c'est le cas du bandeau d'annulation au repos. Ses boutons étaient
  //    mesurés alors que personne ne les voit.
  // 2. Un élément peut avoir défilé hors du cadre. Une cible à top: -332
  //    n'est pas une cible trop petite, c'est une cible absente. Et le cadre
  //    en question n'est pas toujours l'écran — voir le point 3 plus bas.
  const visible = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (!(r.bottom > 0 && r.top < window.innerHeight
       && r.right > 0 && r.left < window.innerWidth)) return false;
    // 3. Un conteneur qui défile découpe ce qui en sort — et
    //    \`getBoundingClientRect\` l'ignore complètement. Un bouton remonté
    //    au-dessus du cadre de défilement garde donc des coordonnées à
    //    l'écran alors que plus un pixel n'en est peint : c'est l'en-tête
    //    qu'on voit à sa place. Mesuré ainsi, « ✓ Remboursé » sortait comme
    //    cible inatteignable de 105 × 28 alors qu'il n'était pas là.
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (!/auto|scroll|hidden/.test(s.overflowY + ' ' + s.overflowX)) continue;
      const q = n.getBoundingClientRect();
      if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1
       || r.right <= q.left + 1 || r.left >= q.right - 1) return false;
    }
    return true;
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
    // Un émoji couleur peint ses propres pixels et ignore \`color\` : mesurer la
    // couleur de texte héritée contre le fond ne dit rien de ce qu'on voit. Ces
    // éléments sortaient à 1,11:1 alors qu'ils s'affichent parfaitement. Un
    // outil qui invente des défauts finit par ne plus être lu.
    //
    // On ne retire QUE les émojis couleur. Les glyphes monochromes — ⠿, ▼, ＋ —
    // suivent \`color\` et restent mesurés : c'est ainsi qu'une poignée à 1,08:1
    // a été trouvée.
    const sansEmoji = propre.replace(
      /[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\uFE0F\\uFE0E\\u200D\\u{1F3FB}-\\u{1F3FF}]/gu, '').trim();
    if (!sansEmoji) {
      vus.add(cle);
      incertains.push({ texte: propre.slice(0, 40) + ' (émoji seul)', classe: String(el.className).slice(0, 38) });
      return;
    }
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

  // Un calque flottant — barre d'onglets, en-tête collant — peut passer
  // par-dessus n'importe quoi. Deux situations très différentes :
  //
  //   · calque en HAUT : le contenu défile dessous. C'est le fonctionnement
  //     normal d'un en-tête, rien à signaler.
  //   · calque en BAS  : l'élément est posé dans la bande où la barre flotte.
  //     Il se voit à moitié, il ne se touche pas, et rien ne dit pourquoi.
  //
  // Un voile de modale prend tout l'écran : il recouvre volontairement ce
  // qu'il y a dessous, on l'écarte aussi.
  const calqueSous = (el) => {
    const r = el.getBoundingClientRect();
    const points = [
      [r.left + r.width / 2, r.top + 3],
      [r.left + r.width / 2, r.bottom - 3],
      [r.left + 3, r.top + r.height / 2],
      [r.right - 3, r.top + r.height / 2],
    ];
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const sur = document.elementFromPoint(x, y);
      if (!sur || sur === el || el.contains(sur) || sur.contains(el)) continue;
      let calque = null;
      for (let n = sur; n && n !== document.body; n = n.parentElement) {
        const p = getComputedStyle(n).position;
        if (p === 'fixed' || p === 'sticky') { calque = n; break; }
      }
      if (!calque) continue;
      const q = calque.getBoundingClientRect();
      if (q.height > window.innerHeight * 0.6) continue;
      // « Ancré en bas » se juge sur le haut du calque, pas sur son bas : la
      // barre d'onglets de Provo est une pastille flottante qui garde 10 px
      // sous elle. Un \`bottom >= innerHeight\` ne l'aurait jamais reconnue —
      // et la sonde serait restée muette sur le défaut qui l'a fait naître.
      return {
        nom: String(calque.className || calque.tagName).slice(0, 38),
        enBas: q.top > window.innerHeight / 2,
      };
    }
    return null;
  };

  // 2 · Cibles tactiles — un pouce ne vise pas mieux que 44 px.
  //
  // Sauf pour un lien posé dans une ligne de texte : sa hauteur est celle de la
  // ligne, et l'agrandir à 44 px gonflerait chaque carte sans rien rendre plus
  // atteignable. WCAG 2.5.8 les exempte explicitement et fixe le plancher à
  // 24 px — c'est cette barre-là qu'on leur applique.
  //
  // Le dessin d'un bouton et sa zone sensible sont deux choses différentes :
  // un pseudo-élément peut étendre la seconde sans toucher au premier, ce qui
  // est justement la bonne façon de rendre une petite icône atteignable sans
  // alourdir l'écran. Mesurer la boîte seule ferait donc signaler comme
  // défaut ce qui est déjà corrigé. On interroge le point réellement touché.
  const atteignable = (el, r) => {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = ${CIBLE_MIN} / 2 - 1;
    return [[cx - d, cy], [cx + d, cy], [cx, cy - d], [cx, cy + d]].every(([x, y]) => {
      // Un bord d'écran n'est pas un défaut de dessin : le pouce y arrive.
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true;
      // Seul un tap qui atterrit sur le bouton — ou sur son contenu — le
      // déclenche. Un ancêtre qui reçoit le point ne compte pas : le doigt
      // touche la carte, pas le bouton.
      const touche = document.elementFromPoint(x, y);
      return !!touche && (touche === el || el.contains(touche));
    });
  };
  const cibles = [];
  const vusC = new Set();
  document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea')
    .forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      const calque = calqueSous(el);
      // Un lien dans une ligne de texte : sa hauteur est celle de la ligne.
      // WCAG 2.5.8 l'exempte et fixe le plancher à 24 px.
      const dansDuTexte = el.tagName === 'A'
        && !!el.textContent.trim()
        && getComputedStyle(el).position === 'static';
      const seuil = dansDuTexte ? 24 : ${CIBLE_MIN};
      if (Math.min(r.width, r.height) >= seuil - 0.5) return;
      if (atteignable(el, r)) return;
      // Recouvert, ce n'est pas trop petit : l'agrandir n'y changerait rien.
      // Un bouton passé sous l'en-tête au défilement n'est pas un défaut de
      // dessin — il est simplement plus haut que le cadre.
      if (calque) return;
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
  //
  // Même question, deuxième forme : l'action est dans le cadre, mais RECOUVERTE
  // par la barre flottante du bas. Ce script disait « rien à signaler » sur un
  // écran où « ✅ Ajouter » passait dessous sur ses 29 derniers pixels — il ne
  // regardait que \`top >= innerHeight\`. C'est pourtant le pire des deux cas :
  // hors écran, on comprend qu'il faut défiler ; à moitié caché, on croit
  // pouvoir toucher.
  //
  // Restreint aux actions principales, comme la sonde qu'elle prolonge. Passée
  // sur tous les éléments cliquables, elle signalait chaque carte qui longe la
  // barre au fil du défilement — du bruit, et le bruit finit par ne plus être lu.
  const horsEcran = [], recouverts = [];
  document.querySelectorAll('.btn--primary, [type="submit"], .sheet__footer button')
    .forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.top >= window.innerHeight - 4) {
        horsEcran.push({ libelle: nomme(el), bas: Math.round(r.bottom), ecran: window.innerHeight });
        return;
      }
      const calque = calqueSous(el);
      if (calque?.enBas) {
        recouverts.push({ libelle: nomme(el), par: calque.nom, bas: Math.round(r.bottom) });
      }
    });

  // 6 · Calque plein écran prisonnier d'un ancêtre.
  //
  // Un \`position: fixed\` se place par rapport à l'écran — sauf si un ancêtre
  // établit un bloc conteneur. Le piège est qu'aucune de ces propriétés ne
  // ressemble à du positionnement : \`transform\`, \`filter\`, \`backdrop-filter\`,
  // \`contain\`, et surtout \`content-visibility: auto\`, qu'on pose pour la
  // fluidité d'une longue liste.
  //
  // Mesuré : le menu ⋯ d'une activité faisait 356 × 174 px au lieu de
  // 390 × 844, parce que la carte de la Réserve porte \`content-visibility\`.
  // Son \`overflow: hidden\` découpait le reste, si bien que « Modifier »
  // n'était dessiné nulle part — et personne ne pouvait plus modifier une
  // activité. Troisième fois que ce piège frappe dans ce projet.
  const captifs = [];
  document.querySelectorAll('*').forEach(el => {
    if (getComputedStyle(el).position !== 'fixed') return;
    if (!visible(el)) return;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      const raison =
        s.transform !== 'none' ? \`transform\`
        : s.filter !== 'none' ? 'filter'
        : (s.backdropFilter && s.backdropFilter !== 'none') ? 'backdrop-filter'
        : s.perspective !== 'none' ? 'perspective'
        : /paint|layout|strict|content/.test(s.contain) ? \`contain: \${s.contain}\`
        : s.contentVisibility === 'auto' ? 'content-visibility: auto'
        : /transform|filter|perspective/.test(s.willChange) ? \`will-change: \${s.willChange}\`
        : null;
      if (!raison) continue;
      const r = el.getBoundingClientRect();
      captifs.push({
        calque: String(el.className || el.tagName).slice(0, 30),
        geolier: String(n.className || n.tagName).split(' ')[0].slice(0, 26),
        raison,
        taille: \`\${Math.round(r.width)}×\${Math.round(r.height)}\`,
        ecran: \`\${window.innerWidth}×\${window.innerHeight}\`,
      });
      break;
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

  return { contraste, incertains, cibles, deborde, coupables, horsEcran, recouverts, muets, captifs };
})()`;

// ── Parcours ─────────────────────────────────────────────────────────────────
// L'onglet « Aujourd'hui » a été retiré du produit : le laisser ici ferait
// mesurer le Planning deux fois, sous un nom qui n'existe plus.
const ECRANS = [
  { nom: 'Accueil', aller: async () => {} },
  { nom: 'Planning', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Planning/i); } },
  { nom: 'Réserve', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Réserve/i); } },
  { nom: 'Dépenses', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Dépenses/i); } },
  // Le formulaire d'ajout d'une dépense n'était jamais ouvert ici : c'est
  // pour ça que ses deux boutons ont pu passer sous la barre d'onglets sans
  // que rien ne le dise. Une sonde ne trouve que sur les écrans qu'on lui
  // montre — ajouter la sonde sans ajouter l'écran n'aurait rien changé.
  {
    nom: 'Dépense (ajout)',
    aller: async (p) => {
      await ouvrirVoyage(p); await onglet(p, /Dépenses/i);
      await p.locator('.expenses-add-top').click().catch(() => {});
      await p.waitForTimeout(800);
    },
  },
  { nom: 'Carte', aller: async (p) => { await ouvrirVoyage(p); await onglet(p, /Carte/i); await p.waitForTimeout(1200); } },
  // Deux écrans arrivés en août 2026 et jamais mesurés : le pli du formulaire
  // d'ajout, et les billets du voyage. Le débordement de la zone de notes
  // sous la barre d'onglets s'était vu à l'œil — c'est exactement ce que cet
  // outil est censé trouver avant moi.
  {
    nom: 'Ajout',
    aller: async (p) => {
      await ouvrirVoyage(p);
      await p.locator('.header__add-btn').click().catch(() => {});
      await p.waitForTimeout(600);
    },
  },
  {
    nom: 'Notes',
    aller: async (p) => {
      await ouvrirVoyage(p);
      await p.locator('button[aria-label="Options du voyage"]').click().catch(() => {});
      await p.waitForTimeout(300);
      await p.locator('.trip-header-menu__item', { hasText: /Notes/ }).click().catch(() => {});
      await p.waitForTimeout(600);
    },
  },
  // Le jour ouvert : l'écran où l'on coche « fait », où l'on règle l'heure de
  // départ, où l'on renvoie la journée en Réserve. Il n'était mesuré nulle
  // part — sept cibles y vivaient sous 44 px, dont la pastille « fait » à
  // 27 × 27, la plus tapée du voyage.
  {
    nom: 'Jour ouvert',
    repere: '.day-detail-overlay',
    aller: async (p) => {
      await ouvrirVoyage(p); await onglet(p, /Planning/i);
      await p.locator('.tl-day__open, .tl-day__header').first().click().catch(() => {});
      await p.waitForTimeout(800);
    },
  },
  // Le menu ⋯ d'une idée : c'est là que vit « Modifier », et c'est là que le
  // calque s'est retrouvé enfermé dans la carte. Une sonde ne trouve que sur
  // les écrans qu'on lui montre — l'ajouter sans cet écran n'aurait rien
  // mesuré (règle E6).
  {
    nom: 'Menu d’activité',
    repere: '.act-sheet',
    aller: async (p) => {
      await ouvrirVoyage(p); await onglet(p, /Réserve/i);
      await p.locator('[aria-label*="Options de l\'activité"]').first()
        .click({ timeout: 4000 }).catch(() => {});
      await p.waitForTimeout(700);
    },
  },
  {
    nom: 'Fiche activité',
    repere: '.activity-card--expanded',
    aller: async (p) => {
      await ouvrirVoyage(p); await onglet(p, /Planning/i);
      // Le Planning ne contient pas de `.activity-card` : sa frise est faite de
      // `.tl-activity`. Ce parcours cliquait donc dans le vide et remesurait le
      // Planning sous un faux nom — neuf écrans annoncés, sept distincts.
      await p.locator('.tl-day__open, .tl-day__header').first().click().catch(() => {});
      await p.waitForTimeout(700);
      const c = p.locator('.day-detail-overlay .activity-card').first();
      if (await c.count()) { await c.click(); await p.waitForTimeout(600); }
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
    // Quand l'app tombe, la barrière d'erreur affiche un écran sobre — deux
    // textes et un bouton — que cet outil mesure sans broncher : tout passe au
    // vert alors que plus rien ne marche. C'est arrivé, et j'ai failli livrer
    // le résultat. Un plantage doit sortir plus fort qu'un défaut de contraste.
    const plante = await p.locator('.error-screen').count().catch(() => 0);
    // Un écran doit prouver qu'il est arrivé. Sans ce repère, un sélecteur
    // périmé fait remesurer l'écran précédent sous un autre nom : tout passe
    // au vert et la couverture annoncée est fausse. C'est exactement ce qui
    // est arrivé au parcours « Fiche activité », qui cliquait dans le vide.
    const perdu = ecran.repere
      ? (await p.locator(ecran.repere).count().catch(() => 0)) === 0
      : false;
    const r = await p.evaluate(SONDES);
    rapport.push({ theme, ecran: ecran.nom, ...r, plante: plante > 0, perdu,
      repere: ecran.repere, erreurs: [...erreurs] });
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
    + pad('cibles', 9) + pad('déborde', 9) + pad('hors écran', 12)
    + pad('recouvert', 11) + pad('muets', 8) + 'captifs');
  console.log('─'.repeat(95));
  for (const l of rapport) {
    console.log(pad(l.ecran, 18) + pad(l.theme, 8) + pad(l.contraste.length || '·', 11)
      + pad(l.cibles.length || '·', 9) + pad(l.deborde ? l.deborde + ' px' : '·', 9)
      + pad(l.horsEcran.length || '·', 12) + pad(l.recouverts.length || '·', 11)
      + pad(l.muets.length || '·', 8) + (l.captifs.length || '·'));
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
  detail('Action principale recouverte par un calque flottant', l => l.recouverts,
    x => `« ${x.libelle} » (bas à ${x.bas} px) passe sous [${x.par}]`);
  detail('Boutons sans nom accessible', l => l.muets,
    x => `« ${x.contenu} » [${x.classe}]`);
  detail("Calque plein écran prisonnier d'un ancêtre", l => l.captifs,
    x => `[${x.calque}] fait ${x.taille} au lieu de ${x.ecran} — enfermé par `
       + `[${x.geolier}] (${x.raison})`);
  detail('Erreurs JavaScript', l => l.erreurs, x => x);
  // Non compté comme défaut : une photo de fond n'a pas de couleur unique.
  // La machine ne peut pas trancher — l'œil, si.
  detail('Fond non uni (dégradé ou photo) — à vérifier à l’œil, non compté', l => l.incertains,
    x => `« ${x.texte} » [${x.classe}]`);
}

const plantes = rapport.filter(l => l.plante);
const perdus = rapport.filter(l => l.perdu);
const total = rapport.reduce((n, l) =>
  n + l.contraste.length + l.cibles.length + (l.deborde ? 1 : 0)
    + l.horsEcran.length + l.recouverts.length + l.muets.length + l.captifs.length
    + l.erreurs.length, 0);
if (!JSON_OUT) {
  // En tête, avant les chiffres : sur un écran planté, tous les autres comptes
  // sont faux — il n'y a plus d'interface à mesurer.
  if (plantes.length) {
    console.log(`\n🛑 L'APPLICATION TOMBE sur ${plantes.length} écran(s) : `
      + [...new Set(plantes.map(l => `${l.ecran}/${l.theme}`))].join(', '));
    console.log('   Les mesures ci-dessus portent sur l’écran d’erreur, pas sur l’app.');
  }
  if (perdus.length) {
    console.log(`\n🧭 ${perdus.length} parcours n'atteignent pas leur écran :`);
    [...new Set(perdus.map(l => `   ${l.ecran} — repère « ${l.repere} » absent`))]
      .forEach(l => console.log(l));
    console.log('   Ces lignes mesurent autre chose. Leur « rien à signaler » ne vaut rien.');
  }
  console.log(`\n${total === 0 && !plantes.length && !perdus.length
    ? '✅ Rien à signaler.' : `⚠️  ${total} points mesurés à trancher.`}\n`);
}
process.exit(total === 0 && !plantes.length && !perdus.length ? 0 : 1);
