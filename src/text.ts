/**
 * LinkedIn's Posts API expects `commentary` in the "little text" format, where
 * characters like ( ) [ ] { } < > @ # | * _ ~ \ are reserved. Unescaped reserved
 * characters cause posts to be rejected or silently truncated.
 */
const RESERVED = /[\\|{}@\[\]()<>#*_~]/g;

export function escapeLittleText(text: string): string {
  return text.replace(RESERVED, (ch) => `\\${ch}`);
}

/**
 * Escapes text for the Posts API while turning `#hashtag` into real, clickable
 * LinkedIn hashtags.
 */
export function formatCommentary(text: string, { hashtags = true } = {}): string {
  if (!hashtags) return escapeLittleText(text);

  const parts: string[] = [];
  const pattern = /(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]+)/gu;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    parts.push(escapeLittleText(text.slice(last, start)));
    parts.push(`{hashtag|\\#|${match[2]}}`);
    last = start + 1 + match[2].length;
  }
  parts.push(escapeLittleText(text.slice(last)));
  return parts.join("");
}
