// Entreprises cibles pré-remplies au premier lancement.
// ⚠️ Les slugs ATS (greenhouse/lever/recruitee) sont des meilleures
// hypothèses : si une entreprise a changé d'ATS, le statut de collecte
// affichera une erreur dans les réglages — corrige alors le slug ou le type.
// Les grands groupes ont des ATS propriétaires impossibles à suivre
// automatiquement : ils sont en type "link" (lien de vérification manuelle
// inclus dans le digest).

export const DEFAULT_COMPANIES = [
  // Scale-ups tech FR (API ATS publiques)
  { name: 'Doctolib', source_type: 'greenhouse', slug: 'doctolib', careers_url: 'https://careers.doctolib.com' },
  { name: 'Back Market', source_type: 'greenhouse', slug: 'backmarket', careers_url: 'https://jobs.backmarket.com' },
  { name: 'Contentsquare', source_type: 'greenhouse', slug: 'contentsquare', careers_url: 'https://www.contentsquare.com/careers' },
  { name: 'Qonto', source_type: 'lever', slug: 'qonto', careers_url: 'https://qonto.com/fr/careers' },
  { name: 'Alan', source_type: 'lever', slug: 'alan', careers_url: 'https://alan.com/careers' },
  { name: 'Swile', source_type: 'lever', slug: 'swile', careers_url: 'https://www.swile.co/fr-fr/carrieres' },
  { name: 'PayFit', source_type: 'lever', slug: 'payfit', careers_url: 'https://payfit.com/careers' },
  { name: 'BlaBlaCar', source_type: 'wttj', slug: 'blablacar', careers_url: 'https://blog.blablacar.com/jobs' },

  // Grands groupes FR (ATS propriétaires → lien manuel dans le digest)
  { name: "L'Oréal", source_type: 'link', slug: null, careers_url: 'https://careers.loreal.com/fr_FR/jobs' },
  { name: 'LVMH', source_type: 'link', slug: null, careers_url: 'https://www.lvmh.fr/rejoignez-nous/nos-offres' },
  { name: 'Danone', source_type: 'link', slug: null, careers_url: 'https://careers.danone.com' },
  { name: 'BNP Paribas', source_type: 'link', slug: null, careers_url: 'https://group.bnpparibas/emploi-carriere/toutes-offres-emploi' },
  { name: 'Orange', source_type: 'link', slug: null, careers_url: 'https://orange.jobs' },
];

export const SOURCE_TYPE_LABELS = {
  greenhouse: 'Greenhouse (API publique)',
  lever: 'Lever (API publique)',
  recruitee: 'Recruitee (API publique)',
  wttj: 'Welcome to the Jungle',
  link: 'Lien manuel (ATS propriétaire)',
};

// URL de l'API JSON publique d'une entreprise, pour le bouton "Tester".
export function atsTestUrl(company) {
  switch (company.source_type) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${company.slug}?mode=json&limit=1`;
    case 'recruitee':
      return `https://${company.slug}.recruitee.com/api/offers/`;
    default:
      return null;
  }
}
