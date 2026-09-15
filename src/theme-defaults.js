import bgComic from './assets/backgrounds/comic.jpg';
import bgCoin from './assets/backgrounds/coin.jpg';
import bgScifi from './assets/backgrounds/scifi.jpg';
import bgFootball from './assets/backgrounds/football.jpg';
import bgFootball2 from './assets/backgrounds/football2.jpg';
import bgCardstyle from './assets/backgrounds/cardstyle.jpg';
import bgCardstyle2 from './assets/backgrounds/cardstyle2.jpg';

// Hex-Werte der Farbthemen (für native UI-Elemente wie die Windows-Titelleiste,
// die keine CSS-Variablen lesen können).
export const COLOR_THEME_HEX = {
  indigo: '#6c8cff',
  emerald: '#34d399',
  rose: '#f472b6',
  amber: '#f5a524',
  sky: '#38bdf8',
  violet: '#a78bfa'
};

// Empfohlene (aber nicht verbindliche) Farbe pro Design-Stil.
// Wird nur angewendet, wenn der Nutzer die Auto-Kopplung nicht deaktiviert hat.
export const DESIGN_THEME_COLOR_MAP = {
  classic: 'indigo',
  comic: 'rose',
  cardstyle: 'amber',
  coin: 'amber',
  scifi: 'sky',
  football: 'emerald'
};

const overlay = 'linear-gradient(rgba(15,16,20,0.6), rgba(15,16,20,0.78))';

function imagePattern(url) {
  return {
    image: `${overlay}, url(${url})`,
    size: 'cover, cover',
    position: 'center, center',
    repeat: 'no-repeat, no-repeat'
  };
}

// Hintergrundmuster, die frei wählbar sind (oder "auto" = an den Design-Stil gekoppelt).
export const BACKGROUND_PATTERNS = {
  auto: null,
  none: { image: 'none', size: 'auto', position: '0 0', repeat: 'repeat' },
  dots: { image: 'radial-gradient(rgba(255,255,255,0.06) 1.5px, transparent 1.5px)', size: '14px 14px', position: '0 0', repeat: 'repeat' },
  glow: { image: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.05), transparent 70%)', size: 'auto', position: '0 0', repeat: 'repeat' },
  grid: { image: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 24px)', size: 'auto', position: '0 0', repeat: 'repeat' },
  pitch: { image: 'repeating-linear-gradient(100deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 40px, transparent 40px, transparent 80px)', size: 'auto', position: '0 0', repeat: 'repeat' },

  comicImg: imagePattern(bgComic),
  coinImg: imagePattern(bgCoin),
  scifiImg: imagePattern(bgScifi),
  footballImg: imagePattern(bgFootball),
  footballImg2: imagePattern(bgFootball2),
  cardstyleImg: imagePattern(bgCardstyle),
  cardstyleImg2: imagePattern(bgCardstyle2)
};

// Vorschaubild je Hintergrund-Option, für die Auswahl in den Einstellungen (optional).
export const BACKGROUND_PREVIEWS = {
  comicImg: bgComic,
  coinImg: bgCoin,
  scifiImg: bgScifi,
  footballImg: bgFootball,
  footballImg2: bgFootball2,
  cardstyleImg: bgCardstyle,
  cardstyleImg2: bgCardstyle2
};

// Empfohlener (aber nicht verbindlicher) Hintergrund pro Design-Stil, falls "auto" aktiv ist.
export const DESIGN_THEME_BACKGROUND_MAP = {
  classic: 'none',
  comic: 'comicImg',
  cardstyle: 'cardstyleImg',
  coin: 'coinImg',
  scifi: 'scifiImg',
  football: 'footballImg'
};

// Alle wählbaren Hintergrund-Optionen, unabhängig vom aktuellen Design-Stil.
export const ALL_BACKGROUND_OPTIONS = [
  'auto', 'none',
  'comicImg', 'cardstyleImg', 'cardstyleImg2', 'coinImg', 'scifiImg', 'footballImg', 'footballImg2',
  'dots', 'grid', 'glow', 'pitch'
];
