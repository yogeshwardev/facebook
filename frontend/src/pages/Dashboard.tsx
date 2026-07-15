import React from 'react';
import Layout from '../components/Layout';

export default function Dashboard() {
  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>
      
      <div className="grid grid-cols-3">
        <div className="card">
          <h3 style={{ color: 'var(--text-secondary)' }}>Connected Accounts</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '0.5rem' }}>0</p>
        </div>
        <div className="card">
          <h3 style={{ color: 'var(--text-secondary)' }}>Scheduled Posts</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '0.5rem' }}>0</p>
        </div>
        <div className="card">
          <h3 style={{ color: 'var(--text-secondary)' }}>Published Posts</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '0.5rem' }}>0</p>
        </div>
      </div>
    </Layout>
  );
}
