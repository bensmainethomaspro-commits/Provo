#!/usr/bin/env node
/**
 * Parcours fonctionnel — est-ce que l'app FAIT ce qu'elle promet ?
 *
 * Les deux autres outils regardent ailleurs :
 *   /verif-ui  mesure la présentation  (contraste, cibles, débordement)
 *   /audit     juge la conception      (playbook UX/UI)
 * Aucun des deux n'appuie sur les boutons. Celui-ci, si.
 *
 * Il rejoue les intentions réelles d'un utilisateur — « j'ajoute une dépense et
 * je vois qui doit quoi », « je réordonne mes activités » — et vérifie le
 * résultat observable : ce qui est à l'écran, et ce qui est enregistré.
 *
 * Deux niveaux de constat, jamais mélangés :
 *   ✗ CASSÉ    la fonction ne marche pas, ou perd des données
 *   ⚠ FRICTION elle marche, mais elle coûte à l'utilisateur
 *
 * Un parcours qui n'a pas pu s'exécuter est dit « non joué » — jamais compté
 * comme réussi, jamais compté comme cassé.
 *
 * Usage : node scripts/parcours.mjs [--url http://localhost:4173]
 *                                   [--seul <motif>] [--json] [--garder-captures]
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { trip as TRIP, settings as SETTINGS } from './ui-fixture.mjs';

const trouverChromium = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(racine)) return undefined;
  for (const d of readdirSync(racine).filter(x => x.startsWith('chromium')).sort())
    for (const b of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
                     'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = `${racine}/${d}/${b}`;
      if (existsSync(p)) return p;
    }
  return undefined;
};

const args = process.argv.slice(2);
const lire = (nom, defaut) => args.includes(nom) ? args[args.indexOf(nom) + 1] : defaut;
const URL_BASE = lire('--url', 'http://localhost:4173');
const SEUL = lire('--seul', null);
const JSON_OUT = args.includes('--json');
const CAPTURES = '/tmp/provo-parcours';

// ── Boîte à outils offerte à chaque parcours ────────────────────────────────
function outils(p, journal) {
  const t = {
    p,
    /** Un constat vérifié. `ok` tranche, `detail` documente. */
    verifier(quoi, ok, detail) {
      journal.push({ type: ok ? 'ok' : 'casse', quoi, detail });
      return ok;
    },
    /** Ça marche, mais ça coûte. Jamais un échec — une observation. */
    friction(quoi, detail) {
      journal.push({ type: 'friction', quoi, detail });
    },
    /** Ce que le parcours n'a pas pu atteindre. Ni réussite ni échec. */
    injouable(quoi) {
      journal.push({ type: 'injoue', quoi });
      throw new Interrompu(quoi);
    },

    /** Clique le premier élément correspondant, ou déclare le parcours injouable. */
    async clic(sel, { texte, delai = 450, obligatoire = true } = {}) {
      let loc = p.locator(sel);
      if (texte) loc = p.locator(sel, { hasText: texte });
      if (!(await loc.count())) {
        if (obligatoire) t.injouable(`introuvable : ${texte ? `${sel} « ${texte} »` : sel}`);
        return false;
      }
      await loc.first().click({ timeout: 5000 }).catch(async () => {
        // Un recouvrement (bandeau, bulle) ne doit pas faire passer un parcours
        // pour cassé : on le dit tel quel.
        await loc.first().click({ timeout: 3000, force: true });
      });
      await p.waitForTimeout(delai);
      return true;
    },

    async saisir(sel, valeur, { index = 0 } = {}) {
      const loc = p.locator(sel).nth(index);
      if (!(await loc.count())) t.injouable(`champ introuvable : ${sel}`);
      await loc.fill(String(valeur));
      await p.waitForTimeout(150);
    },

    /** Le texte visible de la page, pour les constats « on voit … ». */
    texte: () => p.evaluate(() => document.body.innerText),
    combien: (sel) => p.locator(sel).count(),
    visible: async (sel) => (await p.locator(sel).count()) > 0
      && await p.locator(sel).first().isVisible().catch(() => false),

    /** Le voyage tel qu'il est réellement enregistré. La source de vérité. */
    voyage: () => p.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('provo_trips') || '[]')[0] || null; }
      catch { return null; }
    }),

    async ouvrirVoyage() {
      await t.clic('.trip-card', { delai: 800 });
    },
    /**
     * @param {RegExp} re
     * @param {{facultatif?: boolean}} opts — `facultatif` pour les onglets qui
     *   n'existent pas toujours : « Aujourd'hui » ne s'affiche que pendant le
     *   voyage, et c'est voulu. Rend `false` au lieu d'interrompre.
     */
    async onglet(re, { facultatif = false } = {}) {
      let l = p.locator('.tab-btn', { hasText: re });
      if (!(await l.count())) {
        const plus = p.locator('.tab-btn', { hasText: '⋯' });
        if (await plus.count()) { await plus.first().click(); await p.waitForTimeout(400); }
        l = p.locator('button', { hasText: re });
      }
      if (!(await l.count())) {
        if (facultatif) return false;
        t.injouable(`onglet introuvable : ${re}`);
      }
      await l.first().click();
      await p.waitForTimeout(700);
      return true;
    },
    async menu(texte) {
      await t.clic('button[aria-label="Options du voyage"]', { delai: 350 });
      await t.clic('.trip-header-menu__item', { texte, delai: 700 });
    },
    /**
     * Le planning affiche une frise ; les fiches d'activité vivent dans le
     * détail du jour. C'est le chemin que prend l'utilisateur pour corriger
     * quelque chose, donc celui que le parcours doit prendre.
     */
    async ouvrirLeJour() {
      if (await t.visible('.activity-card')) return;
      if (!(await t.clic('.tl-day__header, .tl-day__open, .day-section__header',
        { delai: 900, obligatoire: false })))
        t.injouable('impossible d\'ouvrir le détail d\'un jour depuis le planning');
      if (!(await t.visible('.activity-card')))
        t.injouable('le détail du jour ne montre aucune fiche d\'activité');
    },
    /** Modifier, supprimer, déplacer : tout passe par le ⋯ de la fiche. */
    async menuFiche(texte, { obligatoire = true } = {}) {
      if (!(await t.clic('.activity-card__dots-btn', { delai: 600, obligatoire })))
        return false;
      return t.clic('.act-sheet__item', { texte, delai: 800, obligatoire });
    },
    async fermerFiche() {
      await p.evaluate(() => {
        document.querySelector('.sheet__close')?.click();
        document.querySelector('.modal__close')?.click();
      });
      await p.waitForTimeout(450);
    },

    /**
     * Glisser-déposer au doigt, de la n-ième fiche vers la m-ième.
     *
     * On vise par `data-reorder-id` : c'est ce que l'app lit sous le doigt.
     * Un sélecteur positionnel (`nth-of-type`) tombe à côté et fait croire que
     * le geste ne marche pas, alors qu'il n'a simplement jamais été fait.
     *
     * @returns {Promise<{de: string, vers: string}>} les fiches réellement visées
     */
    async glisser(deIdx = 0, versIdx = 2) {
      const cibles = await p.evaluate(() => [...document.querySelectorAll('[data-reorder-id]')]
        .map(e => { const r = e.getBoundingClientRect();
          return { id: e.dataset.reorderId, y: r.y + r.height / 2, visible: r.height > 0 }; })
        .filter(c => c.visible));
      if (cibles.length <= versIdx) t.injouable(`moins de ${versIdx + 1} fiches déplaçables à l'écran`);
      const g = await p.locator('.tl-act-grip, .reserve-card__grip, .activity-card__drag-handle')
        .nth(deIdx).boundingBox();
      if (!g) t.injouable('poignée de déplacement introuvable');
      const x = g.x + g.width / 2, y0 = g.y + g.height / 2, y1 = cibles[versIdx].y;
      await p.mouse.move(x, y0);
      await p.mouse.down();
      await p.waitForTimeout(120);
      // Par paliers : l'app relit la cible sous le doigt à chaque déplacement.
      for (let i = 1; i <= 10; i++) { await p.mouse.move(x, y0 + (y1 - y0) * i / 10); await p.waitForTimeout(55); }
      const vise = await p.evaluate(() =>
        document.querySelector('.tl-act-wrap--cible, .reserve-card--cible')?.dataset?.reorderId
        || document.querySelector('[class*="--cible"]')?.dataset?.reorderId || null);
      await p.mouse.up();
      await p.waitForTimeout(800);
      return { de: cibles[deIdx].id, vers: vise || cibles[versIdx].id, marque: !!vise };
    },
  };
  return t;
}

