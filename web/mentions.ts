// Files a chat message mentions: absolute paths in its text (Windows or Mac/Linux), quoted or in
// backticks (those may have spaces), markdown links and file:// links. Web links are not files.
// The server then says which of them are really there and may be shown (POST /api/files/info).

const EXT = String.raw`\.[A-Za-z0-9]{1,8}`;
// with spaces: inside `…`, "…", '…', (…) of a markdown link, or <…>
const QUOTED = new RegExp(String.raw`[\x60"'(<]((?:[A-Za-z]:[\\/]|/)[^\x60"'<>()\r\n|*?]*?${EXT})[\x60"')>]`, 'g');
// without spaces, anywhere: C:\a\b.png, C:/a/b.png, /home/me/b.png (not the end of a web link). The last
// part is greedy, so a name with dots keeps its whole extension (archive.tar.gz).
const WIN = new RegExp(String.raw`(?<![\w/\\.])[A-Za-z]:[\\/](?:[^\s"'\x60<>|*?()\[\]\\/\r\n]+[\\/])*[^\s"'\x60<>|*?()\[\]\\/\r\n]+${EXT}(?![\w\\/])`, 'g');
const POSIX = new RegExp(String.raw`(?<![\w.:/\\~-])/(?:[^\s"'\x60<>()\[\]/\r\n]+/)*[^\s"'\x60<>()\[\]/\r\n]+${EXT}(?![\w/])`, 'g');
const FILE_URL = /file:\/\/\/?([^\s"'`<>()]+)/gi;

// Windows paths are the same file in any case and with either slash; others only as written.
const sameKey = (p: string): string => (/^[A-Za-z]:[\\/]/.test(p) ? p.replace(/\\/g, '/').toLowerCase() : p);

/** The absolute file paths a message mentions, in order, each once (at most max). */
export function findFileMentions(text: string | null | undefined, max = 12): string[] {
  const s = String(text || '');
  if (!s) return [];
  const found: { at: number; end: number; path: string }[] = [];
  const add = (at: number, end: number, p: string) => {
    const clean = p.trim().replace(/[.,;:!?]+$/, '');
    if (clean) found.push({ at, end, path: clean });
  };
  for (const m of s.matchAll(FILE_URL)) {
    let p = m[1];
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep as written */
    }
    // file:///C:/x → C:/x ; file:///home/x → /home/x
    add(m.index!, m.index! + m[0].length, /^[A-Za-z]:[\\/]/.test(p) ? p : `/${p.replace(/^\/+/, '')}`);
  }
  // what file:// links used is taken; the rest is looked at for bare paths
  const rest = s.replace(FILE_URL, (m) => ' '.repeat(m.length));
  for (const m of rest.matchAll(QUOTED)) add(m.index! + 1, m.index! + 1 + m[1].length, m[1]);
  for (const re of [WIN, POSIX]) for (const m of rest.matchAll(re)) add(m.index!, m.index! + m[0].length, m[0]);
  // quoted matches first where they start at the same place: they are the whole path (with its spaces)
  found.sort((a, b) => a.at - b.at || b.end - b.at - (a.end - a.at));
  const out: string[] = [];
  const taken: { at: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    // a piece of a mention already taken (a quoted path with spaces is also found in parts)
    if (taken.some((t) => f.at >= t.at && f.end <= t.end)) continue;
    taken.push(f);
    const key = sameKey(f.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.path);
    if (out.length >= max) break;
  }
  return out;
}
