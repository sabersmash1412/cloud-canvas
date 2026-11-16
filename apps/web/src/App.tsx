import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type OnConnectStart } from '@xyflow/react';
import { ArrowLeft, Check, Cloud, Download, FileUp, GitBranch, Loader2, Moon, PanelRight, Redo2, Save, Sun, Trash2, Undo2 } from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import { AnimatePresence, motion } from 'framer-motion';
import { CATALOG, edgeRule } from '@cloudcanvas/compiler';
import { toGraph, useStore } from './store';
import { useCompile } from './useCompile';
import { useFindings } from './useFindings';
import { ResourceNode, SubnetNode, VpcNode } from './components/nodes';
import { CCEdge } from './components/edge';
import { Palette } from './components/Palette';
import { SidePanel } from './components/SidePanel';
import { RepoBanner } from './components/HistoryView';
import { snapshot } from './snapshot';
import { diffGraphs, type HistoryEntry } from '@cloudcanvas/compiler';
import { headOf, useRepoSync, type RepoCtl } from './history';
import { repo, type Project } from './projects';
import { goHome, useRoute } from './router';
import { Dashboard } from './components/Dashboard';

const nodeTypes = { resource: ResourceNode, vpc: VpcNode, subnet: SubnetNode };

const edgeTypes = { cc: CCEdge };

function download(name: string, data: BlobPart, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Toast() {
  const msg = useStore((s) => s.notice);
  return (
    <AnimatePresence>
      {msg && (
        <motion.div key={msg} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="panel"
          style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 30, padding: '9px 16px', fontSize: 12.5, maxWidth: 460, pointerEvents: 'none' }}>
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Canvas({ repoView }: { repoView: { ctl: RepoCtl; viewing: HistoryEntry | null; base: HistoryEntry | null } | null }) {
  const live = useStore();
  const { addNode, addEdge, select, setConnecting } = live;
  const selected = live.selected;
  const view = useMemo(() => {
    const e = repoView?.viewing;
    if (!repoView || !e?.graph) return null;
    const base = repoView.base?.graph ?? null;
    // comparing: older -> newer. Viewing one older commit: what that commit changed. The latest version is shown clean.
    const latest = repoView.ctl.entries?.find((x) => x.graph) ?? null;
    const diff = base ? diffGraphs(base, e.graph) : e !== latest ? e.diff : null;
    return snapshot({ graph: e.graph, base, diff }, selected);
  }, [repoView, selected]);
  const linked = !!repoView;
  const nodes = view ? view.nodes : live.nodes;
  const edges = view ? view.edges : live.edges;
  const readonly = linked;
  const onNodesChange = readonly ? () => {} : live.onNodesChange;
  const onEdgesChange = readonly ? () => {} : live.onEdgesChange;
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  // refit when a different version (or comparison) is shown
  const shownKey = repoView ? `${repoView.viewing?.commit.sha}|${repoView.base?.commit.sha ?? ''}` : '';
  useEffect(() => { if (shownKey) { const t = setTimeout(() => fitView({ duration: 250, padding: 0.15, maxZoom: 1 }), 80); return () => clearTimeout(t); } }, [shownKey, fitView]);

  const isValid = useCallback((c: Connection) => {
    const s = nodes.find((n) => n.id === c.source), t = nodes.find((n) => n.id === c.target);
    if (!s || !t || s.id === t.id) return false;
    if (edges.some((e) => e.source === s.id && e.target === t.id)) return false;
    return !!edgeRule(s.data.type, t.data.type);
  }, [nodes, edges]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/cc-type');
    if (!type) return;
    const id = addNode(type, screenToFlowPosition({ x: e.clientX - 28, y: e.clientY - 28 }));
    if (id) setTimeout(() => fitView({ duration: 300, padding: 0.25, maxZoom: 1 }), 50);
  };

  const onConnectStart: OnConnectStart = (_, p) => {
    const n = nodes.find((x) => x.id === p.nodeId);
    setConnecting(n?.data.type ?? null);
  };

  return (
    <div ref={wrap} className="panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
      {repoView && <RepoBanner ctl={repoView.ctl} viewing={repoView.viewing} base={repoView.base} />}
      <ReactFlow
        className={readonly ? 'readonly' : ''}
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        elementsSelectable={!readonly}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(c) => c.source && c.target && addEdge(c.source, c.target)}
        isValidConnection={(c) => isValid(c as Connection)}
        onConnectStart={onConnectStart}
        onConnectEnd={() => setConnecting(null)}
        onNodeDragStart={(_, n) => { useStore.getState().checkpoint(); useStore.getState().startDrag(n.id); }}
        onNodeDragStop={(_, n) => useStore.getState().dropNode(n.id)}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'cc', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }}
        connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2 }}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--grid)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === 'vpc' || n.type === 'subnet' ? 'transparent' : '#8b7dff')} maskColor="rgba(0,0,0,.12)" />
      </ReactFlow>
      {nodes.length === 0 && linked && (
        <div className="empty-hint"><div style={{ textAlign: 'center', color: 'var(--muted)', maxWidth: 360, lineHeight: 1.5 }}>
          {repoView!.ctl.sync.status === 'error' ? 'Could not load this repository. See the History tab.' : repoView!.ctl.entries ? 'No Terraform architecture could be read from this repository yet.' : 'Reading the repository…'}
        </div></div>
      )}
      {nodes.length === 0 && !linked && (
        <div className="empty-hint">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <Cloud size={40} style={{ opacity: .5, marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Drag a service here to begin</div>
            <div style={{ marginTop: 4 }}>or load a starter from the <b>Templates</b> menu</div>
          </motion.div>
        </div>
      )}
      <Toast />
    </div>
  );
}