class Interrompu extends Error {}

// ── Invariants : ce qui doit rester vrai quoi qu'on fasse ───────────────────
// Un parcours peut « réussir » à l'écran tout en abîmant les données. C'est
// arrivé : un réordonnancement avait remplacé toutes les activités du jour par
// des `null`, et rien à l'écran ne le disait.
function integrite(v) {
  const maux = [];
  if (!v) return ['le voyage a disparu du stockage'];
  (v.days || []).forEach((d, i) => {
    const acts = d.activities;
    if (!Array.isArray(acts)) { maux.push(`jour ${i + 1} : la liste d'activités n'est plus un tableau`); return; }
    acts.forEach((a, j) => {
      if (!a || typeof a !== 'object') maux.push(`jour ${i + 1}, position ${j + 1} : activité vide (${JSON.stringify(a)})`);
      else if (!a.id) maux.push(`jour ${i + 1}, position ${j + 1} : activité sans identifiant`);
    });
    const ids = acts.filter(Boolean).map(a => a.id);
    if (new Set(ids).size !== ids.length) maux.push(`jour ${i + 1} : deux activités portent le même identifiant`);
  });
  (v.reserve || []).forEach((a, j) => {
    if (!a || !a.id) maux.push(`réserve, position ${j + 1} : entrée vide ou sans identifiant`);
  });
  (v.expenses || []).forEach((e, j) => {
    if (!e || !e.id) { maux.push(`dépense ${j + 1} : entrée vide`); return; }
    if (!Array.isArray(e.participantIds)) maux.push(`dépense « ${e.description} » : participants absents (plante l'onglet Dépenses)`);
    if (!Number.isFinite(Number(e.amount))) maux.push(`dépense « ${e.description} » : montant non numérique (${e.amount})`);
  });
  // Une activité présente à la fois au programme et dans la réserve serait
  // comptée deux fois partout — budget, carte, compteurs.
  const auJour = new Set((v.days || []).flatMap(d => (d.activities || []).filter(Boolean).map(a => a.id)));
  (v.reserve || []).filter(Boolean).forEach(a => {
    if (auJour.has(a.id)) maux.push(`« ${a.title} » est à la fois au programme et dans la Réserve`);
  });
  return maux;
}

export { integrite };

