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
import { brancherReseau } from './reseau-stubs.mjs';

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
// Par défaut on joue les deux familles. `--hors-ligne` pour n'exercer que ce
// qui doit marcher sans réseau, `--reseau` pour ne garder que les chaînes qui
// en dépendent.
const SEUL_HORS_LIGNE = args.includes('--hors-ligne');
const SEUL_RESEAU = args.includes('--reseau');
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
    /** Ouvre le pli « Détails » de la feuille d'ajout, s'il est fermé. */
    async ouvrirDetails() {
      const pli = p.locator('.details-pli');
      if (!(await pli.count())) return;
      if ((await pli.getAttribute('aria-expanded')) === 'true') return;
      await pli.click();
      await p.waitForTimeout(250);
    },
    async glisser(deIdx = 0, versIdx = 2) {
      const cibles = await p.evaluate(() => [...document.querySelectorAll('[data-reorder-id]')]
        .map(e => { const r = e.getBoundingClientRect();
          return { id: e.dataset.reorderId, y: r.y + r.height / 2, visible: r.height > 0 }; })
        .filter(c => c.visible));
      if (cibles.length <= versIdx) t.injouable(`moins de ${versIdx + 1} fiches déplaçables à l'écran`);
      const g = await p.locator('.tl-act-grip, .reserve-card__grip, .activity-card__drag-handle')
        .nth(deIdx).boundingBox();
      if (!g) t.injouable('poignée de déplacement introuvable');
      // La cible peut être hors écran quand les fiches sont hautes : on vise
      // au plus bas point encore visible, comme un doigt le ferait — le
      // défilement au bord amène le reste.
      const x = g.x + g.width / 2, y0 = g.y + g.height / 2;
      const y1 = Math.min(cibles[versIdx].y, p.viewportSize().height - 110);
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
    // Cinq fois 2 h 30 depuis 09:00 : la journée finit déjà à 21:30. Avec deux
    // heures de plus elle déborderait à 23:30 — c'est ce qui doit être signalé.
    activities: Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, title: `Visite ${i + 1}`, category: 'visite', status: 'todo',
      durationHours: 2, durationMinutes: 30, lat: 48.2082, lon: 16.3738, travelerIds: [],
    })) }, ...TRIP.days.slice(1)],
  reserve: [{ id: 'ferme', title: 'Palais du Belvédère',
    category: 'visite', status: 'todo', durationHours: 2, durationMinutes: 0,
    // Fermé tous les jours de la semaine, et à 40 km du reste du programme.
    openingHours: 'Mo-Su off', lat: 48.5500, lon: 16.3700, travelerIds: [] }] };

// Le 15 août prochain — jour férié en Autriche, et le genre de date où l'on se
// présente devant une porte close sans avoir rien vu venir.
const PROCHAIN_15_AOUT = (() => {
  const n = new Date();
  const a = new Date(n.getFullYear(), 7, 15) < n ? n.getFullYear() + 1 : n.getFullYear();
  return `${a}-08-15`;
})();
const JOUR_FERIE = { ...TRIP,
  destination: 'Vienne', startDate: PROCHAIN_15_AOUT, endDate: PROCHAIN_15_AOUT,
  days: [{ id: 'd1', date: PROCHAIN_15_AOUT, startTime: '09:00', notes: '', activities: [] }],
  // Sans horaires connus : c'est justement le cas où seul le calendrier peut
  // prévenir. Une fiche « fermée » le dirait déjà toute seule.
  reserve: [{ id: 'musee', title: 'Musée Leopold', category: 'visite', status: 'todo',
    durationHours: 2, durationMinutes: 0, travelerIds: [] }] };

// Une journée en cours, un créneau court, et une Réserve où tout ne convient
// pas : fermé, trop loin, trop long. C'est la situation réelle de « il me
// reste deux heures ».
const CRENEAU = { ...TRIP,
  startDate: jour(0), endDate: jour(2),
  days: [{ id: 'd1', date: jour(0), startTime: '09:00', notes: '', activities: [
    { id: 'soir', title: 'Opéra', category: 'fun', status: 'todo',
      durationHours: 2, durationMinutes: 30, fixedStart: '20:00', travelerIds: [] },
  ] }, ...TRIP.days.slice(1)],
  reserve: [
    { id: 'ok1', title: 'Café Sperl', category: 'resto', status: 'todo',
      durationHours: 1, durationMinutes: 0, lat: 48.1985, lon: 16.3620,
      openingHours: 'Mo-Su 07:00-23:00', travelerIds: [] },
    { id: 'ok2', title: 'Albertina', category: 'visite', status: 'todo',
      durationHours: 1, durationMinutes: 30, lat: 48.2044, lon: 16.3684,
      openingHours: 'Mo-Su 10:00-18:00', travelerIds: [] },
    { id: 'ferme', title: 'Musée fermé', category: 'visite', status: 'todo',
      durationHours: 1, durationMinutes: 0, lat: 48.2050, lon: 16.3690,
      openingHours: 'Mo-Su off', travelerIds: [] },
    { id: 'loin', title: 'Abbaye de Melk', category: 'visite', status: 'todo',
      durationHours: 2, durationMinutes: 0, lat: 48.2280, lon: 15.3330, travelerIds: [] },
    { id: 'long', title: 'Randonnée au Kahlenberg', category: 'balade', status: 'todo',
      durationHours: 9, durationMinutes: 0, lat: 48.2049, lon: 16.3680, travelerIds: [] },
  ] };

// Un voyage dont une partie a été faite : la carte du bilan ne montre que le
// vécu, pas le programme prévu.
// Seul le premier jour est fait : il reste donc des lieux situés NON visités,
// sans lesquels on ne pourrait pas prouver qu'ils sont écartés.
const VECU = (() => {
  const t = JSON.parse(JSON.stringify(TRIP));
  t.days[0].activities.forEach(a => { if (a.lat) a.status = 'done'; });
  return t;
})();

/**
 * Le dernier soir : tout est fait, plus rien devant.
 *
 * Le voyage porte exprès les trois pièges qui gonflaient l'estimation :
 * des idées en Réserve qu'on n'a jamais programmées, une activité annulée,
 * et une activité dont la dépense a été saisie en plus de son prix prévu.
 */
