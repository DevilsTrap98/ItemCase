import React, { useMemo } from 'react';
import { useI18n } from './i18n.jsx';
import quotesRaw from './assets/quotes.txt?raw';

function parseQuotes(raw) {
  return raw
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const sepIndex = line.lastIndexOf(' — ');
      if (sepIndex === -1) return { text: line, source: '' };
      return {
        text: line.slice(0, sepIndex).trim(),
        source: line.slice(sepIndex + 3).trim()
      };
    });
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function QuoteOfTheDay() {
  const { t } = useI18n();
  const quote = useMemo(() => {
    const quotes = parseQuotes(quotesRaw);
    if (quotes.length === 0) return null;
    const index = dayOfYear() % quotes.length;
    return quotes[index];
  }, []);

  if (!quote) return null;

  return (
    <div className="quote-of-the-day">
      <div className="quote-title">{t('quote.title')}</div>
      <span className="quote-text">{quote.text}</span>
      {quote.source && <span className="quote-source">— {quote.source}</span>}
    </div>
  );
}
