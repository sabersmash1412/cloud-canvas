import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LayoutTemplate } from 'lucide-react';
import { buildTemplate, SCRATCH_TEMPLATE_ID, TEMPLATES, type ProjectMeta } from '@cloudcanvas/compiler';
import { Modal } from './Modal';
import { DiagramSVG } from './DiagramSVG';
import { newId, repo, slugify, type Project } from '../projects';
import { goProject } from '../router';

const field: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none', fontSize: 13 };
const label: React.CSSProperties = { display: 'block', fontWeight: 500, marginBottom: 6 };

export function CreateProject({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: string[] }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const [region, setRegion] = useState('ap-southeast-1');
  const [tpl, setTpl] = useState(TEMPLATES[0].id);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const slug = slugify(name);
  const nameErr = !name.trim() ? 'Give your project a name' : slug.length < 2 ? 'Use at least 2 letters or digits' : existing.includes(name.trim().toLowerCase()) ? 'You already have a project with this name' : '';
  const meta: ProjectMeta = { name: slug || 'my-project', environment, region };
  const selected = TEMPLATES.find((t) => t.id === tpl);
  const previewGraph = useMemo(() => buildTemplate(tpl, { name: 'preview', environment: 'dev', region: 'ap-southeast-1' }), [tpl]);

  const reset = () => { setStep(1); setName(''); setDescription(''); setTpl(TEMPLATES[0].id); setTouched(false); setBusy(false); };
  const close = () => { onClose(); setTimeout(reset, 200); };

  const create = async (templateId: string) => {
    if (busy) return;
    setBusy(true);
    const now = Date.now();
    const p: Project = { id: newId(), name: name.trim(), description: description.trim(), createdAt: now, updatedAt: now, graph: buildTemplate(templateId, meta) };
    await repo.save(p);
    onClose();
    goProject(p.id);
    setTimeout(reset, 300);
  };

  const recommended = TEMPLATES.filter((t) => t.recommended);
  const others = TEMPLATES.filter((t) => !t.recommended);
  const card = (t: (typeof TEMPLATES)[number]) => {
    const on = t.id === tpl;
    return (
      <button key={t.id} onClick={() => setTpl(t.id)} data-testid={`tpl-${t.id}`} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${on ? 'var(--accent)' : 'transparent'}`, background: on ? 'var(--accent-soft)' : 'var(--panel-2)', transition: 'all .15s' }}>
        <LayoutTemplate size={20} style={{ marginTop: 2, color: on ? 'var(--accent)' : 'var(--muted)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <b style={{ fontSize: 13.5 }}>{t.name}</b>
            {t.recommended && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--ok) 18%, transparent)', color: 'var(--ok)' }}>RECOMMENDED</span>}
          </div>
          <div style={{ color: 'var(--muted)', marginTop: 3, fontSize: 12, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.description}</div>
        </div>
      </button>
    );
  };

  return (
    <Modal open={open} onClose={close} width={step === 1 ? 480 : 1040}>
      {step === 1 ? (
        <form onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!nameErr) setStep(2); }} style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Create project</h2>
          <p style={{ margin: '0 0 20px', color: 'var(--muted)' }}>Name your project, then pick a starting architecture.</p>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={label}>Name <span style={{ color: 'var(--err)' }}>*</span></span>
            <input autoFocus data-testid="project-name" style={{ ...field, borderColor: touched && nameErr ? 'var(--err)' : 'var(--line)' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Member Portal" maxLength={60} />
            {touched && nameErr ? <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 5 }}>{nameErr}</div> : slug ? <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 5 }}>AWS resources will be prefixed <span className="mono" style={{ color: 'var(--text)' }}>{slug}-{environment}</span></div> : null}
          </label>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={label}>Description</span>
            <textarea data-testid="project-desc" style={{ ...field, height: 84, padding: 12, resize: 'none', fontFamily: 'inherit' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this infrastructure for?" maxLength={240} />
          </label>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <label style={{ flex: 1 }}><span style={label}>Environment</span>
              <select style={field} value={environment} onChange={(e) => setEnvironment(e.target.value)}>{['dev', 'uat', 'prod'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label style={{ flex: 1.4 }}><span style={label}>Region</span>
              <select style={field} className="mono" value={region} onChange={(e) => setRegion(e.target.value)}>{['ap-southeast-1', 'ap-southeast-2', 'us-east-1', 'eu-west-1'].map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" className="btn primary" data-testid="next">Next <ArrowRight size={14} /></button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'min(680px, 86vh)' }}>
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ width: 440, flex: 'none', padding: '20px 20px 0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>Select project template</h2>
              <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12, paddingRight: 4 }}>
                {recommended.map(card)}
                <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
                {others.map(card)}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--line)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)' }}>PREVIEW</div>
              <div data-testid="preview" style={{ flex: 1, minHeight: 0, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--panel-2)', padding: 10 }}>
                <DiagramSVG key={tpl} graph={previewGraph} detail="full" />
              </div>
              <div>
                <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>DESCRIPTION</div>
                <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.55, fontSize: 12.5, minHeight: 78 }}>{selected?.description}</p>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
            <button className="btn" onClick={() => setStep(1)}><ArrowLeft size={14} /> Back</button>
            <button className="btn" data-testid="scratch" disabled={busy} onClick={() => create(SCRATCH_TEMPLATE_ID)}>Start from scratch</button>
            <div style={{ flex: 1 }} />
            <button className="btn primary" data-testid="create" disabled={busy} onClick={() => create(tpl)}><Check size={14} /> Create project</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
