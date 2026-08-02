import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface ConnectedAccount {
  id: string;
  username: string;
  profilePicture?: string;
}

interface MediaItem {
  id: string;
  source: 'APP' | 'INSTAGRAM';
  accountUsername?: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  media_url: string;
  caption: string;
  permalink?: string;
  status: string;
  timestamp: string;
}

export default function MyPage() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'VIDEO' | 'IMAGE'>('ALL');

  useEffect(() => {
    fetchMyPageData();
  }, []);

  const fetchMyPageData = async () => {
    try {
      const res = await api.get('/accounts/my-page');
      if (res.data.success) {
        setAccounts(res.data.data.accounts || []);
        setMedia(res.data.data.media || []);
      }
    } catch (err) {
      console.error('Failed to fetch My Page media:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMedia = media.filter(item => {
    if (filter === 'VIDEO') return item.media_type === 'VIDEO';
    if (filter === 'IMAGE') return item.media_type === 'IMAGE' || item.media_type === 'CAROUSEL_ALBUM';
    return true;
  });

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  return (
    <Layout>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Page Header */}
        <div className="card" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem' }}>My Page</h1>
            <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)' }}>
              View all your published Reels, videos, and posts from your connected Instagram page and app library.
            </p>
          </div>

          {/* Connected Instagram Accounts Badges */}
          {accounts.length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {accounts.map(acc => (
                <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {acc.profilePicture ? (
                    <img src={acc.profilePicture} alt={acc.username} style={{ width: 26, height: 26, borderRadius: '50%' }} />
                  ) : (
                    <span style={{ fontSize: '1.1rem' }}>📸</span>
                  )}
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>@{acc.username}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <button 
            className="btn" 
            style={{ backgroundColor: filter === 'ALL' ? 'var(--primary)' : 'rgba(255,255,255,0.05)' }}
            onClick={() => setFilter('ALL')}
          >
            All Posts ({media.length})
          </button>
          <button 
            className="btn" 
            style={{ backgroundColor: filter === 'VIDEO' ? 'var(--primary)' : 'rgba(255,255,255,0.05)' }}
            onClick={() => setFilter('VIDEO')}
          >
            🎬 Reels & Videos ({media.filter(m => m.media_type === 'VIDEO').length})
          </button>
          <button 
            className="btn" 
            style={{ backgroundColor: filter === 'IMAGE' ? 'var(--primary)' : 'rgba(255,255,255,0.05)' }}
            onClick={() => setFilter('IMAGE')}
          >
            🖼️ Photos ({media.filter(m => m.media_type !== 'VIDEO').length})
          </button>
        </div>

        {/* Media Grid */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            Loading your page content...
          </div>
        ) : filteredMedia.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            No posts or reels found on your page yet.
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {filteredMedia.map(item => (
              <div key={item.id} className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Media Preview */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '9/16', backgroundColor: '#000' }}>
                  {item.media_type === 'VIDEO' ? (
                    <video 
                      src={item.media_url} 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                      controls 
                      preload="metadata"
                    />
                  ) : (
                    <img 
                      src={item.media_url} 
                      alt="Post content" 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    />
                  )}
                  {/* Badge */}
                  <span style={{ 
                    position: 'absolute', top: 10, left: 10, 
                    backgroundColor: item.source === 'INSTAGRAM' ? 'rgba(225, 48, 108, 0.9)' : 'rgba(74, 222, 128, 0.9)', 
                    color: '#fff', fontSize: '0.75rem', fontWeight: 'bold', 
                    padding: '0.25rem 0.6rem', borderRadius: '12px' 
                  }}>
                    {item.source === 'INSTAGRAM' ? `Instagram (@${item.accountUsername || 'live'})` : `App (${item.status})`}
                  </span>
                </div>

                {/* Content Details */}
                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    {formatDate(item.timestamp)}
                  </div>
                  <p style={{ 
                    margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-primary)', 
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', 
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' 
                  }}>
                    {item.caption || 'No caption'}
                  </p>

                  {item.permalink && (
                    <a 
                      href={item.permalink} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="btn" 
                      style={{ textDecoration: 'none', textAlign: 'center', fontSize: '0.85rem', padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.08)' }}
                    >
                      View on Instagram ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
