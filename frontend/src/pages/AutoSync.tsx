import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface MonitoredAccount {
  id: string;
  targetUsername: string;
  isActive: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

export default function AutoSync() {
  const [accounts, setAccounts] = useState<MonitoredAccount[]>([]);
  const [newHandle, setNewHandle] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await api.get('/monitor');
      if (res.data.success) {
        setAccounts(res.data.data.accounts);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHandle) return;

    try {
      const res = await api.post('/monitor', { targetUsername: newHandle });
      if (res.data.success) {
        setAccounts([res.data.data.account, ...accounts]);
        setNewHandle('');
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add account');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Stop monitoring this account?')) return;
    try {
      await api.delete(`/monitor/${id}`);
      setAccounts(accounts.filter(a => a.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStatus = async (id: string, isActive: boolean) => {
    try {
      const res = await api.patch(`/monitor/${id}/status`, { isActive });
      if (res.data.success) {
        setAccounts(accounts.map(a => a.id === id ? res.data.data.account : a));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Auto-Sync Watchlist</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          Automatically download and repost reels from monitored Business/Creator accounts.
        </p>
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3>Add Instagram Handle</h3>
        <form onSubmit={handleAddAccount} style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <input
              type="text"
              className="form-control"
              placeholder="@username"
              value={newHandle}
              onChange={(e) => setNewHandle(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ padding: '0 2rem' }}>
            Add to Watchlist
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Monitored Accounts</h3>
        {loading ? (
          <p>Loading...</p>
        ) : accounts.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>No accounts are being monitored yet.</p>
        ) : (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {accounts.map(acc => (
              <div key={acc.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.02)'
              }}>
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    @{acc.targetUsername}
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      backgroundColor: acc.isActive ? '#4ade8020' : '#f8717120',
                      color: acc.isActive ? '#4ade80' : '#f87171'
                    }}>
                      {acc.isActive ? 'Active' : 'Paused'}
                    </span>
                  </h4>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Last checked: {acc.lastCheckedAt ? new Date(acc.lastCheckedAt).toLocaleString() : 'Never'}
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => toggleStatus(acc.id, !acc.isActive)}
                    style={{ padding: '0.5rem 1rem' }}
                  >
                    {acc.isActive ? 'Pause' : 'Resume'}
                  </button>
                  <button 
                    className="btn"
                    onClick={() => handleDelete(acc.id)}
                    style={{ padding: '0.5rem 1rem', backgroundColor: '#ef444420', color: '#ef4444' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
