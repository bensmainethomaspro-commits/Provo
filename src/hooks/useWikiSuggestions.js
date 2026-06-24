import { useState, useEffect } from 'react';

const cache = {};

export function useWikiSuggestions(destination, enabled = true) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = destination?.trim();
    if (!q || !enabled) return;
    if (cache[q]) { setSuggestions(cache[q]); return; }

    setLoading(true);
    // Step 1: search Wikipedia for the destination
    fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + ' tourist attractions sights')}&srlimit=6&format=json&origin=*`
    )
      .then(r => r.json())
      .then(async data => {
        const results = data?.query?.search || [];
        const items = await Promise.all(
          results.slice(0, 5).map(async r => {
            try {
              const sumRes = await fetch(
                `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.title)}`
              );
              if (!sumRes.ok) return null;
              const s = await sumRes.json();
              return {
                title: s.title,
                extract: s.extract?.slice(0, 120) || '',
                thumbnail: s.thumbnail?.source || null,
                url: s.content_urls?.desktop?.page || '',
              };
            } catch { return null; }
          })
        );
        const valid = items.filter(Boolean);
        cache[q] = valid;
        setSuggestions(valid);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [destination, enabled]);

  return { suggestions, loading };
}
