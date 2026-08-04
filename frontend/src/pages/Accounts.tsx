import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../utils/api';

interface Account {
  id: string;
  instagramId: string;
  username: string;
  profilePicture: string;
  status: string;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAccounts();
    
    if (searchParams.get('success')) {
      setMessage('Account connected successfully!');
    }
    if (searchParams.get('error')) {
      setError(`Failed to connect account: ${searchParams.get('error')}`);
    }
  }, [searchParams]);

  const fetchAccounts = async () => {
    try {
      const res = await api.get('/accounts');
      if (res.data.success) {
        setAccounts(res.data.data.accounts);
      }
    } catch (err) {
      console.error('Failed to fetch accounts', err);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await api.get('/accounts/connect');
      if (res.data.success) {
        window.location.href = res.data.data.url;
      }
    } catch (err) {
      setError('Failed to generate secure login URL. Is the backend running?');
      console.error(err);
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Connected Accounts</h1>
        <button onClick={handleConnect} className="btn btn-primary" style={{ width: 'auto' }}>
          Connect Instagram
        </button>
      </div>

      {message && <div style={{ padding: '1rem', background: 'rgba(46, 213, 115, 0.1)', color: 'var(--success)', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(46, 213, 115, 0.2)' }}>{message}</div>}
      {error && <div style={{ padding: '1rem', background: 'rgba(255, 71, 87, 0.1)', color: 'var(--danger)', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(255, 71, 87, 0.2)' }}>{error}</div>}

      {accounts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>No Accounts Connected</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Connect your Instagram Business or Creator accounts to start scheduling reels.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2">
          {accounts.map(acc => (
            <div key={acc.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {acc.profilePicture ? (
                <img src={acc.profilePicture} alt={acc.username} style={{ width: '48px', height: '48px', borderRadius: '50%' }} />
              ) : (
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)' }} />
              )}
              <div>
                <h4>@{acc.username}</h4>
                <span style={{ fontSize: '0.875rem', color: 'var(--success)' }}>{acc.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
