export function createAssemblyStorage(clientId) {
  const storageKey = `apdf_assembly_${clientId}`;

  return {
    save(assembly) {
      localStorage.setItem(storageKey, JSON.stringify(assembly));
    },

    load(sources) {
      const raw = localStorage.getItem(storageKey);

      if (!raw) {
        return [];
      }

      try {
        const loaded = JSON.parse(raw);

        if (!Array.isArray(loaded)) {
          return [];
        }

        const validSourceIds = new Set(sources.map(source => source.source_id));

        return loaded
          .filter(item => validSourceIds.has(item.source_id))
          .map(item => {
            const source = sources.find(source => source.source_id === item.source_id);
            const maxPage = source.pages;

            const start = Math.max(1, Math.min(Number.parseInt(item.start, 10) || 1, maxPage));
            const end = Math.max(start, Math.min(Number.parseInt(item.end, 10) || maxPage, maxPage));

            return {
              source_id: item.source_id,
              name: source.name,
              start,
              end
            };
          });
      } catch {
        return [];
      }
    },

    clear() {
      localStorage.removeItem(storageKey);
    }
  };
}
