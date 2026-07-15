import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

interface Media {
  id: string;
  fileName: string;
}

interface Account {
  id: string;
  username: string;
}

export default function UploadReel() {
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mediaId, setMediaId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [caption, setCaption] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [mediaRes, accRes] = await Promise.all([
        api.get('/media'),
        api.get('/accounts')
      ]);
      if (mediaRes.data.success) setMediaList(mediaRes.data.data.media);
      if (accRes.data.success) setAccounts(accRes.data.data.accounts);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaId || !accountId || !scheduledTime) return;

    setLoading(true);
    try {
      const res = await api.post('/posts/schedule', {
        mediaId,
        caption,
        scheduledTime: new Date(scheduledTime).toISOString(),
        accountIds: [accountId]
      });
      
      if (res.data.success) {
        navigate('/calendar');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to schedule post');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Schedule Reel</h1>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <form onSubmit={handleUpload}>
          
          <div className="input-group">
            <label className="input-label">Select Media</label>
            <select className="input-field" value={mediaId} onChange={e => setMediaId(e.target.value)} required>
              <option value="">-- Select a Video --</option>
              {mediaList.map(m => (
                <option key={m.id} value={m.id}>{m.fileName}</option>
              ))}
            </select>
            {mediaList.length === 0 && <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem' }}>Upload media in the Media Library first.</small>}
          </div>

          <div className="input-group">
            <label className="input-label">Select Account</label>
            <select className="input-field" value={accountId} onChange={e => setAccountId(e.target.value)} required>
              <option value="">-- Select Instagram Account --</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>@{a.username}</option>
              ))}
            </select>
            {accounts.length === 0 && <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem' }}>Connect an account in the Accounts page first.</small>}
          </div>

          <div className="input-group">
            <label className="input-label">Caption</label>
            <textarea 
              className="input-field" 
              value={caption} 
              onChange={e => setCaption(e.target.value)} 
              rows={4}
              placeholder="Write your caption here..."
            />
          </div>

          <div className="input-group">
            <label className="input-label">Scheduled Time</label>
            <input 
              type="datetime-local" 
              className="input-field" 
              value={scheduledTime} 
              onChange={e => setScheduledTime(e.target.value)} 
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary" disabled={loading || !mediaId || !accountId || !scheduledTime}>
            {loading ? 'Scheduling...' : 'Schedule Reel'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
