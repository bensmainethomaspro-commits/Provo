import { useState } from 'react';

const SLIDES = [
  {
    icon: '🧭',
    title: 'Bienvenue sur Provo',
    desc: 'Ton gestionnaire de voyages hors-ligne. Toutes tes données sont sauvegardées sur ton téléphone — pas besoin de compte.',
  },
  {
    icon: '✏️',
    title: 'Ajoute tes activités',
    desc: 'Restaurants, visites, balades... Colle un lien Google Maps pour importer automatiquement le nom, l\'adresse et les horaires.',
  },
  {
    icon: '⚡',
    title: 'Gestes rapides',
    desc: 'Double tap → marquer "Fait" · Glisse gauche → options · Appui long → actions rapides · Glisse l\'en-tête du jour pour naviguer.',
  },
  {
    icon: '🤝',
    title: 'Voyage à plusieurs',
    desc: 'Active le partage collaboratif depuis le menu ⋯ → Partager. Tes amis modifient le voyage en temps réel avec le même lien.',
  },
];

export default function OnboardingOverlay({ onDone }) {
  const [step, setStep] = useState(0);
  const isLast = step === SLIDES.length - 1;
  const slide = SLIDES[step];

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-panel">
        <button className="onboarding-skip" onClick={onDone}>Passer</button>

        <div className="onboarding-icon">{slide.icon}</div>
        <h2 className="onboarding-title">{slide.title}</h2>
        <p className="onboarding-desc">{slide.desc}</p>

        <div className="onboarding-dots">
          {SLIDES.map((_, i) => (
            <div key={i} className={`onboarding-dot${i === step ? ' onboarding-dot--active' : ''}`} />
          ))}
        </div>

        <button
          className="btn btn--primary btn--full"
          onClick={() => isLast ? onDone() : setStep(s => s + 1)}
        >
          {isLast ? 'C\'est parti !' : 'Suivant →'}
        </button>
      </div>
    </div>
  );
}
