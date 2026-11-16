import { useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { CATALOG, checkField, type FieldDef } from '@cloudcanvas/compiler';
import { useStore } from '../store';

const input: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

export function Field({ f, value, onChange }: { f: FieldDef; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  const err = checkField(f, value);
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontWeight: 500 }}>
        <span>{f.label}{f.required && <span style={{ color: 'var(--err)' }}> *</span>}</span>
        {f.type === 'boolean' && (
          <button type="button" role="switch" aria-checked={!!value} onClick={() => onChange(!value)} style={{ all: 'unset', cursor: 'pointer', width: 34, height: 20, borderRadius: 10, background: value ? 'var(--accent)' : 'var(--line)', position: 'relative', transition: 'background .15s' }}>
            <span style={{ position: 'absolute', top: 2, left: value ? 16 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .15s' }} />
          </button>
        )}
      </div>
      {f.type === 'string' && <input style={{ ...input, borderColor: err ? 'var(--err)' : 'var(--line)' }} className="mono" value={String(value)} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />}
      {f.type === 'number' && <input style={{ ...input, borderColor: err ? 'var(--err)' : 'var(--line)' }} type="number" value={String(value)} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />}
      {f.type === 'select' && (
        <select style={input} value={String(value)} onChange={(e) => onChange(typeof f.options![0] === 'number' ? Number(e.target.value) : e.target.value)}>
          {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {err ? <div style={{ color: 'var(--err)', fontSize: 11, marginTop: 4 }}>{err}</div> : f.help ? <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>{f.help}</div> : null}
    </label>
  );
}

/** Friendly editable form for one canvas node. */
export function NodeForm({ id }: { id: string }) {
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const all = useStore((s) => s.diagnostics);
  const [open, setOpen] = useState(true);
  const ro = useStore((s) => s.readOnly);
  if (!node) return null;
  const def = CATALOG[node.data.type];
  const diags = all.filter((d) => d.nodeId === id && d.severity !== 'info');
  const { setProp } = useStore.getState();
  return (
    <div style={{ padding: '4px 16px 20px' }}>
      {diags.map((d, i) => (
        <div key={i} style={{ padding: '8px 10px', borderRadius: 8, marginBottom: 10, fontSize: 12, lineHeight: 1.4, background: d.severity === 'error' ? 'color-mix(in srgb, var(--err) 14%, transparent)' : 'color-mix(in srgb, var(--warn) 16%, transparent)' }}>{d.message}</div>
      ))}
      <button onClick={() => setOpen(!open)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 0', fontWeight: 600, fontSize: 14 }}>
        <ChevronDown size={16} style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform .15s' }} /> Main parameters
      </button>
      {open && <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, opacity: ro ? 0.75 : 1 }}>{def.fields.map((f) => <Field key={f.key} f={f} value={node.data.properties[f.key] ?? f.default} onChange={(v) => setProp(node.id, f.key, v)} />)}</fieldset>}
    </div>
  );
}

export function DeleteNode({ id }: { id: string }) {
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const ro = useStore((s) => s.readOnly);
  if (!node || ro) return null;
  const def = CATALOG[node.data.type];
  const nested = useStore.getState().nodes.filter((n) => n.parentId === id).length;
  return (
    <button className="btn" data-testid="delete-node" style={{ width: '100%', justifyContent: 'center', color: 'var(--err)' }} onClick={() => useStore.getState().onNodesChange([{ type: 'remove', id }])}>
      <Trash2 size={14} /> Delete {def.label}{nested ? ` and ${nested} nested item${nested === 1 ? '' : 's'}` : ''}
    </button>
  );
}
