import { X, Trash2 } from 'lucide-react';
import { CATALOG, checkField, type FieldDef } from '@cloudcanvas/compiler';
import { useStore } from '../store';

const input: React.CSSProperties = { width: '100%', height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none' };

function Field({ f, value, onChange }: { f: FieldDef; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  const err = checkField(f, value);
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontWeight: 500 }}>
        <span>{f.label}{f.required && <span style={{ color: 'var(--err)' }}> *</span>}</span>
        {f.type === 'boolean' && (
          <button type="button" onClick={() => onChange(!value)} style={{ all: 'unset', cursor: 'pointer', width: 34, height: 20, borderRadius: 10, background: value ? 'var(--accent)' : 'var(--line)', position: 'relative', transition: 'background .15s' }}>
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

export function Inspector() {
  const id = useStore((s) => s.selected);
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const all = useStore((s) => s.diagnostics);
  const diags = all.filter((d) => d.nodeId === id);
  const { setProp, select, onNodesChange } = useStore.getState();
  if (!node) return null;
  const def = CATALOG[node.data.type];
  return (
    <div className="panel" style={{ position: 'absolute', right: 12, top: 12, bottom: 12, width: 268, zIndex: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderBottom: '1px solid var(--line)' }}>
        <img src={`/aws-icons/${def.icon}.svg`} width={30} height={30} style={{ borderRadius: 7 }} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{def.label}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.virtual ? 'part of the VPC module' : def.module.source.replace('terraform-aws-modules/', '')}</div>
        </div>
        <button className="btn icon" style={{ border: 0 }} onClick={() => select(null)}><X size={15} /></button>
      </div>
      <div style={{ overflow: 'auto', padding: 14, flex: 1 }}>
        {diags.filter((d) => d.severity !== 'info').map((d, i) => (
          <div key={i} style={{ padding: '8px 10px', borderRadius: 8, marginBottom: 10, fontSize: 11.5, lineHeight: 1.4, background: d.severity === 'error' ? 'color-mix(in srgb, var(--err) 14%, transparent)' : 'color-mix(in srgb, var(--warn) 16%, transparent)' }}>{d.message}</div>
        ))}
        {def.fields.map((f) => <Field key={f.key} f={f} value={node.data.properties[f.key] ?? f.default} onChange={(v) => setProp(node.id, f.key, v)} />)}
        {def.outputs.length > 0 && <>
          <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600, margin: '18px 0 6px' }}>EXPOSES</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{def.outputs.map((o) => <span key={o} className="mono kbd">{o}</span>)}</div>
        </>}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
        <button className="btn" style={{ width: '100%', justifyContent: 'center', color: 'var(--err)' }} onClick={() => onNodesChange([{ type: 'remove', id: node.id }])}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}
