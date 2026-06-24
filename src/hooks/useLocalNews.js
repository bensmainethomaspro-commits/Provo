import { useState, useEffect } from 'react';

const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

function cleanTitle(raw) {
  if (!raw) return '';
  // Google News titles are "Article title - Publication Name"
  return raw.replace(/\s+[-–]\s+[^-–]+$/, '').trim();
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Math.round((Date.now() - d) / 60000); // minutes
  if (diff < 60) return `il y a ${diff} min`;
  if (diff < 1440) return `il y a ${Math.round(diff / 60)} h`;
  return `il y a ${Math.round(diff / 1440)} j`;
}

export function useLocalNews(destination, enabled = true) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !destination?.trim()) { setNews([]); return; }

    const dest = destination.trim();
    const key = `provo_news_${dest.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;

    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached?.items?.length && Date.now() - cached.ts < CACHE_TTL) {
        setNews(cached.items);
        return;
      }
    } catch {}

    setLoading(true);
    const q = encodeURIComponent(dest);
    const rssUrl = encodeURIComponent(
      `https://news.google.com/rss/search?q=${q}&hl=fr&gl=FR&ceid=FR:fr`
    );
    fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}&count=6`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.status === 'ok' && data.items?.length) {
          const items = data.items.slice(0, 5).map(item => ({
            title: cleanTitle(item.title),
            link: item.link,
            pubDate: item.pubDate,
            relDate: relativeDate(item.pubDate),
            source: item.author || '',
            thumbnail: item.thumbnail || null,
          }));
          setNews(items);
          try { localStorage.setItem(key, JSON.stringify({ items, ts: Date.now() })); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [destination, enabled]);

  return { news, loading };
}