// ── Jeux de données particuliers ────────────────────────────────────────────
// Le voyage de référence sert 90 % des parcours. Les 10 % restants sont
// justement les plus révélateurs : une app se juge à ses états rares — rien à
// afficher, voyage pas encore parti, une seule personne à payer.
const jour = (k) => {
  const d = new Date(); d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const joursVides = (n, decalage = 0) => Array.from({ length: n }, (_, i) => ({
  id: `d${i + 1}`, date: jour(decalage + i), startTime: '09:00', notes: '', activities: [],
}));

const VIDE = { ...TRIP, days: joursVides(4), reserve: [], expenses: [], packingList: [], tripNotes: '' };

const SOLO = { ...TRIP, travelers: 1, tripTravelers: [{ id: 't1', name: 'Thomas', emoji: '🧔' }],
  expenses: [{ id: 'e1', description: 'Billets', amount: 60, eurAmount: 60, currency: 'EUR',
    expenseCategory: 'transport', payerId: 't1', date: jour(0), participantIds: ['t1'] }] };

const PAS_PARTI = { ...TRIP, startDate: jour(30), endDate: jour(35),
  days: joursVides(6, 30).map((d, i) => ({ ...d, activities: TRIP.days[i]?.activities || [] })) };

const TERMINE = { ...TRIP, startDate: jour(-20), endDate: jour(-15),
  days: joursVides(6, -20).map((d, i) => ({ ...d, activities: TRIP.days[i]?.activities || [] })) };

// Deux activités calées à la même heure : le conflit doit se voir.
const CONFLIT = { ...TRIP, days: [{
  id: 'd1', date: jour(0), startTime: '09:00', notes: '', activities: [
    { id: 'c1', title: 'Visite guidée du centre', category: 'visite', status: 'todo',
      durationHours: 2, durationMinutes: 0, fixedStart: '14:00', travelerIds: [] },
    { id: 'c2', title: 'Concert au Musikverein', category: 'fun', status: 'todo',
      durationHours: 2, durationMinutes: 0, fixedStart: '14:30', travelerIds: [] },
  ] }, ...TRIP.days.slice(1)] };

// Onze heures de programme dans une seule journée.
const SURCHARGE = { ...TRIP, days: [{
  id: 'd1', date: jour(0), startTime: '08:00', notes: '',
  activities: Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`, title: `Visite ${i + 1}`, category: 'visite', status: 'todo',
    durationHours: 2, durationMinutes: 0, travelerIds: [],
  })) }, ...TRIP.days.slice(1)] };

const TITRE_LONG = { ...TRIP, reserve: [{
  id: 'long', title: 'Restaurant Zum Schwarzen Kameel — Bognergasse 5, 1010 Wien, Autriche (réserver au moins trois semaines à l\'avance)',
  category: 'resto', status: 'todo', durationHours: 1, durationMinutes: 30, travelerIds: [] },
  ...TRIP.reserve] };

// Une idée qui coche les trois signaux que le produit promet de donner :
// fermée aujourd'hui, loin du reste, dans une journée déjà chargée.
const A_SIGNALER = { ...TRIP,
  days: [{ id: 'd1', date: jour(0), startTime: '09:00', notes: '',
    activities: Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, title: `Visite ${i + 1}`, category: 'visite', status: 'todo',
      durationHours: 2, durationMinutes: 30, lat: 48.2082, lon: 16.3738, travelerIds: [],
    })) }, ...TRIP.days.slice(1)],
  reserve: [{ id: 'ferme', title: 'Palais du Belvédère',
    category: 'visite', status: 'todo', durationHours: 2, durationMinutes: 0,
    // Fermé tous les jours de la semaine, et à 40 km du reste du programme.
    openingHours: 'Mo-Su off', lat: 48.5500, lon: 16.3700, travelerIds: [] }] };

// ── Les parcours ────────────────────────────────────────────────────────────
// Chacun est une intention d'utilisateur, pas un test unitaire. `depart` dit
// dans quel état l'app démarre : 'vierge' (aucun voyage), 'voyage' (le voyage
// de référence), ou un voyage particulier fourni directement.
const PARCOURS = [

  { groupe: 'Accueil', nom: 'Créer un voyage', depart: 'vierge',
    intention: "Première ouverture : créer un voyage et arriver dedans.",
    async faire(t) {
      await t.clic('button', { texte: /Nouveau voyage|Créer mon premier/i, delai: 700 });
      await t.saisir('.modal input.form-input', 'Lisbonne', { index: 0 });
      await t.saisir('.modal input.form-input', 'Lisbonne, Portugal', { index: 1 });
      await t.clic('.modal button', { texte: /Créer/, delai: 1400 });
      const v = await t.voyage();
      t.verifier('le voyage est enregistré', !!v && v.name === 'Lisbonne', v?.name);
      t.verifier('il apparaît sur l\'accueil',
        (await t.texte()).includes('Lisbonne') || (await t.combien('.trip-card')) > 0);
      t.verifier('des jours ont été créés', (v?.days?.length || 0) > 0, `${v?.days?.length} jours`);
    } },

  { groupe: 'Accueil', nom: 'Ouvrir un voyage existant', depart: 'voyage',
    intention: "Retrouver son voyage et entrer dedans.",
    async faire(t) {
      await t.ouvrirVoyage();
      t.verifier('la vue voyage s\'ouvre', await t.visible('.trip-view'));
      t.verifier('la barre d\'onglets est là', (await t.combien('.tab-btn')) >= 5,
        `${await t.combien('.tab-btn')} onglets`);
      const txt = await t.texte();
      t.verifier('le nom du voyage est affiché', txt.includes('Vienne'));
    } },

  { groupe: "Aujourd'hui", nom: "L'écran du jour répond à « je fais quoi ? »", depart: 'voyage',
    intention: "Sur place : savoir quoi faire maintenant sans réfléchir.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Aujourd'hui/i);
      const txt = await t.texte();
      t.verifier('une activité est proposée',
        (await t.combien('.today-act-card, .today-act, .live-day-card')) > 0);
      t.verifier('le jour est situé dans le voyage', /Jour\s*\d+/i.test(txt),
        (txt.match(/Jour\s*\d+\s*\/?\s*\d*/i) || [])[0]);
    } },

  { groupe: 'Planning', nom: 'Ajouter une activité à un jour', depart: 'voyage',
    intention: "Poser une visite dans le programme d'un jour précis.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const v0 = await t.voyage();
      const avant = v0.days.reduce((s, d) => s + d.activities.length, 0);
      await t.clic('.header__add-btn', { delai: 900 });
      // Le premier champ de la feuille est « adresse ou lien à importer » :
      // viser le titre par son intitulé, pas par sa position.
      await t.saisir('input[placeholder*="Déjeuner au marché"]', 'Musée du Belvédère');
      // La destination par défaut est la Réserve — conforme au produit. Pour
      // viser un jour, il faut le dire.
      if (!(await t.clic('.btn--sm', { texte: /Un jour/, delai: 600, obligatoire: false })))
        t.injouable('pas de choix « Un jour » dans la feuille d\'ajout');
      await t.clic('.btn--primary.btn--full', { delai: 1600 });
      const v = await t.voyage();
      const apres = v.days.reduce((s, d) => s + d.activities.length, 0);
      t.verifier("l'activité rejoint le programme", apres === avant + 1, `${avant} → ${apres}`);
      t.verifier('elle porte le titre saisi',
        v.days.some(d => d.activities.some(a => a?.title === 'Musée du Belvédère')));
      t.verifier('elle n\'a pas atterri aussi dans la Réserve',
        v.reserve.length === v0.reserve.length, `réserve ${v0.reserve.length} → ${v.reserve.length}`);
    } },

  { groupe: 'Réserve', nom: 'Ajouter une idée à la Réserve', depart: 'voyage',
    intention: "Le geste d'avant le voyage : accumuler des idées sans les caler.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      const v0 = await t.voyage();
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="Déjeuner au marché"]', 'Naschmarkt');
      t.verifier('la Réserve est la destination par défaut',
        await t.p.evaluate(() => [...document.querySelectorAll('.btn--sm')]
          .some(b => /Réserve/.test(b.innerText) && b.className.includes('primary'))));
      await t.clic('.btn--primary.btn--full', { delai: 1600 });
      const v = await t.voyage();
      t.verifier("l'idée rejoint la Réserve",
        v.reserve.length === v0.reserve.length + 1, `${v0.reserve.length} → ${v.reserve.length}`);
      t.verifier('elle porte le titre saisi', v.reserve.some(a => a?.title === 'Naschmarkt'));
    } },

  { groupe: 'Planning', nom: "Changer l'heure d'une activité", depart: 'voyage',
    intention: "Caler une activité à 15 h et la voir bouger dans la journée.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      await t.ouvrirLeJour();
      await t.menuFiche(/Modifier/);
      const heure = t.p.locator('.sheet input[type="time"]');
      if (!(await heure.count())) t.injouable("pas de champ d'heure dans la fiche");
      await heure.first().fill('15:30');
      await t.clic('.btn--primary.btn--full', { delai: 1300 });
      const v = await t.voyage();
      const cale = v.days.flatMap(d => d.activities).find(a => a?.fixedStart === '15:30');
      t.verifier("l'heure est enregistrée", !!cale, cale?.title);
      await t.onglet(/Planning/i);
      t.verifier("l'heure apparaît dans le planning", (await t.texte()).includes('15:30'));
    } },

  { groupe: 'Planning', nom: "Réordonner les activités au doigt", depart: 'voyage',
    intention: "Glisser une activité pour changer l'ordre de la journée.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const jourAvant = (await t.voyage()).days.find(d => d.activities.length >= 3);
      if (!jourAvant) t.injouable('aucun jour avec trois activités');
      const ordreAvant = jourAvant.activities.map(a => a.id);
      const geste = await t.glisser(0, 2);
      t.verifier('la fiche survolée est signalée pendant le glissement', geste.marque);
      const jourApres = (await t.voyage()).days.find(d => d.id === jourAvant.id);
      const ordreApres = (jourApres.activities || []).map(a => a?.id);
      // Le vrai risque n'est pas « l'ordre n'a pas changé » — c'est de perdre
      // des activités en route. Ça s'est produit : un jour entier vidé,
      // remplacé par des cases vides, sans rien à l'écran pour le dire.
      t.verifier('aucune activité perdue ni vidée',
        ordreApres.length === ordreAvant.length && ordreApres.every(Boolean),
        `${ordreAvant.length} → ${ordreApres.length}`);
      t.verifier('ce sont les mêmes activités',
        ordreAvant.every(id => ordreApres.includes(id)));
      t.verifier("l'ordre a effectivement changé",
        ordreApres.join() !== ordreAvant.join(),
        `${ordreAvant.slice(0, 3).join(',')} → ${ordreApres.slice(0, 3).join(',')}`);
    } },

  { groupe: 'Planning', nom: 'Changer de vue', depart: 'voyage',
    intention: "Passer du jour à la frise et à l'agenda.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const vues = new Set();
      for (let i = 0; i < 4; i++) {
        vues.add(await t.p.evaluate(() =>
          ['.timeline-view', '.agenda-view', '.day-section', '.tl-day'].find(s => document.querySelector(s)) || 'aucune'));
        if (!(await t.clic('.tool-btn--view-cycle', { delai: 700, obligatoire: false }))) break;
      }
      t.verifier('au moins deux vues différentes', vues.size >= 2, [...vues].join(' · '));
    } },

  { groupe: 'Planning', nom: 'Supprimer une activité et annuler', depart: 'voyage',
    intention: "Se tromper, et pouvoir revenir en arrière.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const avant = (await t.voyage()).days.reduce((s, d) => s + d.activities.length, 0);
      await t.ouvrirLeJour();
      if (!(await t.menuFiche(/Supprimer/, { obligatoire: false })))
        t.injouable('pas de suppression proposée dans le menu de la fiche');
      await t.clic('button', { texte: /Supprimer|Confirmer|Oui/, delai: 800, obligatoire: false });
      const milieu = (await t.voyage()).days.reduce((s, d) => s + d.activities.length, 0);
      t.verifier("l'activité est supprimée", milieu === avant - 1, `${avant} → ${milieu}`);
      const annule = await t.clic('button', { texte: /Annuler|↩/, delai: 900, obligatoire: false });
      if (!annule) { t.friction("aucun moyen d'annuler une suppression", 'la suppression est définitive'); return; }
      const apres = (await t.voyage()).days.reduce((s, d) => s + d.activities.length, 0);
      t.verifier("l'annulation restaure l'activité", apres === avant, `${milieu} → ${apres}`);
    } },

  { groupe: 'Réserve', nom: 'Piocher une idée dans la Réserve', depart: 'voyage',
    intention: "Le geste central du produit : prendre une idée et la mettre au programme.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      const v0 = await t.voyage();
      const nReserve = v0.reserve.length;
      const nJours = v0.days.reduce((s, d) => s + d.activities.length, 0);
      t.verifier('la Réserve contient des idées', nReserve > 0, `${nReserve} idées`);
      if (!(await t.clic('.reserve-assign__toggle', { delai: 700, obligatoire: false })))
        t.injouable('aucun bouton pour assigner une idée');
      if (!(await t.clic('.reserve-assign__day', { delai: 1100, obligatoire: false })))
        t.injouable('« Assigner » n\'ouvre aucun jour où déposer l\'idée');
      const v = await t.voyage();
      const apresR = v.reserve.length;
      const apresJ = v.days.reduce((s, d) => s + d.activities.length, 0);
      t.verifier("l'idée quitte la Réserve pour le programme",
        apresR === nReserve - 1 && apresJ === nJours + 1,
        `réserve ${nReserve}→${apresR}, programme ${nJours}→${apresJ}`);
    } },

  { groupe: 'Réserve', nom: 'Trier et filtrer la Réserve', depart: 'voyage',
    intention: "Retrouver vite une idée parmi beaucoup.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      const total = await t.combien('.reserve-card');
      t.verifier('les idées sont listées', total > 0, `${total} fiches`);
      const filtres = await t.combien('.reserve-filter__pill');
      if (!filtres) t.injouable('aucun filtre de réserve');
      const pills = t.p.locator('.reserve-filter__pill');
      // Un filtre de catégorie doit réduire la liste, pas la laisser telle quelle.
      let reduit = false;
      for (let i = 1; i < Math.min(filtres, 4); i++) {
        await pills.nth(i).click(); await t.p.waitForTimeout(500);
        const n = await t.combien('.reserve-card');
        if (n < total && n > 0) { reduit = true; break; }
      }
      t.verifier('un filtre réduit bien la liste', reduit);
    } },

  { groupe: 'Réserve', nom: 'Réordonner la Réserve au doigt', depart: 'voyage',
    intention: "Remonter une idée qu'on veut garder sous la main.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      // Les poignées n'apparaissent qu'en liste à plat : groupée ou triée, une
      // position manuelle ne voudrait rien dire.
      if (!(await t.combien('.reserve-card__grip')))
        await t.clic('.reserve-filter__pill', { texte: /Group/, delai: 700, obligatoire: false });
      if (!(await t.combien('.reserve-card__grip')))
        t.injouable('aucune poignée même en liste à plat');
      const avant = (await t.voyage()).reserve.map(a => a.id);
      await t.glisser(0, 2);
      const apres = (await t.voyage()).reserve.map(a => a?.id);
      t.verifier('aucune idée perdue', apres.length === avant.length && apres.every(Boolean),
        `${avant.length} → ${apres.length}`);
      t.verifier("l'ordre a changé", apres.join() !== avant.join());
    } },

  { groupe: 'Dépenses', nom: 'Ajouter une dépense et voir qui doit quoi', depart: 'voyage',
    intention: "Payer une addition et savoir immédiatement comment on se répartit.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.clic('.expenses-add-top, button:has-text("Ajouter une dépense")', { delai: 700 });
      await t.saisir('input.form-input', 'Café Central');
      const montant = t.p.locator('input[type="number"]').first();
      if (!(await montant.count())) t.injouable('pas de champ montant');
      await montant.fill('24');
      await t.clic('button', { texte: /Ajouter|Enregistrer|✅/, delai: 1000 });
      const v = await t.voyage();
      const dep = (v.expenses || []).find(e => e.description === 'Café Central');
      t.verifier('la dépense est enregistrée', !!dep, dep && `${dep.amount} €`);
      const txt = await t.texte();
      t.verifier('elle apparaît dans la liste', txt.includes('Café Central'));
      t.verifier('un total est affiché', /\d[\d\s,.]*\s*€/.test(txt));
    } },

  { groupe: 'Dépenses', nom: 'La catégorie « Verre » existe', depart: 'voyage',
    intention: "Noter un verre — la dépense la plus fréquente en voyage.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.clic('.expenses-add-top, button:has-text("Ajouter une dépense")', { delai: 700 });
      t.verifier('« Verre » est proposée',
        (await t.texte()).match(/Verre/i) !== null);
    } },

  { groupe: 'Dépenses', nom: 'Les trois vues des dépenses', depart: 'voyage',
    intention: "Voir les dépenses en liste, par catégorie, par personne.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      const n = await t.combien('.expenses-section-btn');
      if (!n) t.injouable('pas de sélecteur de vue (aucune dépense ?)');
      const vues = [];
      for (let i = 0; i < n; i++) {
        await t.p.locator('.expenses-section-btn').nth(i).click();
        await t.p.waitForTimeout(600);
        vues.push((await t.texte()).slice(0, 400));
      }
      t.verifier('les vues montrent des contenus différents',
        new Set(vues).size === vues.length, `${vues.length} vues`);
    } },

  { groupe: 'Dépenses', nom: 'Modifier puis supprimer une dépense', depart: 'voyage',
    intention: "Corriger une erreur de saisie.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      const avant = (await t.voyage()).expenses.length;
      if (!(await t.clic('button', { texte: '✏️', delai: 700, obligatoire: false })))
        t.injouable('aucun bouton de modification');
      const montant = t.p.locator('input[type="number"]').first();
      await montant.fill('99');
      await t.clic('button', { texte: /Enregistrer|Ajouter|✅/, delai: 900 });
      const modifiee = (await t.voyage()).expenses.some(e => Number(e.amount) === 99);
      t.verifier('la modification est enregistrée', modifiee);
      await t.clic('button', { texte: '🗑️', delai: 600, obligatoire: false });
      await t.clic('button', { texte: /Supprimer|Confirmer|Oui/, delai: 800, obligatoire: false });
      const apres = (await t.voyage()).expenses.length;
      t.verifier('la suppression fonctionne', apres === avant - 1, `${avant} → ${apres}`);
    } },

  { groupe: 'Carte', nom: 'La carte montre les lieux et reste manipulable', depart: 'voyage',
    intention: "Voir où sont les choses, et pouvoir zoomer.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Carte/i);
      await t.p.waitForTimeout(1400);
      t.verifier('des épingles sont posées', (await t.combien('.leaflet-marker-icon')) > 0,
        `${await t.combien('.leaflet-marker-icon')} épingles`);
      t.verifier('les commandes de zoom sont atteignables', await t.p.evaluate(() => {
        const z = document.querySelector('.leaflet-control-zoom-in');
        if (!z) return false;
        const r = z.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!dessus && (dessus === z || z.contains(dessus));
      }));
      const avant = await t.p.evaluate(() => document.querySelectorAll('.leaflet-tile').length);
      await t.clic('.leaflet-control-zoom-in', { delai: 900 });
      t.verifier('le zoom réagit',
        await t.p.evaluate(() => document.querySelectorAll('.leaflet-tile').length) !== avant
        || await t.p.evaluate(() => getComputedStyle(document.querySelector('.leaflet-tile-container')).transform !== 'none'));
    } },

  { groupe: 'Menu ⋯', nom: 'Rechercher dans le voyage', depart: 'voyage',
    intention: "Retrouver « Schönbrunn » sans savoir où il est rangé.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Rechercher/);
      if (!(await t.visible('.trip-search'))) t.injouable('la recherche ne s\'ouvre pas');
      await t.saisir('.trip-search__input', 'Schön');
      await t.p.waitForTimeout(600);
      const n = await t.combien('.trip-search__row');
      t.verifier('la recherche trouve le lieu', n > 0, `${n} résultats`);
      if (n > 0) {
        await t.clic('.trip-search__row', { delai: 900 });
        t.verifier('le résultat mène quelque part', !(await t.visible('.trip-search')));
      }
    } },

  { groupe: 'Menu ⋯', nom: 'Notes du voyage', depart: 'voyage',
    intention: "Noter un numéro de vol et le retrouver plus tard.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Notes/);
      const zone = t.p.locator('textarea').first();
      if (!(await zone.count())) t.injouable('pas de zone de notes');
      await zone.fill('Train 14h12 — quai 3');
      await t.p.waitForTimeout(900);
      t.verifier('la note est enregistrée',
        ((await t.voyage())?.tripNotes || '').includes('quai 3'));
    } },

  { groupe: 'Menu ⋯', nom: 'Valise', depart: 'voyage',
    intention: "Cocher ce qui est dans le sac.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Valise/);
      const champ = t.p.locator('input.form-input').first();
      if (!(await champ.count())) t.injouable('pas de champ pour ajouter un objet');
      await champ.fill('Chargeur');
      await champ.press('Enter');
      await t.p.waitForTimeout(700);
      const v = await t.voyage();
      const objet = (v.packingList || []).find(i => (i.text || '').includes('Chargeur'));
      t.verifier("l'objet est ajouté à la valise", !!objet);
      if (objet) {
        await t.clic('.packing-item__check', { delai: 700, obligatoire: false });
        const coches = ((await t.voyage()).packingList || []).filter(i => i.checked).length;
        t.verifier('on peut cocher un objet', coches > 0, `${coches} cochés`);
      }
    } },

  { groupe: 'Menu ⋯', nom: 'Bilan du voyage', depart: 'voyage',
    intention: "Regarder ce qu'on a fait et ce qu'on a dépensé.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Bilan/);
      t.verifier('le bilan s\'ouvre', await t.visible('.recap-hero, .trip-recap'));
      const txt = await t.texte();
      t.verifier('il chiffre quelque chose', /\d/.test(txt));
    } },

  { groupe: 'Menu ⋯', nom: 'Paramètres du voyage', depart: 'voyage',
    intention: "Renseigner l'hébergement et les voyageurs.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Paramètres/);
      t.verifier('les paramètres s\'ouvrent', await t.visible('.sheet'));
      const txt = await t.texte();
      t.verifier('l\'hébergement est réglable ici', /h[ée]bergement|logement|adresse/i.test(txt));
      t.verifier('les voyageurs sont réglables ici', /voyageur|participant|personne/i.test(txt));
    } },

  { groupe: 'Menu ⋯', nom: 'Vérifier les lieux', depart: 'voyage',
    intention: "Repérer les lieux mal situés avant de partir.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Vérifier les lieux/);
      t.verifier('la vérification s\'ouvre', await t.visible('.sheet'));
      const txt = await t.texte();
      t.verifier('elle dit quelque chose de compréhensible', txt.length > 50);
    } },

  { groupe: 'Menu ⋯', nom: 'Supprimer le voyage demande confirmation', depart: 'voyage',
    intention: "Ne pas perdre son voyage sur un geste malheureux.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Supprimer le voyage/);
      const encore = await t.voyage();
      t.verifier('rien n\'est supprimé sans confirmer', !!encore);
      t.verifier('une confirmation est demandée',
        await t.visible('.confirm-box'),
        (await t.texte()).match(/Supprimer ce voyage[^\n]*/)?.[0]);
    } },

  { groupe: 'Transverse', nom: 'Tout est là après rechargement', depart: 'voyage',
    intention: "Fermer l'app, la rouvrir, tout retrouver — y compris hors ligne.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const avant = await t.voyage();
      await t.p.reload({ waitUntil: 'domcontentloaded' });
      await t.p.waitForTimeout(1400);
      const apres = await t.voyage();
      t.verifier('le voyage survit au rechargement',
        !!apres && apres.id === avant.id);
      t.verifier('le programme est intact',
        apres.days.reduce((s, d) => s + d.activities.length, 0)
        === avant.days.reduce((s, d) => s + d.activities.length, 0));
      t.verifier('les dépenses sont intactes',
        (apres.expenses || []).length === (avant.expenses || []).length);
    } },

  { groupe: 'Transverse', nom: 'Le mode sombre s\'applique partout', depart: 'voyage',
    intention: "Basculer en sombre le soir sans écran illisible.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Mode sombre|Mode clair/);
      const theme = await t.p.evaluate(() => document.documentElement.getAttribute('data-theme'));
      t.verifier('le thème change', !!theme, theme);
      const clairsEnSombre = await t.p.evaluate(() => {
        if (document.documentElement.getAttribute('data-theme') !== 'dark') return null;
        // Un fond resté blanc en mode sombre éblouit dans le noir.
        return [...document.querySelectorAll('.tab-content *')].filter(el => {
          const c = getComputedStyle(el).backgroundColor.match(/\d+/g);
          return c && Number(c[0]) > 245 && Number(c[1]) > 245 && Number(c[2]) > 245;
        }).length;
      });
      if (clairsEnSombre !== null && clairsEnSombre > 0)
        t.friction('des fonds restent blancs en mode sombre', `${clairsEnSombre} éléments`);
    } },
  // ── Deuxième vague : les états rares, et les promesses du produit ─────────

  { groupe: 'États vides', nom: 'Un voyage sans rien oriente vers la suite', depart: VIDE,
    intention: "Voyage tout neuf : chaque onglet doit dire quoi faire, et le dire juste.",
    async faire(t) {
      await t.ouvrirVoyage();
      for (const [nom, re] of [["Aujourd'hui", /Aujourd'hui/i], ['Planning', /Planning/i],
                               ['Réserve', /Réserve/i], ['Dépenses', /Dépenses/i], ['Carte', /Carte/i]]) {
        if (!(await t.onglet(re, { facultatif: true }))) continue;
        const contenu = (await t.p.evaluate(() =>
          document.querySelector('.tab-content')?.innerText || '')).trim();
        t.verifier(`${nom} : l'écran vide dit quelque chose`, contenu.length > 15,
          contenu.slice(0, 60).replace(/\n/g, ' · ') || '(rien)');

        // Un conseil ne vaut que s'il désigne quelque chose d'atteignable. Une
        // consigne qui nomme un bouton absent est pire que pas de consigne :
        // l'utilisateur le cherche.
        const nomme = contenu.match(/bouton ([A-ZÀ-Ü][\wÀ-ÿ '’-]{2,24})/);
        if (nomme) {
          const cible = nomme[1].trim();
          const existe = await t.p.evaluate((c) => [...document.querySelectorAll('button, a, [role=button]')]
            .some(b => b.offsetParent !== null
              && ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || ''))
                 .toLowerCase().includes(c.toLowerCase())), cible);
          t.verifier(`${nom} : le bouton « ${cible} » annoncé existe à l'écran`, existe);
        }
      }
    } },

  { groupe: 'Propositions', nom: 'Un conflit horaire est signalé', depart: CONFLIT,
    intention: "Deux activités calées à la même heure : l'app doit le dire.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const dansLaFrise = (await t.texte()).match(/conflit|chevauch/i);
      await t.ouvrirLeJour();
      const dansLeJour = (await t.texte()).match(/conflit|chevauch/i);
      t.verifier('le chevauchement est signalé quelque part',
        !!(dansLaFrise || dansLeJour),
        `frise : ${dansLaFrise ? 'oui' : 'non'} · détail du jour : ${dansLeJour ? 'oui' : 'non'}`);
    } },

  { groupe: 'Propositions', nom: 'Une journée surchargée est signalée', depart: SURCHARGE,
    intention: "Douze heures de programme : l'app doit prévenir.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const frise = (await t.texte()).match(/surcharg/i);
      await t.ouvrirLeJour();
      const jour = (await t.texte()).match(/surcharg/i);
      t.verifier('la surcharge est signalée quelque part', !!(frise || jour),
        `frise : ${frise ? 'oui' : 'non'} · détail du jour : ${jour ? 'oui' : 'non'}`);
      if (!frise && jour) t.friction("l'alerte n'existe que dans le détail du jour",
        'la vue par défaut du planning ne la montre pas — il faut ouvrir le jour pour la voir');
    } },

  { groupe: 'Dépenses', nom: 'Seul en voyage : pas de partage absurde', depart: SOLO,
    intention: "Voyager seul ne doit pas produire « tu te dois 30 € ».",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      const txt = await t.texte();
      t.verifier('aucune dette envers soi-même', !/doit .* à .*Thomas.*Thomas/i.test(txt));
      t.verifier('le total est affiché', /60/.test(txt));
      const dettes = await t.combien('.debt-row');
      t.verifier('aucune ligne « qui doit à qui »', dettes === 0, `${dettes} lignes`);
    } },

  { groupe: "Aujourd'hui", nom: "Voyage pas encore commencé", depart: PAS_PARTI,
    intention: "Le voyage est dans un mois : l'écran du jour doit rester sensé.",
    async faire(t) {
      const accueil = (await t.texte()).replace(/\n/g, ' · ');
      t.verifier("l'accueil annonce le départ à venir",
        /départ|dans \d+ jour|J-\d+|à venir|bient[oô]t/i.test(accueil), accueil.slice(0, 110));
      await t.ouvrirVoyage();
      const ongletDuJour = await t.onglet(/Aujourd'hui/i, { facultatif: true });
      const txt = (await t.texte()).replace(/\n/g, ' · ');
      // L'onglet du jour n'a pas de sens avant le départ : son absence est un
      // choix, pas un manque. Ce qui compterait, c'est un écran qui mentirait.
      t.verifier("rien ne prétend qu'un jour est en cours",
        !/Jour \d+ \/ \d+/.test(txt) || /départ|dans \d+ jour|à venir/i.test(txt),
        `${ongletDuJour ? 'onglet présent' : 'onglet masqué (voulu)'} — ${txt.slice(0, 80)}`);
      t.verifier('le voyage reste préparable (Planning et Réserve accessibles)',
        await t.onglet(/Réserve/i, { facultatif: true }));
    } },

  { groupe: "Aujourd'hui", nom: 'Voyage terminé', depart: TERMINE,
    intention: "Le voyage est fini : on doit pouvoir regarder en arrière, pas se voir « en cours ».",
    async faire(t) {
      const accueil = (await t.texte()).replace(/\n/g, ' · ');
      t.verifier("le voyage fini est rangé à part sur l'accueil",
        /historique|termin|pass[ée]|souvenir/i.test(accueil), accueil.slice(0, 110));
      await t.ouvrirVoyage();
      const ongletDuJour = await t.onglet(/Aujourd'hui/i, { facultatif: true });
      const txt = (await t.texte()).replace(/\n/g, ' · ');
      t.verifier("l'app ne propose pas une activité d'un voyage fini",
        !ongletDuJour || /termin|fini|pass[ée]|bilan|souvenir/i.test(txt),
        `${ongletDuJour ? 'onglet présent' : 'onglet masqué (voulu)'} — ${txt.slice(0, 80)}`);
      await t.menu(/Bilan/);
      t.verifier('le bilan reste accessible', await t.visible('.recap-hero, .trip-recap'));
    } },

  { groupe: 'Réserve', nom: 'Un titre à rallonge ne casse pas la fiche', depart: TITRE_LONG,
    intention: "Un lieu importé porte souvent un nom interminable.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      const debord = await t.p.evaluate(() => {
        const c = document.querySelector('.reserve-card');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { carte: Math.round(r.width), fenetre: innerWidth,
          page: Math.round(document.documentElement.scrollWidth) };
      });
      if (!debord) t.injouable('aucune fiche dans la Réserve');
      t.verifier('la fiche tient dans la largeur', debord.carte <= debord.fenetre,
        `${debord.carte} px pour ${debord.fenetre}`);
      t.verifier('la page ne part pas en travers', debord.page <= debord.fenetre,
        `${debord.page} px pour ${debord.fenetre}`);
      const boutons = await t.p.evaluate(() => {
        const c = document.querySelector('.reserve-card');
        return [...c.querySelectorAll('button')].filter(b => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth || r.left < 0);
        }).length;
      });
      t.verifier('aucun bouton poussé hors écran', boutons === 0, `${boutons} boutons`);
    } },

  { groupe: 'Menu ⋯', nom: 'Une recherche sans résultat le dit', depart: 'voyage',
    intention: "Chercher quelque chose qui n'existe pas ne doit pas laisser un blanc.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Rechercher/);
      await t.saisir('.trip-search__input', 'zzzzqqq');
      await t.p.waitForTimeout(700);
      const n = await t.combien('.trip-search__row');
      const txt = await t.p.evaluate(() => document.querySelector('.trip-search__body')?.innerText?.trim() || '');
      t.verifier('aucun résultat trouvé', n === 0, `${n} lignes`);
      t.verifier("l'absence de résultat est écrite", txt.length > 5, txt.slice(0, 60) || '(écran vide)');
    } },

  { groupe: 'Réserve', nom: 'Le filtre « Ouvert » ne cache pas les horaires inconnus', depart: 'voyage',
    intention: "Sur place : ne voir que ce qui est ouvert, sans perdre ce qu'on ne sait pas.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      const total = await t.combien('.reserve-card');
      if (!(await t.clic('.reserve-filter__pill', { texte: /Ouvert/, delai: 800, obligatoire: false })))
        t.injouable('pas de filtre « Ouvert »');
      const ouverts = await t.combien('.reserve-card');
      t.verifier('le filtre garde au moins une idée', ouverts > 0, `${total} → ${ouverts}`);
      // Une fiche sans horaires connus n'est pas « fermée » : la masquer ferait
      // disparaître des idées valables sans le dire.
      const sansHoraires = (await t.voyage()).reserve.filter(a => !a.openingHours).length;
      if (sansHoraires && ouverts + sansHoraires < total)
        t.friction('des fiches sans horaires connus disparaissent du filtre',
          `${sansHoraires} fiches sans horaires`);
    } },

  { groupe: 'Dépenses', nom: 'Les repas prévus ne comptent pas comme dépensés', depart: 'voyage',
    intention: "Le programme prévoit, il ne décompte pas — seule une dépense saisie compte.",
    async faire(t) {
      await t.ouvrirVoyage();
      const v = await t.voyage();
      const saisi = (v.expenses || []).reduce((s, e) => s + Number(e.eurAmount ?? e.amount ?? 0), 0);
      const repasPrevus = v.days.flatMap(d => d.activities).filter(a => a?.isMeal)
        .reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
      if (!repasPrevus) t.injouable('aucun repas chiffré dans le voyage de référence');
      await t.onglet(/Dépenses/i);
      const txt = await t.texte();
      const montants = [...txt.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)\s*€/g)]
        .map(m => parseFloat(m[1].replace(/\s/g, '').replace(',', '.')));
      t.verifier('le total dépensé correspond aux dépenses saisies',
        montants.some(m => Math.abs(m - saisi) < 1),
        `saisi ${saisi} € · montants à l'écran ${montants.slice(0, 5).join(', ')}`);
      t.verifier('les repas prévus ne sont pas comptés comme dépensés',
        !montants.some(m => Math.abs(m - (saisi + repasPrevus)) < 1),
        `saisi+repas = ${saisi + repasPrevus} €`);
    } },

  { groupe: 'Réserve', nom: 'Une idée déjà au programme est signalée', depart: 'voyage',
    intention: "Ne pas piocher deux fois la même chose sans s'en rendre compte.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      // Le voyage de référence contient déjà des titres répétés (Schönbrunn sur
      // deux jours, les repas partout). Seuls les doublons APPARUS comptent.
      const titres = (v) => v.days.flatMap(d => (d.activities || []).filter(Boolean).map(a => a.title));
      const compter = (l) => l.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
      const avant = compter(titres(await t.voyage()));
      await t.clic('.reserve-assign__toggle', { delai: 700 });
      await t.clic('.reserve-assign__day', { delai: 1200 });
      const v = await t.voyage();
      const apres = compter(titres(v));
      const nouveaux = Object.entries(apres)
        .filter(([titre, n]) => n > (avant[titre] || 0) + 1)
        .map(([titre, n]) => `${titre} ×${n}`);
      t.verifier('aucun doublon apparu au programme', nouveaux.length === 0,
        nouveaux.join(', ') || 'aucun');
      t.verifier("l'idée a bien quitté la Réserve",
        v.reserve.length === TRIP.reserve.length - 1,
        `${TRIP.reserve.length} → ${v.reserve.length}`);
    } },

  { groupe: 'Propositions', nom: "Piocher pour aujourd'hui : l'app signale ce qui compte", depart: A_SIGNALER,
    intention: "Promesse du produit : elle prévient (fermé, ne rentre pas, c'est loin) — sans rien bloquer.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      await t.clic('.reserve-assign__toggle', { delai: 700 });
      const avant = (await t.voyage()).days[0].activities.length;
      await t.clic('.reserve-assign__day', { delai: 1400 });

      const v = await t.voyage();
      // Le principe est explicite : elle propose, elle ne bloque jamais.
      t.verifier("l'idée est bien placée — rien n'est bloqué",
        v.days[0].activities.length === avant + 1, `${avant} → ${v.days[0].activities.length}`);

      const ecran = (await t.texte()).replace(/\n/g, ' · ');
      const signale = {
        ferme: /ferm[ée]|pas ouvert|horaires/i.test(ecran),
        temps: /ne rentre pas|d[ée]passe|surcharg|temps restant|trop long/i.test(ecran),
        loin: /loin|\d+\s*km|trajet|éloign/i.test(ecran),
      };
      const dits = Object.entries(signale).filter(([, v]) => v).map(([k]) => k);
      if (!dits.length)
        t.friction("rien n'est signalé alors que les trois signaux sont réunis",
          'lieu fermé toute la semaine · 40 km du reste du programme · journée déjà à 10 h — '
          + "l'utilisateur doit vérifier lui-même, ce que le produit existe pour éviter");
      else if (dits.length < 3)
        t.friction(`seuls ${dits.join(' et ')} sont signalés`, `manquent : ${['ferme','temps','loin'].filter(k => !signale[k]).join(', ')}`);
    } },

];