const DERNIER_SOIR = (() => {
  const t = JSON.parse(JSON.stringify(TRIP));
  t.initialBudget = 500;
  // Toutes les journées sont derrière : le voyage est fini.
  t.days = joursVides(3, -3).map((d) => ({ ...d, activities: [] }));
  t.days[0].activities = [
    { id: 'a1', title: 'Musée', category: 'visite', status: 'done', price: '20',
      durationHours: 1, durationMinutes: 0, travelerIds: [] },
    { id: 'a2', title: 'Dîner', category: 'resto', status: 'done', price: '40',
      durationHours: 1, durationMinutes: 30, travelerIds: [] },
  ];
  t.days[2].activities = [
    { id: 'a3', title: 'Visite annulée', category: 'visite', status: 'nogo', price: '90',
      durationHours: 2, durationMinutes: 0, travelerIds: [] },
  ];
  // Le dîner a été réglé : sa dépense doit remplacer son prix, pas s'y ajouter.
  t.expenses = [{ id: 'e1', description: 'Dîner', amount: 40, eurAmount: 40, currency: 'EUR',
    expenseCategory: 'repas', payerId: 't1', date: jour(-2), participantIds: ['t1', 't2'],
    activityId: 'a2' }];
  // Des idées jamais programmées : 300 € qui ne doivent apparaître nulle part.
  t.reserve = [
    { id: 'r1', title: 'Idée chère', category: 'visite', status: 'todo', price: '200',
      durationHours: 2, durationMinutes: 0, travelerIds: [] },
    { id: 'r2', title: 'Autre idée', category: 'fun', status: 'todo', price: '100',
      durationHours: 1, durationMinutes: 0, travelerIds: [] },
  ];
  return t;
})();

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
      t.verifier('la barre d\'onglets est là', (await t.combien('.tab-btn')) >= 4,
        `${await t.combien('.tab-btn')} onglets`);
      const txt = await t.texte();
      t.verifier('le nom du voyage est affiché', txt.includes('Vienne'));
    } },

  { groupe: 'Planning', nom: 'Le jour J est au centre en arrivant', depart: 'voyage',
    intention: "L'onglet du jour a disparu : le planning doit répondre à sa place.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      await t.p.waitForTimeout(900);
      const vue = await t.p.evaluate(() => {
        const w = document.querySelector('.timeline-view-wrap');
        const auj = document.querySelector('.tl-day--auj');
        if (!w || !auj) return { auj: false };
        const r = auj.getBoundingClientRect(), c = w.getBoundingClientRect();
        return { auj: true, visible: r.x < c.right && r.right > c.left,
          decalage: Math.round(r.x - c.x) };
      });
      t.verifier("la journée du jour est repérée", vue.auj);
      t.verifier('elle est amenée dans le champ', vue.visible !== false, `décalage ${vue.decalage} px`);
      t.verifier('les activités du jour sont lisibles', (await t.combien('.tl-activity')) > 0,
        `${await t.combien('.tl-activity')} activités`);
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
      await t.ouvrirDetails();
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
      await t.ouvrirDetails();
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
      // Les pastilles de catégorie ne s'affichent qu'en vue liste : en vue
      // groupée, les en-têtes disent déjà la même chose. On bascule donc avant
      // de filtrer — et surtout on vise une CATÉGORIE, pas la pastille
      // voisine : « Ouvert » dépend de l'heure qu'il est, et un parcours qui
      // passe le matin et rougit à midi finit par ne plus être lu.
      await t.clic('.reserve-filter__pill', { texte: /Group/, delai: 600, obligatoire: false });
      // Les pastilles de catégorie portent leur libellé en `aria-label`
      // (« Resto — 3 idées ») : c'est le seul repère stable, la liste se
      // reconstruit à chaque clic et un index gardé en main pointe dans le vide.
      const SEL = '.reserve-filter__pill[aria-label*="idée"]';
      const noms = await t.p.$$eval(SEL, ns => ns.map(n => n.getAttribute('aria-label')));
      if (!noms.length) t.injouable('aucune pastille de catégorie en vue liste');
      let reduit = false, essais = [];
      for (const nom of noms.slice(0, 4)) {
        await t.p.locator(`${SEL}[aria-label="${nom}"]`).first().click();
        await t.p.waitForTimeout(500);
        const n = await t.combien('.reserve-card');
        essais.push(`${nom} → ${n}`);
        if (n < total && n > 0) { reduit = true; break; }
      }
      t.verifier('un filtre de catégorie réduit bien la liste', reduit,
        `${total} au départ · ${essais.join(' · ')}`);
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

  { groupe: 'Réseau', nom: 'Coller une confirmation remplit la fiche', depart: 'voyage',
    reseau: { reservation: 'ok' },
    intention: "Coller le courriel de l'hôtel au lieu de retaper nom, adresse et heure.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]', 'Confirmation de reservation Hotel Sacher Wien. Votre reservation est confirmee du 12/09/2026 au 15/09/2026, arrivee a partir de 15:00. Numero de dossier ABC12345. Philharmoniker Strasse 4, 1010 Wien, Autriche. Merci de presenter cette confirmation a l\'arrivee.');
      await t.clic('.import-row button', { delai: 2400, obligatoire: false });
      t.verifier('le lecteur de réservations est appelé', (t.appels().reservation || 0) > 0,
        `${t.appels().reservation || 0} appels`);
      await t.ouvrirDetails();
      const rempli = await t.p.evaluate(() => {
        const q = (s) => document.querySelector(s)?.value || '';
        return { titre: q('input[placeholder*="Déjeuner au marché"]'),
                 adresse: q('input[placeholder="Lieu"]'),
                 debut: q('input[type="time"]') };
      });
      t.verifier('le titre vient de la confirmation', /Sacher/i.test(rempli.titre), rempli.titre || '(vide)');
      t.verifier("l'adresse aussi", rempli.adresse.length > 5, rempli.adresse || '(vide)');
      t.verifier("l'heure d'arrivée est reprise", rempli.debut === '15:00', rempli.debut || '(vide)');
    } },

  { groupe: 'Réseau', nom: "Une confirmation illisible ne perd pas le texte", depart: 'voyage',
    reseau: { reservation: 'aucun' },
    intention: "Coller un texte que le lecteur ne comprend pas.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]', 'Confirmation de reservation Hotel Sacher Wien. Votre reservation est confirmee du 12/09/2026 au 15/09/2026, arrivee a partir de 15:00. Numero de dossier ABC12345. Philharmoniker Strasse 4, 1010 Wien, Autriche. Merci de presenter cette confirmation a l\'arrivee.');
      await t.clic('.import-row button', { delai: 2400, obligatoire: false });
      const msg = await t.texte('.import-msg');
      t.verifier('on dit que ça n\'a pas pu être lu', /pas pu être lu|réservation/i.test(msg), msg || '(rien)');
      t.verifier('le formulaire est ouvert pour finir à la main',
        await t.visible('input[placeholder*="Déjeuner au marché"]'));
    } },

  { groupe: 'Réseau', nom: "Coller la légende d'un post remplit la fiche", depart: 'voyage',
    reseau: { legende: 'ok' },
    intention: "TikTok ne rend plus le texte de ses posts : on le colle soi-même.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]',
        'Le meilleur barbecue coréen de Vienne 🔥 viande grillée devant toi et banchan '
        + 'à volonté, pense à réserver le week-end #vienne #coreen #bbq #foodtok');
      await t.clic('.import-row button', { delai: 2400, obligatoire: false });
      t.verifier('le texte part au lecteur de légendes', (t.appels().legende || 0) > 0,
        `${t.appels().legende || 0} appels`);
      await t.ouvrirDetails();
      const rempli = await t.p.evaluate(() => {
        const q = (s) => document.querySelector(s)?.value || '';
        return { titre: q('input[placeholder*="Déjeuner au marché"]'),
                 adresse: q('input[placeholder="Lieu"]') };
      });
      t.verifier('le nom du lieu est extrait du texte', /Deoun/i.test(rempli.titre),
        rempli.titre || '(vide)');
      t.verifier("l'adresse aussi", rempli.adresse.length > 5, rempli.adresse || '(vide)');
      t.verifier('on dit où le nom a été lu', /lu dans la légende/i.test(await t.texte()));
    } },

  { groupe: 'Réseau', nom: 'Une légende sans lieu le dit et ne bloque rien', depart: 'voyage',
    reseau: { legende: 'aucun' },
    intention: "Coller un texte qui ne nomme aucun lieu.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]',
        'Trois jours de folie avec la meilleure équipe du monde 🥹 je ne me remets '
        + 'toujours pas de ce voyage #souvenirs #entrenous #teamvacances');
      await t.clic('.import-row button', { delai: 2400, obligatoire: false });
      t.verifier('on dit qu\'aucun lieu n\'a été trouvé',
        /aucun lieu nommé/i.test(await t.texte()));
      t.verifier('le formulaire reste utilisable',
        await t.visible('input[placeholder*="Déjeuner au marché"]'));
    } },

  { groupe: 'Réseau', nom: "Une confirmation n'est jamais lue comme une légende", depart: 'voyage',
    reseau: { reservation: 'ok', legende: 'ok' },
    intention: "Les deux formes sont du texte long collé : la plus précise doit gagner.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]', 'Confirmation de reservation Hotel Sacher Wien. Votre reservation est confirmee du 12/09/2026 au 15/09/2026, arrivee a partir de 15:00. Numero de dossier ABC12345. Philharmoniker Strasse 4, 1010 Wien, Autriche. Merci de presenter cette confirmation a l\'arrivee.');
      await t.clic('.import-row button', { delai: 2400, obligatoire: false });
      t.verifier('le lecteur de réservations est appelé', (t.appels().reservation || 0) > 0,
        `${t.appels().reservation || 0} appels`);
      t.verifier('le lecteur de légendes ne l\'est pas', !(t.appels().legende > 0),
        `${t.appels().legende || 0} appels`);
    } },

  // ── Ce qui est arrivé en août 2026 et n'était couvert par rien ─────────────

  { groupe: 'Documents', nom: 'Attacher un billet au voyage', depart: 'voyage',
    intention: "Ranger un billet de train, qui n'appartient à aucune activité.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Notes/);
      t.verifier("les billets ont leur place dans les notes", await t.visible('.trip-docs'));
      const champ = t.p.locator('.trip-docs input[type="file"]');
      if (!(await champ.count())) t.injouable('pas de champ fichier');
      await champ.setInputFiles({
        name: 'billet-train.pdf', mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
      });
      await t.p.waitForTimeout(700);
      t.verifier('le billet apparaît', (await t.texte()).includes('billet-train.pdf'));
      const v = await t.voyage();
      t.verifier('il est enregistré dans le voyage', (v.documents || []).length === 1,
        `${(v.documents || []).length} document(s)`);
      t.verifier("il est lisible sans réseau (stocké, pas lié)",
        String(v.documents?.[0]?.data || '').startsWith('data:'));
      await t.clic('.trip-doc__retirer', { delai: 500 });
      t.verifier('et il se retire', ((await t.voyage()).documents || []).length === 0);
    } },

  { groupe: 'Documents', nom: 'Un fichier refusé dit pourquoi', depart: 'voyage',
    intention: "Déposer autre chose qu'une image ou un PDF.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Notes/);
      const champ = t.p.locator('.trip-docs input[type="file"]');
      if (!(await champ.count())) t.injouable('pas de champ fichier');
      await champ.setInputFiles({
        name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour'),
      });
      await t.p.waitForTimeout(600);
      const msg = await t.texte('.trip-docs__erreur');
      t.verifier('la raison est dite', /ni une image ni un PDF/i.test(msg), msg || '(rien)');
      t.verifier("rien n'est enregistré", ((await t.voyage()).documents || []).length === 0);
    } },

  { groupe: 'Carte', nom: "La carte se garde toute seule avant le départ", depart: 'voyage',
    intention: "Ouvrir la carte à l'approche du voyage doit préparer le hors-ligne.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Carte/i);
      // Le pré-chargement est volontairement lent (six tuiles, pause entre
      // chaque salve) : on attend son verdict au lieu d'un délai au jugé.
      const fin = Date.now() + 25000;
      let v = await t.voyage();
      while (!v.carteHorsLigne && Date.now() < fin) {
        await t.p.waitForTimeout(700);
        v = await t.voyage();
      }
      t.verifier('le pré-chargement a eu lieu et est retenu', !!v.carteHorsLigne,
        JSON.stringify(v.carteHorsLigne || null));
      // Le point capital : ça ne doit pas recommencer à chaque ouverture.
      await t.onglet(/Planning/i);
      await t.onglet(/Carte/i);
      await t.p.waitForTimeout(1200);
      const apres = await t.voyage();
      t.verifier('et ne recommence pas au second passage',
        JSON.stringify(apres.carteHorsLigne) === JSON.stringify(v.carteHorsLigne));
      t.verifier("aucune interface n'a été ajoutée pour ça",
        !(await t.combien('.confirm-box')) && !/Télécharger la carte/i.test(await t.texte()));
    } },

  { groupe: 'Carte', nom: "Un voyage lointain ne télécharge rien", depart: PAS_PARTI,
    intention: "Le pré-chargement ne doit pas consommer des données un mois à l'avance.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Carte/i);
      await t.p.waitForTimeout(2200);
      t.verifier('rien n\'a été téléchargé', !(await t.voyage()).carteHorsLigne);
    } },

  { groupe: 'Dépenses', nom: 'Ajouter une dépense et voir qui doit quoi', depart: 'voyage',
    intention: "Payer une addition et savoir immédiatement comment on se répartit.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.clic('.expenses-add-top, button:has-text("Ajouter une dépense")', { delai: 700 });
      await t.saisir('input.form-input:not([type="number"])', 'Café Central');
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
      // Les catégories vivent derrière le pli « Détails » : le formulaire
      // s'ouvre sur montant + description, et rien d'autre. Le pli annonce
      // ce qu'il contient, donc on vérifie les deux — l'annonce et le contenu.
      t.verifier('la catégorie retenue est annoncée sans déplier',
        /Autre|Transport|Repas/.test(await t.p.locator('.details-pli small').innerText()));
      await t.clic('.details-pli', { delai: 500 });
      t.verifier('« Verre » est proposée',
        (await t.texte()).match(/Verre/i) !== null);
    } },

  { groupe: 'Réserve', nom: 'Le menu ⋯ d\'une idée montre toutes ses entrées', depart: 'voyage',
    intention: "Modifier une idée de la Réserve — l'entrée doit être là, et visible.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      await t.clic('[aria-label*="Options de l\'activité"]', { delai: 800 });
      t.verifier('le menu s\'ouvre', await t.visible('.act-sheet'));
      // Le voile est `position: fixed` : il doit couvrir l'écran, pas la carte.
      // Enfermé dans la fiche (content-visibility ⇒ confinement de peinture),
      // il faisait 358 × 174 et « Modifier », dessiné plus haut que la boîte,
      // n'apparaissait nulle part.
      const m = await t.p.evaluate(() => {
        const o = document.querySelector('.act-sheet-overlay');
        const r = o.getBoundingClientRect();
        const item = [...o.querySelectorAll('.act-sheet__item')]
          .find(b => /Modifier/.test(b.textContent));
        const q = item?.getBoundingClientRect();
        return {
          voile: [Math.round(r.width), Math.round(r.height)],
          ecran: [innerWidth, innerHeight],
          modifier: q ? { haut: Math.round(q.top), dedans: q.top >= r.top && q.bottom <= r.bottom + 1 } : null,
        };
      });
      t.verifier('le voile couvre tout l\'écran',
        m.voile[0] === m.ecran[0] && m.voile[1] === m.ecran[1],
        `${m.voile.join('×')} pour ${m.ecran.join('×')}`);
      t.verifier('« Modifier » est bien dans le cadre du menu',
        !!m.modifier?.dedans, JSON.stringify(m.modifier));
      await t.clic('.act-sheet__item', { texte: /Modifier/, delai: 900 });
      t.verifier('la feuille d\'édition s\'ouvre', await t.visible('.sheet'));
    } },

  { groupe: 'Planning', nom: 'Corriger une activité sans quitter le Planning', depart: 'voyage',
    intention: "Une heure fausse, un prix oublié : on corrige là où on l'a vu.",
    async faire(t) {
      await t.ouvrirVoyage();
      const avant = (await t.voyage()).days.flatMap(d => d.activities).find(a => a.title);
      await t.clic('.tl-activity', { delai: 700 });
      if (!(await t.clic('.tl-activity__modifier', { delai: 900, obligatoire: false })))
        t.injouable('aucun chemin vers « Modifier » depuis la frise');
      t.verifier("la feuille d'édition s'ouvre", await t.visible('.sheet'));
      // Le premier champ de la feuille est la RECHERCHE de lieu ; le titre
      // vit sous le pli « Détails », déjà ouvert en modification.
      const titre = t.p.locator('.sheet input[placeholder*="Déjeuner au marché"]').first();
      if (!(await titre.count())) t.injouable('pas de champ titre dans la feuille');
      await titre.fill('Corrigé depuis le Planning');
      await t.clic('.sheet button', { texte: /Enregistrer|✅/, delai: 1200 });
      const apres = (await t.voyage()).days.flatMap(d => d.activities);
      t.verifier('la correction est enregistrée',
        apres.some(a => a.title === 'Corrigé depuis le Planning'),
        `« ${avant?.title} » → « ${apres.find(a => a.id === avant?.id)?.title} »`);
      t.verifier('aucune activité perdue au passage',
        apres.length === (await t.voyage()).days.flatMap(d => d.activities).length);
    } },

  { groupe: 'Dépenses', nom: "Le dernier soir, l'estimé rejoint le dépensé", depart: DERNIER_SOIR,
    intention: "Savoir ce que le voyage a coûté, quand il est fini.",
    async faire(t) {
      await t.ouvrirVoyage();
      // Repliée, la pastille ne montre que le chiffre principal : on la déplie
      // pour lire l'estimation, qui est justement ce qu'on vérifie ici.
      await t.clic('.budget-inline', { delai: 600 });
      const budget = (await t.p.locator('.budget-inline').innerText())
        .replace(/[\s ]+/g, ' ');
      const lire = (re) => {
        const m = budget.match(re);
        return m ? Number(m[1].replace(/[\s ]/g, '')) : null;
      };
      const estime = lire(/(\d[\d ]*) € estimé/);
      const restant = lire(/(\d[\d ]*) € restants/);

      // Dépensé = 20 € (musée fait) + 40 € (dépense du dîner) = 60 €.
      // N'ont RIEN à y faire : la Réserve (300 €), l'activité annulée (90 €),
      // et le prix prévu du dîner déjà réglé par une dépense (40 € de plus).
      t.verifier('le voyage est fini : estimé = dépensé = 60 €', estime === 60, budget);
      t.verifier('il reste 440 € sur les 500 € du budget', restant === 440, budget);
      t.verifier("la Réserve n'entre pas dans le budget", estime !== 360 && estime !== 260);
      t.verifier("l'activité annulée n'entre pas", estime !== 150);
      t.verifier("l'activité réglée n'est pas comptée deux fois", estime !== 100);
    } },

  { groupe: 'Dépenses', nom: "Glisser une dépense la supprime sans changer d'onglet", depart: 'voyage',
    intention: "Supprimer d'un geste — et rester là où on était.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      const avant = (await t.voyage()).expenses.length;
      if (!avant) t.injouable('aucune dépense à glisser');
      // Le glissement part du bord droit, là où le pouce le commence. C'est
      // précisément ce départ-là qui armait AUSSI la navigation entre onglets :
      // la dépense partait, et l'app basculait sur la Carte.
      const apres = await t.p.evaluate(async () => {
        const cible = document.querySelector('.expense-item-swipe')?.lastElementChild;
        if (!cible) return null;
        const b = cible.getBoundingClientRect();
        const x0 = b.left + b.width - 20, y = b.top + b.height / 2;
        const doigt = (x) => new Touch({ identifier: 1, target: cible, clientX: x, clientY: y });
        const env = (type, x) => cible.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: type === 'touchend' ? [] : [doigt(x)],
          targetTouches: type === 'touchend' ? [] : [doigt(x)],
          changedTouches: [doigt(x)],
        }));
        env('touchstart', x0);
        for (let i = 1; i <= 8; i++) { env('touchmove', x0 - (110 * i) / 8); await new Promise(r => setTimeout(r, 16)); }
        env('touchend', x0 - 110);
        // Le clic de synthèse qu'un navigateur envoie après le relâchement.
        cible.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 500));
        return { onglet: document.querySelector('.tab-btn--active')?.textContent || '',
          fiche: document.querySelectorAll('.expense-form').length };
      });
      if (!apres) t.injouable('aucune ligne glissable');
      t.verifier('la dépense est supprimée',
        (await t.voyage()).expenses.length === avant - 1,
        `${avant} → ${(await t.voyage()).expenses.length}`);
      t.verifier("on reste sur l'onglet Dépenses", /Dépenses/.test(apres.onglet), apres.onglet.trim());
      t.verifier("le glissement n'ouvre pas la fiche derrière", apres.fiche === 0);
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
      // Le crayon et la corbeille ont quitté chaque ligne : la ligne EST le
      // bouton, et supprimer vit dans la fiche qu'on vient d'ouvrir.
      if (!(await t.clic('.expense-item--ouvrable', { delai: 700, obligatoire: false })))
        t.injouable('aucune dépense modifiable');
      const montant = t.p.locator('input[type="number"]').first();
      await montant.fill('99');
      await t.clic('button', { texte: /Enregistrer|Ajouter|✅/, delai: 900 });
      const modifiee = (await t.voyage()).expenses.some(e => Number(e.amount) === 99);
      t.verifier('la modification est enregistrée', modifiee);
      await t.clic('.expense-item--ouvrable', { delai: 700, obligatoire: false });
      await t.clic('.expense-form__supprimer', { delai: 800, obligatoire: false });
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
      for (const [nom, re] of [['Planning', /Planning/i],
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
      // Sur la frise, le signal est un glyphe dans la rangée d'état du jour :
      // il porte son message en `aria-label`, pas en texte visible — on ne va
      // pas écrire « journée surchargée » en toutes lettres sur chaque carte.
      const surLaFrise = await t.p.locator('.tl-day__souci').count()
        || /surcharg/i.test(await t.texte());
      await t.ouvrirLeJour();
      const dansLeJour = /surcharg/i.test(await t.texte());
      t.verifier('la surcharge se voit sans ouvrir le jour', !!surLaFrise,
        surLaFrise ? 'signalée sur la carte du jour' : 'absente de la frise');
      t.verifier('et le détail dit pourquoi', dansLeJour);
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

      // Le pop-up d'abord : c'est la forme que le produit impose (« force de
      // proposition, uniquement en pop-up »).
      t.verifier('un pop-up de proposition apparaît', await t.visible('.sheet--proposition'));
      const ecran = (await t.p.evaluate(() =>
        document.querySelector('.sheet--proposition')?.innerText || document.body.innerText))
        .replace(/\n/g, ' · ');
      const signale = {
        ferme: /ferm[ée]/i.test(ecran),
        temps: /finirait|ne rentre pas|d[ée]passe|trop long/i.test(ecran),
        loin: /\d+\s*km|loin|éloign/i.test(ecran),
      };
      const dits = Object.entries(signale).filter(([, v]) => v).map(([k]) => k);
      if (!dits.length)
        t.friction("rien n'est signalé alors que les trois signaux sont réunis",
          'lieu fermé toute la semaine · 40 km du reste du programme · journée déjà à 10 h — '
          + "l'utilisateur doit vérifier lui-même, ce que le produit existe pour éviter");
      else if (dits.length < 3)
        t.friction(`seuls ${dits.join(' et ')} sont signalés`, `manquent : ${['ferme','temps','loin'].filter(k => !signale[k]).join(', ')}`);
      else t.verifier('les trois signaux sont donnés', true, ecran.slice(0, 120));

      // Et il doit rester possible de revenir en arrière depuis le pop-up.
      t.verifier("le pop-up propose d'annuler l'ajout",
        await t.p.evaluate(() => [...document.querySelectorAll('.sheet--proposition button')]
          .some(b => /annuler/i.test(b.innerText))));
    } },

  // ── Troisième vague : ce qui passe par le réseau ──────────────────────────
  // Chaque parcours déclare son plan : `ok` pour la réponse de référence, ou le
  // nom d'une panne. Ce que ces parcours vérifient n'est PAS que le service
  // marche — c'est que l'app en fait quelque chose de juste, panne comprise.

  { groupe: 'Réseau', nom: 'Importer un lieu depuis un lien', depart: 'voyage',
    reseau: { extractPlace: 'ok' },
    intention: "Coller un lien et récupérer le nom, l'adresse et les coordonnées.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]', 'https://maps.app.goo.gl/abc123');
      await t.clic('.import-row button', { delai: 2200, obligatoire: false });
      // Les champs remplis vivent derrière le pli « Détails » : on l'ouvre pour
      // les lire, exactement comme on le ferait à la main pour vérifier.
      await t.ouvrirDetails();
      const rempli = await t.p.evaluate(() => {
        const q = (s) => document.querySelector(s)?.value || '';
        return { titre: q('input[placeholder*="Déjeuner au marché"]'), adresse: q('input[placeholder="Lieu"]') };
      });
      t.verifier("le service d'extraction a bien été appelé", (t.appels().extractPlace || 0) > 0,
        JSON.stringify(t.appels()));
      t.verifier("le titre est rempli tout seul", /Central/i.test(rempli.titre), rempli.titre || '(vide)');
      t.verifier("l'adresse est remplie tout seule", rempli.adresse.length > 5, rempli.adresse || '(vide)');
    } },

  { groupe: 'Réseau', nom: "Un lien qui échoue le dit et ne perd rien", depart: 'voyage',
    reseau: { extractPlace: 'err500' },
    intention: "Le service tombe : l'app doit le dire et laisser saisir à la main.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]', 'https://maps.app.goo.gl/casse');
      await t.clic('.import-row button', { delai: 2600, obligatoire: false });
      const etat = await t.p.evaluate(() => ({
        message: document.querySelector('.import-msg, .form-error')?.innerText?.trim() || '',
        // Un bouton resté « en cours » laisse croire que ça travaille encore.
        occupe: [...document.querySelectorAll('.import-row button')]
          .some(b => b.disabled || /\.\.\.|…|Recherche|Chargement/i.test(b.innerText)),
        saisieGardee: (document.querySelector('input[placeholder*="colle un lien"]')?.value || '').length > 0,
      }));
      t.verifier("l'échec est dit à l'écran", etat.message.length > 3, etat.message || '(rien)');
      t.verifier("rien ne reste bloqué en « chargement »", !etat.occupe);
      t.verifier('la saisie n\'est pas effacée', etat.saisieGardee);
      // Et il doit rester possible de finir à la main.
      await t.ouvrirDetails();
      await t.saisir('input[placeholder*="Déjeuner au marché"]', 'Café Central');
      await t.clic('.btn--primary.btn--full', { delai: 1400 });
      t.verifier("l'ajout manuel reste possible",
        (await t.voyage()).reserve.some(a => a?.title === 'Café Central'));
    } },

  { groupe: 'Réseau', nom: 'Compléter une fiche : proposé, jamais appliqué seul', depart: 'voyage',
    reseau: { enrichPlace: 'ok' },
    intention: "L'agent trouve des informations et demande confirmation.",
    async faire(t) {
      await t.ouvrirVoyage();
      const avant = JSON.stringify(await t.voyage());
      await t.menu(/Compléter les fiches/);
      await t.p.waitForTimeout(3500);
      t.verifier('le service a été interrogé', (t.appels().enrichPlace || 0) > 0,
        `${t.appels().enrichPlace || 0} appels`);
      const popup = await t.visible('.sheet--check, .enrich-photo, .check-card');
      t.verifier('une confirmation est proposée', popup);
      t.verifier("rien n'a été écrit sans accord", JSON.stringify(await t.voyage()) === avant);
      if (!popup) return;
      const texte = await t.texte();
      t.verifier('les informations trouvées sont montrées',
        /horaires|prix|description/i.test(texte));
      await t.clic('button', { texte: /Tout ajouter|Ajouter/, delai: 1400, obligatoire: false });
      const apres = await t.voyage();
      const enrichies = [...apres.days.flatMap(d => d.activities), ...apres.reserve]
        .filter(a => a?.enrichAt).length;
      t.verifier('après accord, les fiches sont complétées', enrichies > 0, `${enrichies} fiches`);
    } },

  { groupe: 'Réseau', nom: "Compléter sans rien trouver ne redemandera pas", depart: 'voyage',
    reseau: { enrichPlace: 'vide' },
    intention: "Rien trouvé n'est pas une panne : on l'a cherché, on s'en souvient.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Compléter les fiches/);
      await t.p.waitForTimeout(3500);
      const v = await t.voyage();
      const marquees = [...v.days.flatMap(d => d.activities), ...v.reserve].filter(a => a?.enrichAt).length;
      t.verifier('les fiches fouillées sont marquées', marquees > 0, `${marquees} fiches`);
      t.verifier("aucun pop-up vide n'apparaît", !(await t.visible('.check-card')));
      // Et le second passage ne doit plus rien coûter.
      const appelsUn = t.appels().enrichPlace || 0;
      await t.menu(/Compléter les fiches/);
      await t.p.waitForTimeout(2500);
      const appelsDeux = t.appels().enrichPlace || 0;
      t.verifier('le second passage ne redépense rien', appelsDeux === appelsUn,
        `${appelsUn} puis ${appelsDeux}`);
    } },

  { groupe: 'Réseau', nom: "Compléter hors ligne ne marque rien", depart: 'voyage',
    reseau: { enrichPlace: 'coupe' },
    intention: "Réseau coupé : ce n'est pas « rien trouvé », c'est « pas maintenant ».",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Compléter les fiches/);
      await t.p.waitForTimeout(3500);
      const v = await t.voyage();
      const marquees = [...v.days.flatMap(d => d.activities), ...v.reserve].filter(a => a?.enrichAt).length;
      // Marquer ici ferait renoncer définitivement à des fiches qu'on n'a
      // jamais pu chercher.
      t.verifier('aucune fiche n\'est marquée comme fouillée', marquees === 0, `${marquees} fiches`);
      t.verifier("l'app ne tombe pas", !(await t.visible('.error-screen')));
    } },

  { groupe: 'Réseau', nom: 'La météo apparaît sur les jours', depart: 'voyage',
    reseau: { meteo: 'ok' },
    intention: "Savoir s'il pleuvra jeudi sans quitter le planning.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      await t.p.waitForTimeout(2200);
      t.verifier('le service météo a été appelé', (t.appels().meteo || 0) > 0);
      const vue = await t.p.evaluate(() => document.querySelector('.tab-content')?.innerText || '');
      t.verifier('une température est affichée', /\d+\s*°/.test(vue),
        (vue.match(/[^\n]*\d+\s*°[^\n]*/) || ['(aucune)'])[0].slice(0, 50));
    } },

  { groupe: 'Réseau', nom: 'Météo indisponible : rien ne casse, rien ne ment', depart: 'voyage',
    reseau: { meteo: 'err500' },
    intention: "Le service tombe : pas d'écran cassé, et surtout pas de fausse météo.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      await t.p.waitForTimeout(2200);
      t.verifier("l'app ne tombe pas", !(await t.visible('.error-screen')));
      const vue = await t.p.evaluate(() => document.querySelector('.tab-content')?.innerText || '');
      t.verifier('aucune température inventée', !/\d+\s*°/.test(vue),
        (vue.match(/[^\n]*\d+\s*°[^\n]*/) || ['(aucune, correct)'])[0].slice(0, 50));
      t.verifier('le planning reste utilisable', (await t.combien('.tl-day')) > 0);
    } },

  { groupe: 'Réseau', nom: 'Une réponse mal formée ne casse pas l\'app', depart: 'voyage',
    reseau: { meteo: 'malforme', nominatim: 'malforme', enrichPlace: 'malforme' },
    intention: "Un service qui répond 200 avec du JSON tronqué est le pire cas.",
    async faire(t) {
      await t.ouvrirVoyage();
      for (const re of [/Planning/i, /Réserve/i, /Carte/i, /Dépenses/i]) {
        await t.onglet(re, { facultatif: true });
        await t.p.waitForTimeout(600);
        if (await t.visible('.error-screen')) {
          t.verifier("l'app tient face à une réponse tronquée", false, `écran de secours sur ${re}`);
          return;
        }
      }
      t.verifier("l'app tient face à une réponse tronquée", true);
      await t.menu(/Compléter les fiches/);
      await t.p.waitForTimeout(2500);
      t.verifier("l'enrichissement encaisse aussi", !(await t.visible('.error-screen')));
    } },

  { groupe: 'Réseau', nom: 'Les taux de change alimentent les dépenses', depart: 'voyage',
    reseau: { taux: 'ok' },
    intention: "Payer en francs suisses et voir le total en euros.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.p.waitForTimeout(1800);
      await t.clic('.expenses-add-top', { delai: 800 });
      const devises = await t.p.evaluate(() => [...document.querySelectorAll('select')]
        .flatMap(s => [...s.options].map(o => o.value))
        .filter(v => /^[A-Z]{3}$/.test(v)));
      t.verifier('plusieurs devises sont proposées', new Set(devises).size > 1,
        [...new Set(devises)].slice(0, 6).join(', ') || '(aucune)');
      t.verifier('le service de taux a été appelé', (t.appels().taux || 0) > 0);
    } },

  { groupe: 'Réseau', nom: 'Taux indisponibles : la dépense reste saisissable', depart: 'voyage',
    reseau: { taux: 'coupe' },
    intention: "Sans taux, on doit quand même pouvoir noter ce qu'on a payé.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.clic('.expenses-add-top', { delai: 900 });
      await t.saisir('input.form-input:not([type="number"])', 'Taxi');
      await t.p.locator('input[type="number"]').first().fill('18');
      await t.clic('button', { texte: /Ajouter|Enregistrer|✅/, delai: 1200 });
      t.verifier('la dépense est enregistrée malgré tout',
        (await t.voyage()).expenses.some(e => e.description === 'Taxi'));
      t.verifier("l'app ne tombe pas", !(await t.visible('.error-screen')));
    } },

  { groupe: 'Réseau', nom: 'Vérifier les lieux avec un géocodeur qui répond', depart: 'voyage',
    reseau: { nominatim: 'ok' },
    intention: "Repérer un lieu mal situé avant de partir.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Vérifier les lieux/);
      await t.p.waitForTimeout(3000);
      t.verifier('la vérification s\'ouvre', await t.visible('.sheet'));
      const txt = await t.texte();
      t.verifier('elle rend un verdict lisible', txt.length > 60);
      // Le point dur déjà vécu : un lieu signalé puis abandonné sans un mot.
      t.verifier("aucun lieu n'est laissé sans réponse",
        !/undefined|null|NaN/.test(txt), (txt.match(/undefined|null|NaN/) || [''])[0]);
    } },

  { groupe: 'Réseau', nom: 'Géocodeur en panne : la vérification le dit', depart: 'voyage',
    reseau: { nominatim: 'err429' },
    intention: "Nominatim limite à une requête par seconde et répond alors du HTML.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Vérifier les lieux/);
      await t.p.waitForTimeout(3000);
      t.verifier("l'app ne tombe pas", !(await t.visible('.error-screen')));
      const txt = await t.texte();
      t.verifier('aucune correction inventée', !/Corriger|Remplacer/i.test(txt)
        || /impossible|indisponible|réessay|plus tard/i.test(txt),
        txt.slice(0, 100).replace(/\n/g, ' · '));
    } },

  { groupe: 'Propositions', nom: 'Un jour férié est signalé', depart: JOUR_FERIE,
    reseau: { feries: 'ok', nominatim: 'ok' },
    intention: "Poser une visite un 15 août sans savoir que tout ferme.",
    async faire(t) {
      await t.ouvrirVoyage();
      // Le calendrier se charge après le géocodage de la destination.
      await t.p.waitForTimeout(2600);
      await t.onglet(/Réserve/i);
      await t.clic('.reserve-assign__toggle', { delai: 700 });
      await t.clic('.reserve-assign__day', { delai: 1600 });
      t.verifier('le calendrier a été consulté', (t.appels().feries || 0) > 0,
        `${t.appels().feries || 0} appels`);
      const popup = await t.p.evaluate(() =>
        document.querySelector('.sheet--proposition')?.innerText || '');
      t.verifier('le jour férié est signalé', /f[ée]ri[ée]/i.test(popup),
        popup.replace(/\n/g, ' · ').slice(0, 110) || '(aucun pop-up)');
      t.verifier('son nom local est donné', /Himmelfahrt|Assumption|Assomption/i.test(popup));
    } },

  { groupe: 'Propositions', nom: 'Le calendrier reste dispo hors ligne', depart: JOUR_FERIE,
    reseau: { feries: 'ok', nominatim: 'ok' },
    intention: "Sur place, sans réseau, le signal doit encore fonctionner.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.p.waitForTimeout(2600);
      const enCache = await t.p.evaluate(() => {
        try { return Object.keys(JSON.parse(localStorage.getItem('provo_feries') || '{}')).length; }
        catch { return 0; }
      });
      // Mis en cache pendant qu'on avait du réseau : c'est ce qui le rend
      // utilisable là où on n'en a plus.
      t.verifier('le calendrier est mis en cache', enCache > 0, `${enCache} entrées`);
      const dates = await t.p.evaluate(() => {
        const c = JSON.parse(localStorage.getItem('provo_feries') || '{}');
        return Object.values(c).flatMap(o => Object.keys(o));
      });
      t.verifier('les dates sont bien celles du pays visité', dates.some(d => /-08-15$/.test(d)),
        dates.slice(0, 4).join(', '));
      // Une fête régionale ne ferme pas le pays : l'annoncer partout serait faux.
      t.verifier('les fêtes régionales sont écartées', !dates.some(d => /-11-15$/.test(d)),
        dates.join(', '));
    } },

  { groupe: 'Réserve', nom: "Un raccourci iOS transmet la légende, pas le lien", depart: 'voyage',
    reseau: { legende: 'ok' },
    intention: "Sur iPhone, aucune requête faite depuis l'app n'obtient la page d'un "
      + "réseau social. Un raccourci va la chercher en natif et nous passe le texte.",
    async faire(t) {
      // Le texte tel qu'un raccourci le capture : brut, échappements compris.
      // C'est ce qui arrive vraiment, pas une version déjà propre.
      const legende = 'Le meilleur barbecue cor\\u00e9en de Vienne \\ud83d\\udd25 viande grill\\u00e9e '
        + 'devant toi et banchan \\u00e0 volont\\u00e9, pense \\u00e0 r\\u00e9server le week-end #vienne #coreen #bbq';
      await t.p.goto(`${URL_BASE}/?texte=${encodeURIComponent(legende)}`,
        { waitUntil: 'domcontentloaded' });
      await t.p.waitForTimeout(1400);
      t.verifier("l'accueil annonce ce qui est arrivé", /re[çc]u/i.test(await t.texte()));

      await t.clic('.import-banner button', { texte: /Ajouter/, delai: 1200, obligatoire: false })
        || await t.ouvrirVoyage();
      await t.p.waitForTimeout(2600);
      // Le texte doit partir au lecteur de légendes, pas au géocodeur : c'est
      // la différence entre « une fiche remplie » et « aucun lieu trouvé ».
      t.verifier('la légende part au lecteur, sans appui sur un bouton',
        (t.appels().legende || 0) > 0, `${t.appels().legende || 0} appels`);
      await t.ouvrirDetails();
      const titre = await t.p.evaluate(() =>
        document.querySelector('input[placeholder*="Déjeuner au marché"]')?.value || '');
      t.verifier('le nom du lieu est extrait', /Deoun/i.test(titre), titre || '(vide)');
      // Les échappements du raccourci ne doivent pas finir dans la fiche.
      const notes = await t.p.evaluate(() =>
        document.querySelector('textarea')?.value || '');
      t.verifier('la légende est décodée, pas brute', !/\\u00|\\ud8/.test(notes),
        notes.slice(0, 60) || '(vide)');
    } },

  { groupe: 'Réserve', nom: 'Un lien partagé remplit la Réserve', depart: 'voyage',
    reseau: { extractPlace: 'ok' },
    intention: "Recevoir un lien d'Instagram ou TikTok et le ranger sans rien saisir.",
    async faire(t) {
      // Ce que le menu Partager d'Android envoie, et ce que le raccourci iOS
      // reproduit : l'app s'ouvre avec le lien dans l'URL.
      await t.p.goto(`${URL_BASE}/?texte=${encodeURIComponent('Ce café à Vienne 😍 https://maps.app.goo.gl/xyz')}`,
        { waitUntil: 'domcontentloaded' });
      await t.p.waitForTimeout(1400);
      const banniere = await t.texte();
      t.verifier("l'accueil annonce le lien reçu", /lien re[çc]u/i.test(banniere),
        (banniere.match(/[^\n]*lien re[çc]u[^\n]*/i) || ['(rien)'])[0].slice(0, 70));
      // Pas de téléportation : c'est un choix, pas une surprise.
      t.verifier("aucun voyage n'est ouvert d'office", !(await t.visible('.trip-view')));

      await t.clic('.import-banner button', { texte: /Ajouter/, delai: 1200, obligatoire: false })
        || await t.ouvrirVoyage();
      await t.p.waitForTimeout(2600);
      t.verifier("le service d'extraction est appelé tout seul", (t.appels().extractPlace || 0) > 0,
        `${t.appels().extractPlace || 0} appels`);
      // Les champs remplis vivent derrière le pli « Détails » : on l'ouvre pour
      // les lire, exactement comme on le ferait à la main pour vérifier.
      await t.ouvrirDetails();
      const rempli = await t.p.evaluate(() => {
        const q = (s) => document.querySelector(s)?.value || '';
        return { titre: q('input[placeholder*="Déjeuner au marché"]'), adresse: q('input[placeholder="Lieu"]') };
      });
      t.verifier('la feuille est ouverte et préremplie', /Central/i.test(rempli.titre),
        rempli.titre || '(vide)');
      t.verifier("l'adresse aussi", rempli.adresse.length > 5, rempli.adresse || '(vide)');
      await t.clic('.btn--primary.btn--full', { delai: 1400 });
      t.verifier("l'idée rejoint la Réserve",
        (await t.voyage()).reserve.some(a => /Central/i.test(a?.title || '')));
    } },

  { groupe: 'Réserve', nom: 'Coller un lien depuis le presse-papier', depart: 'voyage',
    reseau: { extractPlace: 'ok' },
    intention: "Sur iPhone, le menu Partager ne peut pas viser une app web : coller doit marcher.",
    async faire(t) {
      await t.p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await t.p.evaluate(() => navigator.clipboard.writeText('https://maps.app.goo.gl/abc'));
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      t.verifier('le bouton « Coller un lien » est là', await t.visible('.reserve-search-coller'));
      await t.clic('.reserve-search-coller', { delai: 2600 });
      await t.ouvrirDetails();
      const titre = await t.p.evaluate(() =>
        document.querySelector('input[placeholder*="Déjeuner au marché"]')?.value || '');
      t.verifier('le lien collé est cherché tout seul', /Central/i.test(titre), titre || '(vide)');
    } },

  { groupe: 'Réserve', nom: "Un lien qui cite plusieurs lieux les propose tous", depart: 'voyage',
    reseau: { extractPlace: 'plusieurs' },
    intention: "Une vidéo « 4 spots à Vienne » ne doit pas n'en donner qu'un.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Réserve/i);
      const avant = (await t.voyage()).reserve.length;
      await t.clic('.header__add-btn', { delai: 900 });
      await t.saisir('input[placeholder*="colle un lien"]', 'https://www.tiktok.com/@x/video/1');
      await t.clic('.import-row button', { delai: 2600, obligatoire: false });

      t.verifier('les autres lieux sont proposés', await t.visible('.autres-lieux'));
      const noms = await t.p.evaluate(() =>
        [...document.querySelectorAll('.autres-lieux__nom')].map(n => n.textContent.trim()));
      t.verifier('les trois autres sont listés', noms.length === 3, noms.join(' · ') || '(aucun)');
      // Cochés d'avance : décocher est plus rapide que cocher trois fois.
      const coches = await t.p.evaluate(() =>
        document.querySelectorAll('.autres-lieux__item--on').length);
      t.verifier('ils sont retenus par défaut', coches === 3, `${coches} sur ${noms.length}`);

      // On en écarte un : le compte doit suivre.
      await t.clic('.autres-lieux__item', { delai: 400 });
      const libelle = await t.p.evaluate(() =>
        document.querySelector('.autres-lieux__valider')?.innerText || '');
      t.verifier('le bouton compte ce qui reste coché', /2/.test(libelle), libelle);

      await t.clic('.autres-lieux__valider', { delai: 1400 });
      const apres = (await t.voyage()).reserve;
      t.verifier('les lieux retenus rejoignent la Réserve',
        apres.length === avant + 2, `${avant} → ${apres.length}`);
      // Le premier de la liste a été décoché : il ne doit pas être là, et les
      // deux autres doivent y être.
      const titres = apres.map(a => a?.title || '');
      t.verifier('celui qu\'on a décoché est resté dehors',
        !titres.some(x => /Schwarzen Kameel/i.test(x)), titres.slice(-3).join(', '));
      t.verifier('les deux autres sont bien arrivés',
        titres.some(x => /Sperl/i.test(x)) && titres.some(x => /Volksgarten/i.test(x)),
        titres.slice(-3).join(', '));
    } },

  { groupe: 'Propositions', nom: "« Que faire maintenant ? » ne propose que ce qui tient", depart: CRENEAU,
    reseau: { meteo: 'ok', nominatim: 'ok' },
    geo: { latitude: 48.2044, longitude: 16.3690 },
    intention: "Debout dans la rue, deux heures devant soi : ne pas relire trente fiches.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.p.waitForTimeout(1200);
      await t.menu(/Que faire maintenant/);
      t.verifier('la feuille s\'ouvre', await t.visible('.sheet--pioche'));
      const titres = await t.p.evaluate(() =>
        [...document.querySelectorAll('.pioche__titre')].map(n => n.textContent.trim()));
      // Ce qui doit être écarté, et pourquoi.
      t.verifier('le lieu fermé est écarté', !titres.includes('Musée fermé'), titres.join(' · '));
      t.verifier('le lieu à 80 km est écarté', !titres.includes('Abbaye de Melk'), titres.join(' · '));
      t.verifier('la randonnée de 9 h est écartée',
        !titres.some(x => /Kahlenberg/.test(x)), titres.join(' · '));
      t.verifier('ce qui a été écarté est dit',
        /écart/i.test(await t.p.evaluate(() => document.querySelector('.sheet--pioche')?.innerText || '')));

      // En fin de journée il ne reste légitimement plus rien qui tienne dans le
      // temps disponible : c'est la bonne réponse, pas une panne. Le parcours
      // tourne à toute heure, il doit donc distinguer les deux.
      if (!titres.length) {
        t.verifier('quand rien ne tient, la feuille le dit',
          /rien|plus de temps|aucune/i.test(
            await t.p.evaluate(() => document.querySelector('.sheet--pioche')?.innerText || '')));
        return;
      }

      // Et piocher depuis la feuille doit poser l'idée dans la journée.
      const avant = (await t.voyage()).days[0].activities.length;
      await t.clic('.pioche__item', { delai: 1600 });
      const apres = (await t.voyage()).days[0].activities.length;
      t.verifier('piocher depuis la feuille pose l\'idée', apres === avant + 1, `${avant} → ${apres}`);
    } },

  { groupe: 'Dépenses', nom: 'Photographier le ticket remplit la dépense', depart: 'voyage',
    reseau: { recu: 'ok' },
    intention: "Le montant est écrit sur le papier qu'on tient : le retaper est un calcul de trop.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.clic('.expenses-add-top', { delai: 800 });
      t.verifier('la photo du ticket est proposée', await t.visible('.recu__btn'));

      // Une photo quelconque : c'est le service qui lit, pas le parcours.
      await t.p.setInputFiles('.recu input[type="file"]', {
        name: 'ticket.jpg', mimeType: 'image/jpeg',
        buffer: Buffer.from(
          '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
          + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
          + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'),
      });
      await t.p.waitForTimeout(2600);

      t.verifier('le service de lecture a été appelé', (t.appels().recu || 0) > 0,
        `${t.appels().recu || 0} appels`);
      const champs = await t.p.evaluate(() => {
        // Le champ fichier du ticket est désormais le premier `input` du
        // formulaire : viser par position mènerait à lui.
        const desc = document.querySelector('.expense-form input.form-input[placeholder*="Resto"]');
        const num = [...document.querySelectorAll('.expense-form input')].find(i => i.type === 'number');
        return { description: desc?.value || '', montant: num?.value || '',
          message: document.querySelector('.recu__msg')?.innerText || '' };
      });
      t.verifier('le montant est repris du ticket', champs.montant === '47.8', champs.montant || '(vide)');
      t.verifier('le commerce devient la description', /Figlm/i.test(champs.description), champs.description);
      // Le voyage de référence contient déjà « Dîner Figlmüller » : c'est le
      // NOMBRE de dépenses qui doit être inchangé, pas l'absence d'un nom.
      t.verifier('rien n\'est enregistré sans relecture',
        (await t.voyage()).expenses.length === TRIP.expenses.length,
        `${TRIP.expenses.length} → ${(await t.voyage()).expenses.length}`);
      t.verifier('on demande de vérifier avant d\'enregistrer',
        /v[ée]rifie|enregistre/i.test(champs.message), champs.message.slice(0, 70));
    } },

  { groupe: 'Dépenses', nom: 'Un ticket illisible le dit et ne bloque pas', depart: 'voyage',
    reseau: { recu: 'illisible' },
    intention: "Une photo floue ne doit ni inventer un montant ni empêcher la saisie.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Dépenses/i);
      await t.clic('.expenses-add-top', { delai: 800 });
      await t.p.setInputFiles('.recu input[type="file"]', {
        name: 'flou.jpg', mimeType: 'image/jpeg',
        buffer: Buffer.from(
          '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
          + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
          + 'AAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'),
      });
      await t.p.waitForTimeout(2600);
      const champs = await t.p.evaluate(() => {
        const num = [...document.querySelectorAll('.expense-form input')].find(i => i.type === 'number');
        return { montant: num?.value || '', message: document.querySelector('.recu__msg')?.innerText || '' };
      });
      t.verifier('aucun montant inventé', champs.montant === '', champs.montant || '(vide, correct)');
      t.verifier('on le dit franchement', champs.message.length > 10, champs.message.slice(0, 70));
      // Et la saisie manuelle doit rester possible juste après.
      await t.saisir('.expense-form input.form-input:not([type="number"])', 'Taxi');
      await t.p.locator('.expense-form input[type="number"]').first().fill('22');
      await t.clic('button', { texte: /Ajouter|Enregistrer|✅/, delai: 1300 });
      t.verifier('la saisie à la main reste possible',
        (await t.voyage()).expenses.some(e => e.description === 'Taxi'));
    } },

  { groupe: 'Menu ⋯', nom: 'Le bilan montre où on est allé', depart: VECU,
    intention: "Un bilan chiffré dit ce qu'on a fait ; une carte le fait revoir.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.menu(/Bilan/);
      await t.p.waitForTimeout(2200);
      t.verifier('la carte du voyage est là', await t.visible('.recap-carte'));
      const reperes = await t.combien('.recap-carte .leaflet-interactive');
      t.verifier('elle porte les lieux visités', reperes > 0, `${reperes} repères`);
      const h = await t.p.evaluate(() =>
        Math.round(document.querySelector('.recap-carte__toile')?.getBoundingClientRect().height || 0));
      t.verifier('elle a une hauteur exploitable', h > 150, `${h} px`);
      // Ce qui n'a pas été fait ne doit pas y figurer : ce serait raconter le
      // voyage prévu, pas le voyage vécu.
      const v = await t.voyage();
      const faites = v.days.flatMap(d => d.activities).filter(a => a?.status === 'done' && a.lat).length;
      const situees = v.days.flatMap(d => d.activities).filter(a => a?.lat).length;
      // Un repère par lieu visité, plus l'anneau du point de départ et le trait
      // qui les relie : au-delà, ce serait le programme prévu qui s'afficherait.
      t.verifier('seul le vécu est dessiné',
        faites < situees && reperes === faites + 2,
        `${faites} faites sur ${situees} situées · ${reperes} repères (attendu ${faites + 2})`);
    } },

  { groupe: 'Planning', nom: "Glisser une activité d'un jour à l'autre", depart: 'voyage',
    intention: "Reporter une visite au lendemain sans passer par un menu.",
    async faire(t) {
      await t.ouvrirVoyage();
      await t.onglet(/Planning/i);
      const v0 = await t.voyage();
      const j1 = v0.days[0], j2 = v0.days[1];
      const aDeplacer = j1.activities.find(a => !a.isMeal);
      if (!aDeplacer) t.injouable('aucune activité déplaçable au jour 1');

      // Les journées défilent horizontalement : le lendemain n'est visible que
      // sur quelques pixels. Le geste consiste donc à emmener l'activité au
      // bord droit et à laisser le défilement automatique amener la cible —
      // exactement ce que fait un doigt.
      const grip = await t.p.locator(`[data-reorder-id="${aDeplacer.id}"] .tl-act-grip`).boundingBox();
      if (!grip) t.injouable('poignée introuvable');
      // Pour quitter une journée, le doigt doit dépasser SON bord — pas celui
      // du conteneur. C'est là que le défilement s'amorce.
      const bord = await t.p.evaluate(() => {
        const w = document.querySelector('.timeline-view-wrap');
        const carte = document.querySelector('.tl-day').getBoundingClientRect();
        return { x: Math.min(Math.round(carte.right + 14), innerWidth - 6),
          y: Math.round(carte.top + carte.height / 2), depart: w.scrollLeft };
      });
      await t.p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await t.p.mouse.down();
      await t.p.waitForTimeout(120);
      for (let i = 1; i <= 8; i++) {
        await t.p.mouse.move(
          grip.x + (bord.x - grip.x) * i / 8,
          grip.y + (bord.y - grip.y) * i / 8);
        await t.p.waitForTimeout(70);
      }
      // On laisse le défilement amener le jour suivant sous le doigt.
      await t.p.waitForTimeout(1400);
      const pendant = await t.p.evaluate(() => ({
        jourMarque: !!document.querySelector('.tl-day--cible'),
        defile: document.querySelector('.timeline-view-wrap').scrollLeft,
        cible: document.querySelector('.tl-day--cible')?.dataset?.dayId || null,
      }));
      await t.p.mouse.up();
      await t.p.waitForTimeout(900);

      t.verifier('la frise défile pendant le glissement', pendant.defile > bord.depart,
        `${bord.depart} → ${pendant.defile} px`);
      t.verifier('la journée visée est signalée', pendant.jourMarque, pendant.cible || '(aucune)');
      const v = await t.voyage();
      const dansJ1 = v.days[0].activities.some(a => a?.id === aDeplacer.id);
      const ailleurs = v.days.slice(1).findIndex(d => d.activities.some(a => a?.id === aDeplacer.id));
      t.verifier("l'activité a changé de jour", !dansJ1 && ailleurs >= 0,
        `jour 1 : ${dansJ1 ? 'oui' : 'non'} · arrivée jour ${ailleurs + 2}`);
      t.verifier('rien n\'est perdu au passage',
        v.days.flatMap(d => d.activities).filter(Boolean).length
          === v0.days.flatMap(d => d.activities).length,
        `${v0.days.flatMap(d => d.activities).length} → ${v.days.flatMap(d => d.activities).filter(Boolean).length}`);
      t.verifier("l'app ne tombe pas", !(await t.visible('.error-screen')));
    } },

  { groupe: 'Planning', nom: "L'onglet Aujourd'hui n'existe plus", depart: 'voyage',
    intention: "Le planning place déjà le jour J au centre.",
    async faire(t) {
      await t.ouvrirVoyage();
      const onglets = await t.p.evaluate(() =>
        [...document.querySelectorAll('.tab-btn')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
      t.verifier("l'onglet a disparu de la barre",
        !onglets.some(o => /Aujourd'hui/i.test(o)), onglets.join(' · '));
      t.verifier('la barre garde ses autres onglets', onglets.length >= 4, `${onglets.length} onglets`);
      // Et ce qu'on y faisait doit rester atteignable.
      t.verifier('« Que faire maintenant ? » reste dans le menu',
        await t.p.evaluate(async () => {
          document.querySelector('button[aria-label="Options du voyage"]')?.click();
          await new Promise(r => setTimeout(r, 400));
          return [...document.querySelectorAll('.trip-header-menu__item')]
            .some(b => /Que faire maintenant/i.test(b.innerText));
        }));
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

let choisis = PARCOURS;
if (SEUL_HORS_LIGNE) choisis = choisis.filter(x => !x.reseau);
if (SEUL_RESEAU) choisis = choisis.filter(x => x.reseau);
if (SEUL) choisis = choisis.filter(x => (x.nom + x.groupe).toLowerCase().includes(SEUL.toLowerCase()));

const navigateur = await chromium.launch({ executablePath: trouverChromium() });
const rapport = [];

for (const parcours of choisis) {
  const ctx = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true, locale: 'fr-FR',
    ...(parcours.geo ? { permissions: ['geolocation'], geolocation: parcours.geo } : {}),
  });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('pageerror', e => erreurs.push(String(e).split('\n')[0].slice(0, 180)));
  // Deux régimes, jamais mélangés dans un même parcours.
  //  · sans `reseau` : le monde extérieur est coupé net. L'app promet de
  //    marcher hors ligne — autant tenir cette promesse sous test.
  //  · avec `reseau` : chaque service est rejoué, avec la panne demandée.
  let reseau = null;
  if (parcours.reseau) reseau = await brancherReseau(p, URL_BASE, parcours.reseau);
  else await p.route('**/*', r => r.request().url().startsWith(URL_BASE) ? r.fallback() : r.abort());
  const amorce = parcours.depart === 'vierge' ? []
    : parcours.depart === 'voyage' ? [TRIP] : [parcours.depart];
  await p.addInitScript(([t, s, geo]) => {
    localStorage.setItem('provo_trips', t);
    localStorage.setItem('provo_settings', s);
    localStorage.setItem('provo_theme', 'light');
    localStorage.setItem('provo_onboarded', '1');
    if (geo) localStorage.setItem('provo_geo_active', '1');
  }, [JSON.stringify(amorce), JSON.stringify(SETTINGS), !!parcours.geo]);

  const journal = [];
  const t = outils(p, journal);
  // « Ce rouage a-t-il seulement tourné ? » — une chaîne qui n'appelle jamais
  // son service échoue en silence, et l'écran ne le dit pas.
  t.appels = () => (reseau ? reseau.appels() : {});
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
  const avecReseau = rapport.filter(r => r.reseau).length;
  console.log(`\n${avecReseau} parcours rejouent les services distants (réponses et pannes simulées).`);
  console.log('Ce qui reste hors de portée : la disponibilité réelle des services et la');
  console.log('forme actuelle de leurs réponses — voir les scripts diag-*.mjs.');
}

process.exit(rapport.some(r => r.casses) ? 1 : 0);
