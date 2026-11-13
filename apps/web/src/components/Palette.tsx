import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { CATALOG_LIST, CATEGORIES, type NodeDef } from '@cloudcanvas/compiler';

export function Palette() {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ def: NodeDef; y: number } | null>(null);
  const groups = useMemo(
    () => CATEGORIES.map((c) => ({ c, items: CATALOG_LIST.filter((d) => d.category === c && (d.label + d.description).toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length),
    [q],
  );
  return (
    <div className="panel" style={{ width: 212, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>COMPONENTS</div>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWS services…" style={{ width: '100%', height: 32, padding: '0 10px 0 30px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none' }} />
        </div>
      </div>
      <div style={{ overflow: 'auto', flex: 1, padding: '4px 12px 12px' }} onMouseLeave={() => setHover(null)}>
        {groups.map(({ c, items }) => (
          <div key={c}>
            <button onClick={() => setClosed({ ...closed, [c]: !closed[c] })} style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '12px 0 8px', color: 'var(--text)', fontWeight: 500 }}>
              {c}
              <ChevronDown size={14} style={{ color: 'var(--muted)', transform: closed[c] ? 'rotate(-90deg)' : undefined, transition: 'transform .15s' }} />
            </button>
            {!closed[c] && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {items.map((d) => (
                  <div
                    key={d.type}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('application/cc-type', d.type); e.dataTransfer.effectAllowed = 'copy'; }}
                    onMouseEnter={(e) => setHover({ def: d, y: (e.currentTarget as HTMLElement).getBoundingClientRect().top })}
                    style={{ cursor: 'grab', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 2px', borderRadius: 10, transition: 'background .15s' }}
                    onMouseOver={(e) => (e.currentTarget.style.background = 'var(--panel-2)')}
                    onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <img src={`/aws-icons/${d.icon}.svg`} width={38} height={38} style={{ borderRadius: 8 }} draggable={false} alt="" />
                    <span style={{ fontSize: 9.5, textAlign: 'center', lineHeight: 1.15, color: 'var(--muted)' }}>{d.label.replace('Application ', '').replace(' (HTTP)', '')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {hover && (
        <div className="panel" style={{ position: 'fixed', left: 262, top: Math.min(hover.y - 8, window.innerHeight - 200), width: 300, padding: 14, display: 'flex', gap: 12, zIndex: 50, pointerEvents: 'none' }}>
          <img src={`/aws-icons/${hover.def.icon}.svg`} width={52} height={52} style={{ borderRadius: 10, flex: 'none' }} alt="" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{hover.def.label}</div>
            <div style={{ color: 'var(--muted)', lineHeight: 1.45, fontSize: 12 }}>{hover.def.description}</div>
            {hover.def.parent && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent)' }}>Placed in a VPC · {hover.def.tier} subnets</div>}
          </div>
        </div>
      )}
    </div>
  );
}
