import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, FileCode2, FolderUp, Info, Loader2, UploadCloud } from 'lucide-react';
import { unzipSync, strFromU8 } from 'fflate';
import { CATALOG, importTerraform, type ImportResult, type TfFile } from '@cloudcanvas/compiler';
import { Modal } from './Modal';
import { DiagramSVG } from './DiagramSVG';
import { parseHcl } from '../hclParser';
import { newId, repo, slugify, type Project } from '../projects';
import { goProject } from '../router';

const field: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none', fontSize: 13, boxSizing: 'border-box' };
const TEXT = /\.(tf|tfvars)$/i;

/** Turn dropped files / folders / a zip into a flat list of Terraform files. */
async function collect(items: { name: string; read: () => Promise<ArrayBuffer> }[]): Promise<TfFile[]> {
  const out: TfFile[] = [];
  for (const it of items) {
    if (/\.zip$/i.test(it.name)) {
      const z = unzipSync(new Uint8Array(await it.read()));
      for (const [p, data] of Object.entries(z)) if (TEXT.test(p) && !/(^|\/)\.terraform\//.test(p) && !p.startsWith('__MACOSX')) out.push({ path: p, content: strFromU8(data) });
    } else if (TEXT.test(it.name)) out.push({ path: it.name, content: new TextDecoder().decode(await it.read()) });
  }
  // only the deepest-common folder of .tf files is one root module; keep files from the shallowest folder that has any
  const dirs = [...new Set(out.filter((f) => f.path.endsWith('.tf')).map((f) => f.path.split('/').slice(0, -1).join('/')))];
  if (dirs.length > 1) {
    const top = dirs.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
    return out.filter((f) => f.path.split('/').slice(0, -1).join('/') === top).map((f) => ({ ...f, path: f.path.split('/').pop()! }));
  }
  return out.map((f) => ({ ...f, path: f.path.split('/').pop()! }));
}

async function walk(entry: FileSystemEntry, prefix = ''): Promise<{ name: string; read: () => Promise<ArrayBuffer> }[]> {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ name: prefix + file.name, read: () => file.arrayBuffer() }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch: FileSystemEntry[] = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    all.push(...batch);
  }
  const out: { name: string; read: () => Promise<ArrayBuffer> }[] = [];
  for (const e of all) {
    if (e.name === '.terraform' || e.name.startsWith('.git')) continue;
    out.push(...(await walk(e, `${prefix}${entry.name}/`)));
  }
  return out;
}

