import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { AlertTriangle, CheckCircle2, Copy, XCircle } from 'lucide-react';
import { useStore } from '../store';
import type { CompileResult } from '@cloudcanvas/compiler';

type Mon = Parameters<OnMount>[0];

export function CodePanel({ result }: { result: CompileResult }) {
  const [file, setFile] = useState('main.tf');
  const dark = useStore((s) => s.dark);
  const selected = useStore((s) => s.selected);
  const ed = useRef<Mon | null>(null);
  const deco = useRef<string[]>([]);
  const f = result.files.find((x) => x.path === file) ?? result.files[0];
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warns = result.diagnostics.filter((d) => d.severity === 'warning').length;

  useEffect(() => {
    const e = ed.current;
    if (!e || file !== 'main.tf') return;
    const b = result.blocks.find((x) => x.nodeId === selected);
    deco.current = e.deltaDecorations(deco.current, b ? [{ range: { startLineNumber: b.startLine, startColumn: 1, endLineNumber: b.endLine, endColumn: 1 }, options: { isWholeLine: true, className: 'cc-hl', linesDecorationsClassName: 'cc-hl-gutter' } }] : []);
    if (b) e.revealRangeInCenterIfOutsideViewport({ startLineNumber: b.startLine, startColumn: 1, endLineNumber: b.endLine, endColumn: 1 }, 0);
  }, [selected, result, file]);

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
        {result.files.map((x) => (
          <button key={x.path} onClick={() => setFile(x.path)} className="mono" style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 8, fontSize: 11.5, background: x.path === f.path ? 'var(--accent-soft)' : 'transparent', color: x.path === f.path ? 'var(--accent)' : 'var(--muted)', fontWeight: 500 }}>{x.path}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: errors ? 'var(--err)' : warns ? 'var(--warn)' : 'var(--ok)' }}>
          {errors ? <XCircle size={14} /> : warns ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {errors ? `${errors} error${errors > 1 ? 's' : ''}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'Valid'}
        </span>
        <button className="btn icon" style={{ border: 0 }} title="Copy" onClick={() => navigator.clipboard.writeText(f.content)}><Copy size={14} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          language={f.language === 'hcl' ? 'ini' : f.language}
          path={f.path}
          value={f.content}
          theme={dark ? 'vs-dark' : 'light'}
          onMount={(e) => { ed.current = e; }}
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace', lineNumbersMinChars: 3, scrollBeyondLastLine: false, padding: { top: 10 }, renderLineHighlight: 'none', overviewRulerLanes: 0, smoothScrolling: true }}
        />
      </div>
      {result.diagnostics.some((d) => d.severity !== 'info') && (
        <div style={{ borderTop: '1px solid var(--line)', maxHeight: 130, overflow: 'auto', padding: 8 }}>
          {result.diagnostics.filter((d) => d.severity !== 'info').map((d, i) => (
            <div key={i} onClick={() => d.nodeId && useStore.getState().select(d.nodeId)} style={{ display: 'flex', gap: 8, padding: '4px 6px', borderRadius: 6, cursor: d.nodeId ? 'pointer' : 'default', fontSize: 11.5 }}>
              <span style={{ color: d.severity === 'error' ? 'var(--err)' : 'var(--warn)' }}>●</span>{d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
