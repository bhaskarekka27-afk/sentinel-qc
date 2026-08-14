import React from 'react';
import { LayoutDashboard, ScanSearch, BrainCircuit, Bot, Settings, Sun, Moon, ShieldCheck } from 'lucide-react';

const NAV = [
  { group: 'Workspace', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'analyze', label: 'Analyze Content', icon: ScanSearch },
    { id: 'detector', label: 'AI Detector', icon: Bot },
  ]},
  { group: 'Configuration', items: [
    { id: 'models', label: 'Models & Training', icon: BrainCircuit },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]},
];

export default function Sidebar({ active, onNavigate, theme, onToggleTheme, examCount }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><ShieldCheck size={21} /></div>
        <div>
          <div className="brand-name">Sentinel QC</div>
          <div className="brand-sub">Content Quality Control</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((section) => (
          <React.Fragment key={section.group}>
            <div className="nav-label">{section.group}</div>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  className={`nav-item ${active === item.id ? 'active' : ''}`}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {item.id === 'models' && examCount != null && (
                    <span className="badge-count">{examCount}</span>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div
          className="nav-item"
          onClick={onToggleTheme}
          role="button"
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </div>
        <div className="user-chip">
          <div className="avatar">QC</div>
          <div>
            <div className="user-name">QC Reviewer</div>
            <div className="user-role">Content Team</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
