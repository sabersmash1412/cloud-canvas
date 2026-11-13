import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Copy } from 'lucide-react';
import type { CompileResult } from '@cloudcanvas/compiler';
import { useStore } from '../store';

type Ed = Parameters<OnMount>[0];
const OPTS = { readOnly: true, minimap: { enabled: false }, fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace', lineNumbersMinChars: 3, scrollBeyondLastLine: false, padding: { top: 10 }, renderLineHighlight: 'none' as const, overviewRulerLanes: 0, smoothScrolling: true, glyphMargin: true, folding: false };

/** All generated files. Clicking a block (or its gear) selects the matching node on the canvas. */
export function CodeView({ result, onSelect }: { result: CompileResult; onSelect: (id: string) => void }) {
  const [file, setFile] = useState('main.tf');
  const dark = useStore((s) => s.dark);
  const selected = useStore((s) => s.selected);
  const ed = useRef<Ed | null>(null);
  const deco = useRef<string[]>([]);
  const f = result.files.find((x) => x.path === file) ?? result.files[0];
  const blocksRef = useRef(result.blocks);
  blocksRef.current = result.blocks;
  const fileRef = useRef(file);
  fileRef.current = file;

  const decorate = () => {
    const e = ed.current;
    if (!e) return;
    const out: Parameters<Ed['deltaDecorations']>[1] = [];
    if (file === 'main.tf') {
      // gear on the first line of each distinct block (subnets share their VPC's block)
      const seen = new Set<number>();
      for (const b of result.blocks) if (!seen.has(b.startLine)) { seen.add(b.startLine); out.push({ range: { startLineNumber: b.startLine, startColumn: 1, endLineNumber: b.startLine, endColumn: 1 }, options: { glyphMarginClassName: 'cc-gear', glyphMarginHoverMessage: { value: 'Select on canvas' } } }); }
      const b = result.blocks.find((x) => x.nodeId === selected);
      if (b) out.push({ range: { startLineNumber: b.startLine, startColumn: 1, endLineNumber: b.endLine, endColumn: 1 }, options: { isWholeLine: true, className: 'cc-hl', linesDecorationsClassName: 'cc-hl-gutter' } });
    }
    deco.current = e.deltaDecorations(deco.current, out);
  };

  useEffect(() => {
    decorate();
    const e = ed.current;
    const b = result.blocks.find((x) => x.nodeId === selected);
    if (e && b && file === 'main.tf') e.revealRangeInCenterIfOutsideViewport({ startLineNumber: b.startLine, startColumn: 1, endLineNumber: b.endLine, endColumn: 1 }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, result, file]);

  const onMount: OnMount = (e) => {
    ed.current = e;
    decorate();
    e.onMouseDown((ev) => {
      const line = ev.target.position?.lineNumber;
      if (!line || fileRef.current !== 'main.tf') return;
      const hit = blocksRef.current.find((b) => line >= b.startLine && line <= b.endLine && !b.nodeId.includes('-')) ?? blocksRef.current.find((b) => line >= b.startLine && line <= b.endLine);
      if (hit) onSelect(hit.nodeId);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
        {result.files.map((x) => <button key={x.path} onClick={() => setFile(x.path)} className={`tabbtn mono ${x.path === f.path ? 'on' : ''}`} style={{ fontSize: 11.5 }}>{x.path}</button>)}
        <div style={{ flex: 1 }} />
        <button className="btn icon" style={{ border: 0 }} title="Copy" onClick={() => navigator.clipboard.writeText(f.content)}><Copy size={14} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }} data-testid="code-all">
        <Editor language={f.language === 'hcl' ? 'ini' : f.language} path={f.path} value={f.content} theme={dark ? 'vs-dark' : 'light'} onMount={onMount} options={OPTS} />
      </div>
    </div>
  );
}

/** Just the Terraform for one node. */
export function NodeCode({ text }: { text: string }) {
  const dark = useStore((s) => s.dark);
  return (
    <div style={{ height: '100%', minHeight: 0 }} data-testid="code-node">
      <Editor language="ini" value={text} theme={dark ? 'vs-dark' : 'light'} options={{ ...OPTS, glyphMargin: false }} />
    </div>
  );
}
