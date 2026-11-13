import { useCallback, useEffect, useRef } from 'react';
import { Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type OnConnectStart } from '@xyflow/react';
import { Cloud, Code2, Download, FileUp, LayoutTemplate, Moon, PanelLeft, Redo2, Save, Sun, Trash2, Undo2 } from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import { motion } from 'framer-motion';
import { CATALOG, edgeRule } from '@cloudcanvas/compiler';
import { toGraph, useStore } from './store';
import { useCompile } from './useCompile';
import { ResourceNode, VpcNode } from './components/nodes';
import { CCEdge } from './components/edge';
import { Palette } from './components/Palette';
import { Inspector } from './components/Inspector';
import { CodePanel } from './components/CodePanel';
import { SERVERLESS, THREE_TIER } from './templates';

const nodeTypes = { resource: ResourceNode, vpc: VpcNode };
const edgeTypes = { cc: CCEdge };

function download(name: string, data: BlobPart, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, addNode, addEdge, select, setConnecting } = useStore();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

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
      <ReactFlow
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
        onNodeDragStart={() => useStore.getState().checkpoint()}
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
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === 'vpc' ? 'transparent' : '#8b7dff')} maskColor="rgba(0,0,0,.12)" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="empty-hint">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <Cloud size={40} style={{ opacity: .5, marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Drag a service here to begin</div>
            <div style={{ marginTop: 4 }}>or load a starter from the <b>Templates</b> menu</div>
          </motion.div>
        </div>
      )}
      <Inspector />
    </div>
  );
}

function Shell() {
  const result = useCompile();
  const { project, setProject, dark, toggleDark, view, setView, undo, redo, load, clear, past, future, nodes, edges } = useStore();
  const { fitView } = useReactFlow();
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const d = q.get('demo');
    if (d === 'three') load(THREE_TIER); else if (d === 'sls') load(SERVERLESS);
    if (q.get('theme')) { if ((q.get('theme') === 'dark') !== useStore.getState().dark) toggleDark(); }
    if (q.get('select')) useStore.getState().select(q.get('select'));
    if (d) setTimeout(() => fitView({ duration: 0, padding: 0.12, maxZoom: 1 }), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  const apply = (g: typeof THREE_TIER) => { load(g); setTimeout(() => fitView({ duration: 400, padding: 0.2, maxZoom: 1 }), 60); };
  const exportZip = () => {
    const files: Record<string, Uint8Array> = { 'canvas.json': strToU8(JSON.stringify(toGraph(nodes, edges, project), null, 2)) };
    for (const f of result.files) files[`${project.name}/${f.path}`] = strToU8(f.content);
    download(`${project.name}-${project.environment}.zip`, zipSync(files) as BlobPart, 'application/zip');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, gap: 12 }}>
      <header className="panel" style={{ height: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#8b7dff,#5b8cff)', display: 'grid', placeItems: 'center' }}><Cloud size={16} color="#fff" /></div>
          Cloud Canvas
        </div>
        <span style={{ color: 'var(--line)' }}>/</span>
        <input value={project.name} onChange={(e) => setProject({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} style={{ all: 'unset', fontWeight: 600, width: 130 }} />
        <select value={project.environment} onChange={(e) => setProject({ environment: e.target.value })} className="btn" style={{ height: 28 }}>
          {['dev', 'uat', 'prod'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={project.region} onChange={(e) => setProject({ region: e.target.value })} className="btn mono" style={{ height: 28 }}>
          {['ap-southeast-1', 'ap-southeast-2', 'us-east-1', 'eu-west-1'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', background: 'var(--panel-2)', borderRadius: 10, padding: 3 }}>
          {([['canvas', PanelLeft, 'Canvas'], ['split', LayoutTemplate, 'Split'], ['code', Code2, 'Code']] as const).map(([v, I, l]) => (
            <button key={v} onClick={() => setView(v)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, fontWeight: 500, background: view === v ? 'var(--panel)' : 'transparent', boxShadow: view === v ? 'var(--shadow)' : 'none', color: view === v ? 'var(--text)' : 'var(--muted)' }}><I size={13} />{l}</button>
          ))}
        </div>
        <select className="btn" value="" onChange={(e) => { if (e.target.value === 'three') apply(THREE_TIER); if (e.target.value === 'sls') apply(SERVERLESS); }}>
          <option value="" disabled>Templates</option>
          <option value="three">3-tier web app</option>
          <option value="sls">Serverless API</option>
        </select>
        <button className="btn icon" title="Undo (⌘Z)" disabled={!past.length} onClick={undo}><Undo2 size={15} /></button>
        <button className="btn icon" title="Redo (⌘⇧Z)" disabled={!future.length} onClick={redo}><Redo2 size={15} /></button>
        <button className="btn icon" title="Clear canvas" disabled={!nodes.length} onClick={clear}><Trash2 size={15} /></button>
        <button className="btn icon" title="Open canvas.json" onClick={() => file.current?.click()}><FileUp size={15} /></button>
        <input ref={file} type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) apply(JSON.parse(await f.text())); e.target.value = ''; }} />
        <button className="btn icon" title="Save canvas.json" onClick={() => download(`${project.name}.canvas.json`, JSON.stringify(toGraph(nodes, edges, project), null, 2))}><Save size={15} /></button>
        <button className="btn icon" title={dark ? 'Light mode' : 'Dark mode'} onClick={toggleDark}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className="btn primary" disabled={!result.ok || !nodes.length} onClick={exportZip}><Download size={14} /> Get code</button>
      </header>
      <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>
        {view !== 'code' && <Palette />}
        {view !== 'code' && <Canvas />}
        {view !== 'canvas' && <div style={{ display: 'flex', flex: view === 'code' ? 1 : 'none', width: view === 'code' ? undefined : 440, minWidth: 0 }}><CodePanel result={result} /></div>}
      </div>
    </div>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}
