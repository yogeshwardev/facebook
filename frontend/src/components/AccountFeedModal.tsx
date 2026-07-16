import React, { useState, useEffect } from 'react';
import api from '../utils/api';

interface AccountFeedModalProps {
  accountId: string;
  targetUsername: string;
  onClose: () => void;
}

interface FeedMedia {
  id: string;
  media_type: string;
  media_url: string;
  caption: string;
  timestamp: string;
  isSynced: boolean;
}

export default function AccountFeedModal({ accountId, targetUsername, onClose }: AccountFeedModalProps) {
  const [feed, setFeed] = useState<FeedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [repostingId, setRepostingId] = useState<string | null>(null);

  useEffect(() => {
    fetchFeed();
  }, []);

  const fetchFeed = async () => {
    try {
      const res = await api.get(`/monitor/${accountId}/feed`);
      if (res.data.success) {
        setFeed(res.data.data.feed);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to fetch feed');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleRepost = async (media: FeedMedia) => {
    setRepostingId(media.id);
    try {
      const res = await api.post(`/monitor/${accountId}/repost`, {
        mediaId: media.id,
        mediaUrl: media.media_url,
        caption: media.caption
      });
      if (res.data.success) {
        alert('Reel downloaded and queued for publishing!');
        // Update local state to show it's synced
        setFeed(feed.map(f => f.id === media.id ? { ...f, isSynced: true } : f));
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to repost');
    } finally {
      setRepostingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      zIndex: 1000,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      padding: '2rem'
    }}>
      <div className="card" style={{
        width: '100%', maxWidth: '1000px', maxHeight: '90vh',
        overflowY: 'auto', position: 'relative',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2>@{targetUsername}'s Recent Reels</h2>
          <button className="btn" onClick={onClose} style={{ padding: '0.5rem 1rem' }}>Close</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>Loading feed...</div>
        ) : feed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            No recent reels found on this account.
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {feed.map(media => (
              <div key={media.id} className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <video 
                  src={media.media_url} 
                  style={{ width: '100%', aspectRatio: '9/16', objectFit: 'contain', backgroundColor: '#000' }} 
                  controls 
                  preload="metadata"
                />
                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    {formatDate(media.timestamp)}
                  </div>
                  <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                    {media.caption || 'No caption'}
                  </p>
                  
                  <button 
                    className="btn btn-primary" 
                    style={{ width: '100%', backgroundColor: media.isSynced ? '#4ade80' : undefined }}
                    onClick={() => handleRepost(media)}
                    disabled={media.isSynced || repostingId === media.id}
                  >
                    {repostingId === media.id 
                      ? 'Downloading...' 
                      : media.isSynced 
                        ? '✅ Already Reposted' 
                        : 'Repost to My Page'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
