/** Splits Terraform source into its top-level blocks, keeping each block's exact original text. */
export interface SrcBlock {
  kind: string; // module | resource | data | variable | output | locals | terraform | provider | ...
  labels: string[];
  /** verbatim text, including contiguous comment lines directly above the block */
  text: string;
  /** `# canvas:node id=… type=…` marker, when present */
  marker?: { id: string; type: string };
  file: string;
}

function skipLineComment(s: string, i: number) {
  while (i < s.length && s[i] !== '\n') i++;
  return i;
}

/** i is at the opening quote; returns the index after the closing quote. */
function skipString(s: string, i: number): number {
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    if ((c === '$' || c === '%') && s[i + 1] === c && s[i + 2] === '{') { i += 3; continue; } // escaped $${ / %%{
    if ((c === '$' || c === '%') && s[i + 1] === '{') { i = skipBraces(s, i + 2); continue; }
    i++;
  }
  return i;
}

/** i is just after an opening `{`; returns the index after its matching `}`. */
function skipBraces(s: string, i: number): number {
  let depth = 1;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === '"') { i = skipString(s, i); continue; }
    if (c === '#' || (c === '/' && s[i + 1] === '/')) { i = skipLineComment(s, i); continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (c === '<' && s[i + 1] === '<') {
      const m = /^<<-?([A-Za-z_][\w]*)[ \t]*\r?\n/.exec(s.slice(i, i + 200));
      if (m) {
        const id = m[1];
        let p = i + m[0].length;
        for (;;) {
          const nl = s.indexOf('\n', p);
          const line = s.slice(p, nl < 0 ? s.length : nl);
          if (line.trim() === id) { i = nl < 0 ? s.length : nl; break; }
          if (nl < 0) { i = s.length; break; }
          p = nl + 1;
        }
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return i;
}

const MARKER = /#\s*canvas:node\s+id=(\S+)\s+type=(\S+)/;

export function splitBlocks(text: string, file = 'main.tf'): SrcBlock[] {
  const out: SrcBlock[] = [];
  let i = 0;
  let commentStart = -1; // start of the contiguous comment run directly above the next block
  let lastLineWasBlank = true;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      // a blank line ends a comment run
      const prevNl = text.lastIndexOf('\n', i - 1);
      if (text.slice(prevNl + 1, i).trim() === '') { commentStart = -1; lastLineWasBlank = true; }
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      if (commentStart < 0 || lastLineWasBlank) commentStart = i;
      lastLineWasBlank = false;
      i = skipLineComment(text, i);
      continue;
    }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; commentStart = -1; continue; }
    // block header: identifier, then labels, then {
    const m = /^[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80));
    if (!m) { i++; continue; }
    const start = i;
    const kind = m[0];
    i += kind.length;
    const labels: string[] = [];
    for (;;) {
      while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
      if (text[i] === '"') {
        const e = skipString(text, i);
        labels.push(text.slice(i + 1, e - 1));
        i = e;
      } else if (/[A-Za-z_]/.test(text[i] ?? '')) {
        const lm = /^[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80))!;
        labels.push(lm[0]);
        i += lm[0].length;
      } else break;
    }
    if (text[i] !== '{') { i = skipLineComment(text, i); continue; } // not a block (stray text)
    const end = skipBraces(text, i + 1);
    const from = commentStart >= 0 ? commentStart : start;
    const body = text.slice(from, end);
    const mm = MARKER.exec(text.slice(from, start));
    out.push({ kind, labels, text: body, file, ...(mm ? { marker: { id: mm[1], type: mm[2] } } : {}) });
    i = end;
    commentStart = -1;
    lastLineWasBlank = true;
  }
  return out;
}
