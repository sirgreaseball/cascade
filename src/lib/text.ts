/** OpenStreetMap names are sometimes all lower case ("danderi"); capitalise those for display. */
export function displayName(name: string): string {
  if (!name) return name;
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|[\s-])(\p{Ll})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
