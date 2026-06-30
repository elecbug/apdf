export function createSourceOrderStorage(clientId) {
  const storageKey = `apdf_source_order_${clientId}`;

  return {
    save(sources) {
      const sourceIds = sources.map((source) => source.source_id);
      localStorage.setItem(storageKey, JSON.stringify(sourceIds));
    },

    apply(sources) {
      const raw = localStorage.getItem(storageKey);

      if (!raw) {
        return sources;
      }

      try {
        const sourceIds = JSON.parse(raw);

        if (!Array.isArray(sourceIds)) {
          return sources;
        }

        const sourceMap = new Map(sources.map((source) => [source.source_id, source]));
        const ordered = [];
        const used = new Set();

        sourceIds.forEach((sourceId) => {
          const source = sourceMap.get(sourceId);
          if (source && !used.has(sourceId)) {
            ordered.push(source);
            used.add(sourceId);
          }
        });

        sources.forEach((source) => {
          if (!used.has(source.source_id)) {
            ordered.push(source);
          }
        });

        return ordered;
      } catch {
        return sources;
      }
    },

    clear() {
      localStorage.removeItem(storageKey);
    }
  };
}
