import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Popover } from './ui.jsx';
import { presetTimes, toLocalInput } from '../lib/utils.js';

// Popover with Gmail-style presets plus a custom date & time.
export default function TimePicker({ open, onClose, onPick, title, align = 'left' }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(new Date(Date.now() + 3600e3)));
  const close = () => { setCustom(false); onClose(); };

  return (
    <Popover open={open} onClose={close} align={align} className="time-picker">
      <div className="popover-title">{title}</div>
      {!custom ? (
        <>
          {presetTimes().map((p) => (
            <button key={p.label} type="button" className="menu-item" onClick={() => { onPick(p.date); close(); }}>
              <span>{p.label}</span>
              <small>{p.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" className="menu-item" onClick={() => setCustom(true)}>
            <CalendarDays size={16} /><span>Pick date &amp; time</span>
          </button>
        </>
      ) : (
        <div className="custom-time">
          <input type="datetime-local" className="input" value={value} min={toLocalInput(new Date())} onChange={(e) => setValue(e.target.value)} />
          <div className="row-end">
            <button type="button" className="btn ghost sm" onClick={() => setCustom(false)}>Back</button>
            <button
              type="button"
              className="btn primary sm"
              onClick={() => {
                const d = new Date(value);
                if (!isNaN(d) && d > new Date()) { onPick(d); close(); }
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
