import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';

interface Account {
  id: string;
  instagramId: string;
  username: string;
  profilePicture: string;
  status: string;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  const handleConnect = async () => {
    try {
      // Logic to fetch OAuth URL from backend
      alert('OAuth flow initiated. Redirecting to Meta...');
    } catch (err) {
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