// ── Exécution ───────────────────────────────────────────────────────────────
try {
  await fetch(URL_BASE + '/', { signal: AbortSignal.timeout(4000) });
} catch {
  console.error(`\n✗ Rien ne répond sur ${URL_BASE}. Démarre l'aperçu d'abord :\n`
    + `    npm run build\n    (setsid npx vite preview --port 4173 --strictPort &) ; sleep 3\n`);
  process.exit(2);
}

rmSync(CAPTURES, { recursive: true, force: true });
mkdirSync(CAPTURES, { recursive: true });

const choisis = SEUL
  ? PARCOURS.filter(x => (x.nom + x.groupe).toLowerCase().includes(SEUL.toLowerCase()))
  : PARCOURS;

const navigateur = await chromium.launch({ executablePath: trouverChromium() });
const rapport = [];

for (const parcours of choisis) {
  const ctx = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true, locale: 'fr-FR',
  });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('pageerror', e => erreurs.push(String(e).split('\n')[0].slice(0, 180)));
  // Le réseau extérieur n'est ni nécessaire ni fiable ici. L'app doit marcher
  // hors ligne : c'est une promesse du produit, autant la tenir sous test.
  await p.route('**/*', r => r.request().url().startsWith(URL_BASE) ? r.fallback() : r.abort());
  const amorce = parcours.depart === 'vierge' ? []
    : parcours.depart === 'voyage' ? [TRIP] : [parcours.depart];
  await p.addInitScript(([t, s]) => {
    localStorage.setItem('provo_trips', t);
    localStorage.setItem('provo_settings', s);
    localStorage.setItem('provo_theme', 'light');
    localStorage.setItem('provo_onboarded', '1');
  }, [JSON.stringify(amorce), JSON.stringify(SETTINGS)]);

  const journal = [];
  const t = outils(p, journal);
  let injoue = null;
  try {
    await p.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1100);
    // Un voile d'accueil avale les premiers clics et ferait échouer des
    // parcours parfaitement sains.
    await p.evaluate(() => document.querySelector('.onboarding-overlay__skip, .onboarding__close')?.click());
    await parcours.faire(t);
  } catch (e) {
    if (e instanceof Interrompu) injoue = e.message;
    else { journal.push({ type: 'casse', quoi: 'le parcours s\'interrompt', detail: String(e).split('\n')[0].slice(0, 160) }); }
  }

  // Le pire résultat possible, et le plus facile à rater : l'app est tombée.
  // L'écran de secours efface tout le reste, donc les vérifications suivantes
  // ne diraient rien d'utile — et l'état fautif n'est jamais enregistré, ce qui
  // le rend invisible au contrôle d'intégrité.
  if (await p.locator('.error-screen').count().catch(() => 0))
    journal.push({ type: 'casse', quoi: "l'application est tombée en cours de route",
      detail: 'écran de secours affiché — ce parcours fait planter l\'app' });

  // Un parcours parti d'une app vierge et interrompu avant d'avoir créé quoi
  // que ce soit n'a rien abîmé : il n'y avait rien. Compter « le voyage a
  // disparu » ici serait un défaut inventé.
  const final = await t.voyage().catch(() => null);
  const riemAVerifier = parcours.depart === 'vierge' && !final;
  const maux = riemAVerifier ? [] : integrite(final);
  maux.forEach(m => journal.push({ type: 'casse', quoi: 'données abîmées', detail: m }));
  erreurs.forEach(e => journal.push({ type: 'casse', quoi: 'erreur JavaScript', detail: e }));

  const casses = journal.filter(j => j.type === 'casse');
  if (casses.length) await p.screenshot({ path: `${CAPTURES}/${parcours.nom.replace(/[^a-z0-9]+/gi, '-')}.png` });

  rapport.push({ ...parcours, journal, injoue, casses: casses.length,
    ok: journal.filter(j => j.type === 'ok').length,
    frictions: journal.filter(j => j.type === 'friction').length });
  await ctx.close();
  process.stderr.write('.');
}
await navigateur.close();
process.stderr.write('\n');

