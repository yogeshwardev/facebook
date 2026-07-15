import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/layout.css';

export default function Sidebar() {
  const location = useLocation();

  const links = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Connected Accounts', path: '/accounts' },
    { name: 'Media Library', path: '/media' },
    { name: 'Upload Reel', path: '/upload' },
    { name: 'Calendar', path: '/calendar' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>ReelScheduler</h2>
      </div>
      <nav className="sidebar-nav">
        {links.map(link => (
          <Link
            key={link.path}
            to={link.path}
            className={`nav-link ${location.pathname === link.path ? 'active' : ''}`}
          >
            {link.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
