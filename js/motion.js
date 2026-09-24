// Drapeau « ce rendu suit une action de l'utilisateur ».
// Les transitions ne jouent que dans ce cas (jamais au chargement ni au changement d'onglet).
let animate = false;
export const setAnimate = (v) => (animate = !!v);
export const shouldAnimate = () => animate;
