import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Cloud, Copy, Download, FileInput, FolderPlus, GitBranch, LayoutGrid, MoreHorizontal, Moon, Pencil, Plus, Search, Sun, Trash2 } from 'lucide-react';
import { ago, newId, repo, type Project } from '../projects';
import { goProject } from '../router';
import { useStore } from '../store';
import { DiagramSVG } from './DiagramSVG';
import { CreateProject } from './CreateProject';
import { ImportTerraform } from './ImportTerraform';
import { Modal } from './Modal';

function download(name: string, data: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Menu({ items }: { items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button className="btn icon" aria-label="Project actions" style={{ border: 0, height: 28, width: 28 }} onClick={() => setOpen(!open)}><MoreHorizontal size={16} /></button>
      {open && (
        <div className="panel" style={{ position: 'absolute', right: 0, top: 32, zIndex: 20, minWidth: 170, padding: 5 }}>
          {items.map((i) => (
            <button key={i.label} onClick={() => { setOpen(false); i.onClick(); }} style={{ all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', color: i.danger ? 'var(--err)' : 'var(--text)' }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--panel-2)')} onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}>
              {i.icon}{i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [newName, setNewName] = useState('');
  const { dark, toggleDark } = useStore();

  const refresh = useCallback(() => repo.list().then(setProjects), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const shown = useMemo(() => {
    const f = (projects ?? []).filter((p) => (p.name + p.description).toLowerCase().includes(q.toLowerCase()));
    return sort === 'name' ? [...f].sort((a, b) => a.name.localeCompare(b.name)) : f;
  }, [projects, q, sort]);

  const duplicate = async (p: Project) => {
    const now = Date.now();
    await repo.save({ ...structuredClone(p), id: newId(), name: `${p.name} copy`, createdAt: now, updatedAt: now });
    refresh();
  };

  return (
    <div style={{ minHeight: '100%', padding: '14px 28px 40px', maxWidth: 1400, margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 44, gap: 10, marginBottom: 14 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#8b7dff,#5b8cff)', display: 'grid', placeItems: 'center' }}><Cloud size={16} color="#fff" /></div>
        <b>Cloud Canvas</b>
        <span style={{ color: 'var(--line)' }}>/</span>
        <span style={{ color: 'var(--muted)' }}>Projects</span>
        <div style={{ flex: 1 }} />
        <button className="btn icon" onClick={toggleDark} aria-label="Toggle theme">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
      </div>

      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', marginBottom: 18 }}>
        <LayoutGrid size={20} style={{ color: 'var(--muted)' }} />
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>Projects</h1>
        {projects && projects.length > 0 && <span style={{ color: 'var(--muted)' }}>{projects.length}</span>}
        <div style={{ flex: 1 }} />
        {projects && projects.length > 0 && (
          <>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" style={{ width: 220, height: 34, padding: '0 10px 0 30px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none' }} />
            </div>
            <select className="btn" style={{ height: 34 }} value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
              <option value="recent">Recently updated</option><option value="name">Name</option>
            </select>
          </>
        )}
        <button className="btn" data-testid="import-terraform" style={{ height: 34 }} onClick={() => setImporting(true)}><FileInput size={15} /> Import Terraform</button>
        <button className="btn primary" data-testid="create-project" style={{ height: 34 }} onClick={() => setCreating(true)}><Plus size={15} /> Create project</button>
      </div>

      {projects === null ? null : projects.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel" style={{ padding: '70px 20px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, margin: '0 auto 16px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}><FolderPlus size={30} /></div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Create your first project</div>
          <p style={{ color: 'var(--muted)', margin: '6px auto 20px', maxWidth: 380, lineHeight: 1.5 }}>Design an AWS architecture on the canvas and get Terraform generated for you. Start from a template or a blank canvas.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn primary" style={{ height: 36 }} onClick={() => setCreating(true)}><Plus size={15} /> Create project</button>
            <button className="btn" style={{ height: 36 }} onClick={() => setImporting(true)}><FileInput size={15} /> Import Terraform</button>
          </div>
        </motion.div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No projects match “{q}”.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18 }}>
          {shown.map((p, i) => <Card key={p.id} p={p} i={i} onRename={() => { setRenaming(p); setNewName(p.name); }} onDelete={() => setDeleting(p)} onDuplicate={() => duplicate(p)} />)}
        </div>
      )}

      <CreateProject open={creating} onClose={() => setCreating(false)} existing={(projects ?? []).map((p) => p.name.toLowerCase())} />
      <ImportTerraform open={importing} onClose={() => setImporting(false)} existing={(projects ?? []).map((p) => p.name.toLowerCase())} />

      <Modal open={!!renaming} onClose={() => setRenaming(null)} width={400}>
        <form style={{ padding: 22 }} onSubmit={async (e) => { e.preventDefault(); if (renaming && newName.trim()) { await repo.save({ ...renaming, name: newName.trim() }); setRenaming(null); refresh(); } }}>
          <h3 style={{ margin: '0 0 14px' }}>Rename project</h3>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none', marginBottom: 16, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" className="btn" onClick={() => setRenaming(null)}>Cancel</button><button className="btn primary" disabled={!newName.trim()}>Rename</button></div>
        </form>
      </Modal>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} width={420}>
        <div style={{ padding: 22 }}>
          <h3 style={{ margin: '0 0 8px' }}>Delete “{deleting?.name}”?</h3>
          <p style={{ margin: '0 0 18px', color: 'var(--muted)', lineHeight: 1.5 }}>This removes the project and its diagram from this browser. It can’t be undone. Export <span className="mono">canvas.json</span> first if you want a copy.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn primary" data-testid="confirm-delete" style={{ background: 'var(--err)', borderColor: 'var(--err)' }} onClick={async () => { if (deleting) { await repo.remove(deleting.id); setDeleting(null); refresh(); } }}>Delete</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Card({ p, i, onRename, onDelete, onDuplicate }: { p: Project; i: number; onRename: () => void; onDelete: () => void; onDuplicate: () => void }) {
  const count = p.graph.nodes.filter((n) => n.type !== 'aws.vpc').length;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }} whileHover={{ y: -3 }}
      className="panel" data-testid="project-card" onClick={() => goProject(p.id)} style={{ cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 150, background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', padding: 8 }}>
        {p.graph.nodes.length ? <DiagramSVG graph={p.graph} detail="mini" /> : <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12 }}>Empty canvas</div>}
      </div>
      <div style={{ padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 15, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</b>
          <Menu items={[
            { label: 'Rename', icon: <Pencil size={14} />, onClick: onRename },
            { label: 'Duplicate', icon: <Copy size={14} />, onClick: onDuplicate },
            { label: 'Export canvas.json', icon: <Download size={14} />, onClick: () => download(`${p.name}.canvas.json`, JSON.stringify(p.graph, null, 2)) },
            { label: 'Delete', icon: <Trash2 size={14} />, onClick: onDelete, danger: true },
          ]} />
        </div>
        {p.source ? (
          <div data-testid="card-repo" style={{ minHeight: 35, fontSize: 12.5, lineHeight: 1.4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontWeight: 500 }}><GitBranch size={13} />{p.source.owner}/{p.source.repo}<span className="mono" style={{ color: 'var(--muted)', fontWeight: 400 }}>{p.source.branch}</span></div>
            <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.source.head ? `${p.source.head.message}` : 'Not synced yet'}</div>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.4, minHeight: 35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description || 'No description'}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 11.5, marginTop: 'auto', paddingTop: 6 }}>
          <span className="kbd">{p.graph.project.environment}</span>
          <span className="mono">{p.graph.project.region}</span>
          <span>·</span><span>{count} resource{count === 1 ? '' : 's'}</span>
          <span style={{ marginLeft: 'auto' }}>{p.source?.head ? ago(new Date(p.source.head.date).getTime()) : ago(p.updatedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}
