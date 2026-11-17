import { forwardRef, useEffect, useState } from 'react';
import { Menu, Search, X, Settings, HelpCircle, LogOut, Mail, Moon, Sun } from 'lucide-react';
import { Avatar, IconButton, Popover, MenuItem } from './ui.jsx';
import { displayName } from '../lib/utils.js';

const TopBar = forwardRef(function TopBar(
  { me, onMenu, onSearch, searchValue, onSettings, onShortcuts, onSignOut, theme, onToggleTheme, onHome },
  searchRef
) {
  const [q, setQ] = useState(searchValue || '');
  const [open, setOpen] = useState(false);
  useEffect(() => setQ(searchValue || ''), [searchValue]);

  const submit = (e) => { e.preventDefault(); onSearch(q.trim()); };
  const dark = theme === 'dark';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <IconButton icon={Menu} label="Main menu" onClick={onMenu} size={20} />
        <button className="brand" onClick={onHome}>
          <span className="brand-mark"><Mail size={18} /></span>
          <span className="brand-text">DAPP <b>Mail</b></span>
        </button>
      </div>

      <form className="search" onSubmit={submit} role="search">
        <button type="submit" className="icon-btn" aria-label="Search"><Search size={18} /></button>
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); onSearch(''); e.currentTarget.blur(); } }}
          placeholder="Search mail"
          aria-label="Search mail"
        />
        {q && <IconButton icon={X} label="Clear search" onClick={() => { setQ(''); onSearch(''); }} />}
      </form>

      <div className="topbar-right">
        <IconButton icon={dark ? Sun : Moon} label={dark ? 'Light mode' : 'Dark mode'} onClick={onToggleTheme} className="hide-sm" />
        <IconButton icon={HelpCircle} label="Keyboard shortcuts (?)" onClick={onShortcuts} className="hide-sm" />
        <IconButton icon={Settings} label="Settings" onClick={onSettings} className="hide-sm" />
        <div className="relative">
          <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label="Account">
            <Avatar person={me} size={34} />
          </button>
          <Popover open={open} onClose={() => setOpen(false)} align="right" className="account-menu">
            <div className="account-card">
              <Avatar person={me} size={56} />
              <b>{displayName(me)}</b>
              <small>{me?.email}</small>
            </div>
            <MenuItem icon={Settings} onClick={() => { setOpen(false); onSettings(); }}>Settings</MenuItem>
            <MenuItem icon={dark ? Sun : Moon} onClick={() => { setOpen(false); onToggleTheme(); }}>{dark ? 'Light mode' : 'Dark mode'}</MenuItem>
            <MenuItem icon={LogOut} onClick={onSignOut}>Sign out</MenuItem>
          </Popover>
        </div>
      </div>
    </header>
  );
});

export default TopBar;
