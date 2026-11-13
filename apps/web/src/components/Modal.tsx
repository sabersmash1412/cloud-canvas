import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function Modal({ open, onClose, children, width = 520 }: { open: boolean; onClose: () => void; children: React.ReactNode; width?: number | string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,10,20,.55)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 24 }}>
          <motion.div role="dialog" aria-modal="true" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onMouseDown={(e) => e.stopPropagation()} className="panel" style={{ width, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