export function ImportTerraform({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: string[] }) {
  const [step, setStep] = useState<'drop' | 'review'>('drop');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState<TfFile[]>([]);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const reset = () => { setStep('drop'); setBusy(false); setErr(''); setFiles([]); setRes(null); setName(''); setDescription(''); };
  const close = () => { onClose(); setTimeout(reset, 200); };

  const analyse = useCallback(async (items: { name: string; read: () => Promise<ArrayBuffer> }[]) => {
    setErr('');
    setBusy(true);
    try {
      const fs = await collect(items);
      if (!fs.some((f) => f.path.endsWith('.tf'))) throw new Error('No .tf files found. Drop a folder or a .zip that contains Terraform files.');
      // only a folder or zip name says anything about the project; a lone file name (main.tf) does not
      const first = items[0]?.name ?? '';
      const guess = /\.zip$/i.test(first) ? first.replace(/\.zip$/i, '') : first.includes('/') ? first.split('/')[0] : '';
      const r = await importTerraform(fs, { parse: parseHcl, name: slugify(guess) });
      if (!r.graph.nodes.length) throw new Error(r.report.notes.find((n) => n.severity === 'error')?.message ?? 'Nothing in these files could be shown on the canvas.');
      setFiles(fs);
      setRes(r);
      let nm = r.graph.project.name;
      const taken = new Set(existing);
      for (let i = 2; taken.has(nm.toLowerCase()); i++) nm = `${r.graph.project.name}-${i}`;
      setName(nm);
      setStep('review');
    } catch (e) {
      setErr((e as Error).message || 'Could not read these files.');
    } finally { setBusy(false); }
  }, [existing]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    const items = entries.length ? (await Promise.all(entries.map((x) => walk(x)))).flat() : [...e.dataTransfer.files].map((f) => ({ name: f.name, read: () => f.arrayBuffer() }));
    analyse(items);
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])];
    analyse(list.map((f) => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, read: () => f.arrayBuffer() })));
    e.target.value = '';
  };

  const create = async () => {
    if (!res || busy) return;
    setBusy(true);
    const now = Date.now();
    const g = structuredClone(res.graph);
    g.project.name = slugify(name) || g.project.name;
    const p: Project = { id: newId(), name: name.trim(), description: description.trim() || `Imported from ${files.length} Terraform file${files.length === 1 ? '' : 's'}`, createdAt: now, updatedAt: now, graph: g };
    await repo.save(p);
    onClose(); goProject(p.id); setTimeout(reset, 300);
  };

  const r = res?.report;
  const warnings = r?.notes.filter((n) => n.severity !== 'info') ?? [];
  const infos = r?.notes.filter((n) => n.severity === 'info') ?? [];
  const nameErr = !name.trim() ? 'Name is required' : existing.includes(name.trim().toLowerCase()) ? 'You already have a project with this name' : '';

  return (
    <Modal open={open} onClose={close} width={step === 'drop' ? 560 : 1040}>
      {step === 'drop' ? (
        <div style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Import Terraform</h2>
          <p style={{ margin: '0 0 18px', color: 'var(--muted)', lineHeight: 1.5 }}>Drop a Terraform folder or a .zip. Cloud Canvas rebuilds the architecture diagram from it. Nothing is uploaded; files are read in your browser.</p>
          <div data-testid="dropzone" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            style={{ border: `2px dashed ${drag ? 'var(--accent)' : 'var(--line)'}`, background: drag ? 'var(--accent-soft)' : 'var(--panel-2)', borderRadius: 14, padding: '38px 20px', textAlign: 'center', transition: 'all .15s' }}>
            {busy ? <><Loader2 size={28} className="spin" style={{ color: 'var(--accent)' }} /><div style={{ marginTop: 10, fontWeight: 600 }}>Reading Terraform…</div></> : (
              <>
                <UploadCloud size={30} style={{ color: 'var(--accent)' }} />
                <div style={{ marginTop: 10, fontWeight: 600 }}>Drop a folder or .zip here</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
                  <button className="btn" onClick={() => dirInput.current?.click()}><FolderUp size={14} /> Choose folder</button>
                  <button className="btn" data-testid="choose-files" onClick={() => input.current?.click()}><FileCode2 size={14} /> Choose files / .zip</button>
                </div>
              </>
            )}
          </div>
          <input ref={input} data-testid="file-input" type="file" multiple accept=".tf,.tfvars,.zip" hidden onChange={onPick} />
          <input ref={dirInput} type="file" hidden onChange={onPick} {...({ webkitdirectory: '', directory: '' } as object)} />
          {err && <div data-testid="import-error" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 9, background: 'color-mix(in srgb, var(--err) 14%, transparent)', color: 'var(--text)', lineHeight: 1.45 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}><button className="btn" onClick={close}>Cancel</button></div>
        </div>
      ) : res && r ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'min(700px, 88vh)' }}>
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ width: 430, flex: 'none', padding: 20, overflow: 'auto', borderRight: '1px solid var(--line)' }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>Review import</h2>
              <div data-testid="coverage" style={{ padding: 14, borderRadius: 12, background: 'var(--panel-2)', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: r.coverage === 100 ? 'var(--ok)' : 'var(--warn)' }}>{r.coverage}%</span>
                  <span style={{ color: 'var(--muted)' }}>{r.mapped} of {r.total} block{r.total === 1 ? '' : 's'} shown on the canvas</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', marginTop: 10, overflow: 'hidden' }}><div style={{ width: `${r.coverage}%`, height: '100%', background: r.coverage === 100 ? 'var(--ok)' : 'var(--warn)' }} /></div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{files.length} file{files.length === 1 ? '' : 's'} read · {res.graph.project.region} · {res.graph.project.environment}</div>
              </div>

              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', fontWeight: 500, marginBottom: 6 }}>Project name</span>
                <input data-testid="import-name" style={{ ...field, borderColor: nameErr ? 'var(--err)' : 'var(--line)' }} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
                {nameErr && <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 4 }}>{nameErr}</div>}
              </label>
              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ display: 'block', fontWeight: 500, marginBottom: 6 }}>Description</span>
                <input style={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" maxLength={240} />
              </label>

              <div style={{ fontSize: 11, letterSpacing: '.08em', fontWeight: 600, color: 'var(--muted)', margin: '4px 0 8px' }}>MAPPED ({r.mappedNodes.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                {r.mappedNodes.map((m) => {
                  const d = CATALOG[m.type];
                  return <div key={m.nodeId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}><Check size={13} style={{ color: 'var(--ok)', flex: 'none' }} />{d && <img src={`/aws-icons/${d.icon}.svg`} width={16} height={16} style={{ borderRadius: 3 }} alt="" />}<b style={{ fontWeight: 500 }}>{d?.label}</b><span className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{m.label}</span></div>;
                })}
              </div>

              {r.unmanaged.length > 0 && (
                <div data-testid="unmanaged" style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: '.08em', fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>NOT MODELLED ({r.unmanaged.length}) · KEPT AS-IS</div>
                  {r.unmanaged.map((u) => <div key={u.label} style={{ fontSize: 12.5, marginBottom: 6, lineHeight: 1.4 }}><span className="mono">{u.label}</span><div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{u.reason}</div></div>)}
                </div>
              )}
              {r.preserved.length > 0 && (
                <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  <b style={{ color: 'var(--text)', fontWeight: 600 }}>Kept exactly as written:</b> {r.preserved.reduce((n, p) => n + p.keys.length, 0)} setting{r.preserved.reduce((n, p) => n + p.keys.length, 0) === 1 ? '' : 's'} the form can’t express. They stay in your Terraform but aren’t editable here.
                </div>
              )}
              {r.passthrough > 0 && <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}><b style={{ color: 'var(--text)', fontWeight: 600 }}>{r.passthrough} other block{r.passthrough === 1 ? '' : 's'}</b> (variables, outputs, raw resources) are kept in main.tf but don’t appear on the canvas.</div>}
              {warnings.map((n, i) => <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 6, lineHeight: 1.4 }}><AlertTriangle size={14} style={{ color: 'var(--warn)', flex: 'none', marginTop: 1 }} />{n.message}</div>)}
              {infos.map((n, i) => <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 6, lineHeight: 1.4, color: 'var(--muted)' }}><Info size={14} style={{ flex: 'none', marginTop: 1 }} />{n.message}</div>)}
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)' }}>PREVIEW</div>
              <div data-testid="import-preview" style={{ flex: 1, minHeight: 0, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--panel-2)', padding: 10 }}><DiagramSVG graph={res.graph} detail="full" /></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
            <button className="btn" onClick={() => { setStep('drop'); setRes(null); }}><ArrowLeft size={14} /> Back</button>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" data-testid="import-create" disabled={busy || !!nameErr} onClick={create}><Check size={14} /> Create project</button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
