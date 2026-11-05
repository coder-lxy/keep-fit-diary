import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function TopBar({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  const nav = useNavigate();
  return (
    <div className="topbar">
      <button className="back" onClick={onBack ?? (() => nav(-1))} aria-label="返回">‹</button>
      <h1>{title}</h1>
      {right}
    </div>
  );
}

export function Check({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={`check ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
      {on ? '✓' : ''}
    </button>
  );
}

export function Sheet({ children, onClose, className, label = '编辑内容' }: { children: ReactNode; onClose: () => void; className?: string; label?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="sheet" onClick={onClose}>
      <div ref={panel} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          if (event.key !== 'Tab') return;
          const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
          const first = controls?.[0];
          const last = controls?.[controls.length - 1];
          if (!first) event.preventDefault();
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>{children}</div>
    </div>
  );
}

export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar">
      <div className={value > max ? 'over' : ''} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function NumberInput({
  value, onChange, step = 1, min, placeholder, suffix,
}: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; placeholder?: string; suffix?: string }) {
  return (
    <div className="row number-input">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      {suffix && <span className="muted number-input-unit">{suffix}</span>}
    </div>
  );
}
