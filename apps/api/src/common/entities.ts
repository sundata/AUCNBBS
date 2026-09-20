const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const decodeEntities = (s: string) =>
  s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return String.fromCodePoint(parseInt(e.slice(2), 16) || 0);
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10) || 0);
    return NAMED_ENTITIES[e] ?? m;
  });
