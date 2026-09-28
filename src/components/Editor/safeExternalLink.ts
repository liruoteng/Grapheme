/** Document links may open web pages or email, never arbitrary OS protocols. */
export function safeExternalLink(value: string): string | null {
  const href = value.trim();
  if ([...href].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}