// ── Restitution ─────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify(rapport.map(({ faire, ...r }) => r), null, 2));
} else {
  const l = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log('\n' + l('groupe', 12) + l('parcours', 42) + l('état', 12) + 'constats');
  console.log('─'.repeat(96));
  for (const r of rapport) {
    const etat = r.injoue ? 'non joué' : r.casses ? `✗ ${r.casses} cassé${r.casses > 1 ? 's' : ''}` : '✓';
    console.log(l(r.groupe, 12) + l(r.nom, 42) + l(etat, 12)
      + `${r.ok} vérifié${r.ok > 1 ? 's' : ''}${r.frictions ? ` · ${r.frictions} friction` : ''}`);
  }

  const bloc = (titre, type) => {
    const lignes = rapport.flatMap(r => r.journal.filter(j => j.type === type)
      .map(j => `  ${r.groupe} · ${r.nom}\n      ${j.quoi}${j.detail ? ` — ${j.detail}` : ''}`));
    if (lignes.length) console.log(`\n${titre}\n${lignes.join('\n')}`);
  };
  bloc('✗ CASSÉ — la fonction ne fait pas ce qu\'elle promet', 'casse');
  bloc('⚠ FRICTION — ça marche, mais ça coûte', 'friction');

  const nonJoues = rapport.filter(r => r.injoue);
  if (nonJoues.length) {
    console.log('\n· NON JOUÉ — le parcours n\'a pas pu aller au bout (ni réussite ni échec)');
    nonJoues.forEach(r => console.log(`  ${r.groupe} · ${r.nom}\n      ${r.injoue}`));
  }

  const nc = rapport.reduce((s, r) => s + r.casses, 0);
  console.log(`\n${rapport.length} parcours · ${nc} constat(s) cassé(s)`
    + ` · ${rapport.reduce((s, r) => s + r.frictions, 0)} friction(s)`
    + ` · ${nonJoues.length} non joué(s)`);
  if (nc) console.log(`Captures des écrans fautifs : ${CAPTURES}`);
  console.log('\nNon couvert ici : tout ce qui exige le réseau (enrichissement, météo,');
  console.log('import de liens, collaboration Supabase) — voir les scripts diag-*.mjs.');
}

process.exit(rapport.some(r => r.casses) ? 1 : 0);