function Editor({ project: proj }: { project: Project }) {
  const linked = !!proj.source;
  const result = useCompile({ lenient: linked });
  const findings = useFindings(result);
  useEffect(() => useStore.getState().setFindings(findings), [findings]);
  const { project, setProject, dark, toggleDark, undo, redo, load, clear, past, future, nodes, edges, passthrough } = useStore();
  const { fitView } = useReactFlow();
  const file = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(proj.name);
  const [panel, setPanel] = useState(true);
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const base = useRef<{ nodes: unknown; edges: unknown; project: unknown } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ── repo-linked projects: follow the repository
  const [viewSha, setViewSha] = useState<string | null>(null);
  const [cmpSha, setCmpSha] = useState<string | null>(null);
  const live = useRef(proj);
  const sync = useRepoSync(proj.id, proj.source, {
    name: proj.name,
    onSynced: async (r) => {
      if (!r.latest?.graph || !live.current.source) return;
      const head = headOf(r.entries[0]);
      const cur = live.current;
      if (cur.source?.head?.sha === head.sha && cur.source.syncedAt && Date.now() - cur.source.syncedAt < 10_000) return;
      const next: Project = { ...cur, graph: r.latest.graph, source: { ...cur.source!, head, syncedAt: Date.now() } };
      live.current = next;
      await repo.save(next);
    },
    onNew: (e) => setToast(`New commit by ${e.commit.author}: ${e.commit.message}`),
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const entries = sync.entries;
  const latestEntry = entries?.find((e) => e.graph) ?? null;
  const viewing = viewSha ? entries?.find((e) => e.commit.sha === viewSha && e.graph) ?? latestEntry : latestEntry;
  const baseEntry = cmpSha ? entries?.find((e) => e.commit.sha === cmpSha && e.graph) ?? null : null;
  // always compare older -> newer, whichever one was clicked (the list is newest first)
  let shownEntry = viewing, shownBase: HistoryEntry | null = null;
  if (entries && viewing && baseEntry && baseEntry !== viewing) {
    const newer = entries.indexOf(viewing) < entries.indexOf(baseEntry) ? viewing : baseEntry;
    shownEntry = newer; shownBase = newer === viewing ? baseEntry : viewing;
  }
  const ctl: RepoCtl | null = proj.source ? {
    source: proj.source, entries, sync: sync.sync, syncedAt: sync.syncedAt, paused: sync.paused,
    viewSha, cmpSha, view: setViewSha, compare: setCmpSha, reload: sync.reload, setToken: sync.setToken,
  } : null;

  // the live store mirrors the latest commit, so the list, issues and code tabs describe what is on screen
  const mirrored = shownEntry?.graph ?? null;
  useEffect(() => {
    useStore.getState().setReadOnly(linked);
    if (linked) { const st = useStore.getState(); st.openGraph(mirrored ?? proj.graph); }
    return () => { useStore.getState().setReadOnly(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, mirrored]);

  // load the project graph once per project
  useEffect(() => {
    if (linked) { const t = setTimeout(() => fitView({ duration: 0, padding: 0.12, maxZoom: 1 }), 150); return () => clearTimeout(t); }
    useStore.getState().openGraph(proj.graph);
    const st = useStore.getState();
    base.current = { nodes: st.nodes, edges: st.edges, project: st.project }; // the just-loaded graph needs no save
    const t = setTimeout(() => fitView({ duration: 0, padding: 0.12, maxZoom: 1 }), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj.id]);

  // debounced autosave (editable projects only)
  useEffect(() => {
    if (linked) return;
    const b = base.current;
    if (b && b.nodes === nodes && b.edges === edges && b.project === project && title === proj.name) { setSaved('saved'); return; } // nothing changed since load
    setSaved('saving');
    const t = setTimeout(async () => {
      await repo.save({ ...proj, name: title.trim() || proj.name, graph: toGraph(nodes, edges, project, passthrough) });
      setSaved('saved');
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, project, passthrough, title]);

  // renaming a linked project
  useEffect(() => {
    if (!linked || title.trim() === live.current.name || !title.trim()) return;
    const t = setTimeout(async () => { live.current = { ...live.current, name: title.trim() }; await repo.save(live.current); }, 500);
    return () => clearTimeout(t);
  }, [title, linked]);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo]);

  const apply = (g: ReturnType<typeof toGraph>) => { load(g); setTimeout(() => fitView({ duration: 400, padding: 0.2, maxZoom: 1 }), 60); };
  const exportZip = () => {
    const files: Record<string, Uint8Array> = { 'canvas.json': strToU8(JSON.stringify(toGraph(nodes, edges, project, passthrough), null, 2)) };
    for (const f of result.files) files[`${project.name}/${f.path}`] = strToU8(f.content);
    download(`${project.name}-${project.environment}.zip`, zipSync(files) as BlobPart, 'application/zip');
  };

  const src = proj.source;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, gap: 12 }}>
      <header className="panel" style={{ height: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', flex: 'none' }}>
        <button className="btn icon" data-testid="back" title="All projects" onClick={goHome}><ArrowLeft size={15} /></button>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#8b7dff,#5b8cff)', display: 'grid', placeItems: 'center' }}><Cloud size={16} color="#fff" /></div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} aria-label="Project name" style={{ all: 'unset', fontWeight: 600, width: Math.max(90, title.length * 8.5), maxWidth: 300 }} />
        {linked && src ? (
          <a data-testid="repo-chip" href={`https://github.com/${src.owner}/${src.repo}`} target="_blank" rel="noreferrer" className="kbd" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', color: 'var(--text)', padding: '3px 8px' }}>
            <GitBranch size={12} />{src.owner}/{src.repo} <span style={{ color: 'var(--muted)' }}>{src.branch}</span>
          </a>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--muted)', fontSize: 11.5 }}>
            {saved === 'saving' ? <><Loader2 size={12} className="spin" /> Saving</> : <><Check size={12} /> Saved</>}
          </span>
        )}
        {linked ? (
          <span style={{ color: 'var(--muted)', fontSize: 11.5 }} data-testid="sync-status">
            {sync.sync.status === 'loading' && !entries ? 'Syncing…' : sync.sync.status === 'error' ? 'Sync failed' : sync.paused ? 'Live updates paused' : sync.syncedAt ? 'Following the repo · checked just now' : ''}
          </span>
        ) : (
          <>
            <select value={project.environment} onChange={(e) => setProject({ environment: e.target.value })} className="btn" style={{ height: 28 }}>
              {['dev', 'uat', 'prod'].map((x) => <option key={x}>{x}</option>)}
            </select>
            <select value={project.region} onChange={(e) => setProject({ region: e.target.value })} className="btn mono" style={{ height: 28 }}>
              {['ap-southeast-1', 'ap-southeast-2', 'us-east-1', 'eu-west-1'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn icon" data-testid="toggle-panel" title={panel ? 'Hide panel' : 'Show panel'} onClick={() => setPanel(!panel)}><PanelRight size={15} /></button>
        {!linked && (
          <>
            <button className="btn icon" title="Undo (⌘Z)" disabled={!past.length} onClick={undo}><Undo2 size={15} /></button>
            <button className="btn icon" title="Redo (⌘⇧Z)" disabled={!future.length} onClick={redo}><Redo2 size={15} /></button>
            <button className="btn icon" title="Clear canvas" disabled={!nodes.length} onClick={clear}><Trash2 size={15} /></button>
            <button className="btn icon" title="Open canvas.json" onClick={() => file.current?.click()}><FileUp size={15} /></button>
            <input ref={file} type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) apply(JSON.parse(await f.text())); e.target.value = ''; }} />
            <button className="btn icon" title="Save canvas.json" onClick={() => download(`${project.name}.canvas.json`, JSON.stringify(toGraph(nodes, edges, project, passthrough), null, 2))}><Save size={15} /></button>
          </>
        )}
        <button className="btn icon" title={dark ? 'Light mode' : 'Dark mode'} onClick={toggleDark}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        {!linked && <button className="btn primary" disabled={!result.ok || !nodes.length} onClick={exportZip}><Download size={14} /> Get code</button>}
      </header>
      <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, position: 'relative' }}>
        {!linked && <Palette />}
        <Canvas repoView={ctl ? { ctl, viewing: shownEntry, base: shownBase } : null} />
        {panel && <SidePanel result={result} projectId={proj.id} repoCtl={ctl} />}
        <AnimatePresence>
          {toast && (
            <motion.div data-testid="new-commit-toast" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="panel"
              style={{ position: 'absolute', top: 64, left: 0, right: 0, margin: '0 auto', width: 'max-content', maxWidth: '70%', zIndex: 40, padding: '10px 16px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 10, borderColor: 'var(--ok)' }}>
              <GitBranch size={15} style={{ color: 'var(--ok)' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast}</span>
              <button className="btn" style={{ height: 24, padding: '0 8px' }} onClick={() => setToast(null)}>Dismiss</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ProjectPage({ id }: { id: string }) {
  const [proj, setProj] = useState<Project | null | undefined>(undefined);
  useEffect(() => { repo.get(id).then((p) => setProj(p ?? null)); }, [id]);
  if (proj === undefined) return null;
  if (proj === null)
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><div style={{ fontSize: 18, fontWeight: 600 }}>Project not found</div><p style={{ color: 'var(--muted)' }}>It may have been deleted, or it was created in another browser.</p><button className="btn primary" onClick={goHome}>Back to projects</button></div>
      </div>
    );
  return <Editor key={proj.id} project={proj} />;
}

export function App() {
  const route = useRoute();
  const dark = useStore((s) => s.dark);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return (
    <ReactFlowProvider>
      {route.name === 'home' ? <Dashboard /> : <ProjectPage id={route.id} />}
    </ReactFlowProvider>
  );
}
