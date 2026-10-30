export function createSourceOrderStorage(clientId) {
  const storageKey = `apdf_source_order_${clientId}`;

  return {
    save(sources) {
      const sourceIds = sources.map((source) => source.source_id);
      try {
        localStorage.setItem(storageKey, JSON.stringify(sourceIds));
      } catch {
        // Source editing still works when browser storage is unavailable.
      }
    },

    apply(sources) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
          return sources;
        }
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
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // There is no persisted order to clear when storage is unavailable.
      }
    }
  };
}
