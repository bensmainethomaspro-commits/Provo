import { useState, useEffect } from 'react';

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone
  );

  useEffect(() => {
    const handleBefore = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    const handleInstalled = () => {
      setPrompt(null);
      setIsInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', handleBefore);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBefore);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      setPrompt(null);
      setIsInstalled(true);
    }
  };

  // iOS n'implémente pas `beforeinstallprompt` : aucun bouton ne peut y
  // déclencher l'installation, et le nôtre restait donc invisible sur iPhone.
  // La seule voie est manuelle — Partager, puis « Sur l'écran d'accueil ». On
  // ne peut pas le faire à la place de l'utilisateur, mais on peut cesser de
  // faire comme si la fonction n'existait pas et lui montrer le chemin.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return {
    canInstall: !!prompt && !isInstalled,
    isInstalled,
    install,
    // Vrai sur iPhone et iPad tant que l'app n'est pas déjà sur l'écran
    // d'accueil : c'est le cas où il faut expliquer au lieu de proposer.
    needsManualInstall: isIOS && !isInstalled,
  };
}
