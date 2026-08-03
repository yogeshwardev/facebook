import React, { useEffect, useState } from 'react';
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
  thumbnail_url?: string;
  permalink?: string;
  provider?: string;
  isSynced: boolean;
}

type FeedFilter = 'ALL' | 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';

export default function AccountFeedModal({ accountId, targetUsername, onClose }: AccountFeedModalProps) {
  const [feed, setFeed] = useState<FeedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [repostingId, setRepostingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [filter, setFilter] = useState<FeedFilter>('ALL');

  useEffect(() => {
    fetchFeed();
  }, []);

  const fetchFeed = async () => {
    try {
      const res = await api.get(`/monitor/${accountId}/feed?limit=48`);
      if (res.data.success) {
        setFeed(res.data.data.feed);
        if (res.data.message) setStatusMessage(res.data.message);
      }
    } catch (err: any) {
      setStatusMessage(err.response?.data?.message || 'Failed to fetch feed');
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
        caption: media.caption,
      });
      if (res.data.success) {
        alert('Reel downloaded and queued for publishing.');
        setFeed(feed.map(f => f.id === media.id ? { ...f, isSynced: true } : f));
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to repost');
    } finally {
      setRepostingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return 'Unknown date';
    }
  };

  const getMediaTypeLabel = (type: string) => {
    switch (type) {
      case 'VIDEO': return 'Reel';
      case 'CAROUSEL_ALBUM': return 'Carousel';
      case 'IMAGE': return 'Photo';
      default: return 'Post';
    }
  };

  const counts = {
    all: feed.length,
    videos: feed.filter(f => f.media_type === 'VIDEO').length,
    images: feed.filter(f => f.media_type === 'IMAGE').length,
    carousels: feed.filter(f => f.media_type === 'CAROUSEL_ALBUM').length,
  };

  const visibleFeed = filter === 'ALL' ? feed : feed.filter(item => item.media_type === filter);

  const renderMedia = (media: FeedMedia) => {
    const url = media.media_url || media.thumbnail_url || '';
    if (!url) {
      return (
        <div style={{
          width: '100%',
          aspectRatio: '1',
          backgroundColor: '#1a1a2e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: '0.9rem',
        }}>
          No preview available
        </div>
      );
    }

    if (media.media_type === 'VIDEO' && media.provider !== 'browser') {
      return (
        <video
          src={url}
          style={{ width: '100%', aspectRatio: '9/16', objectFit: 'contain', backgroundColor: '#000' }}
          controls
          preload="metadata"
        />
      );
    }

    return (
      <img
        src={url}
        alt={media.caption || 'Instagram post'}
        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', backgroundColor: '#000' }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      zIndex: 1000,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '2rem',
    }}>
      <div className="card" style={{
        width: '100%',
        maxWidth: '1100px',
        maxHeight: '90vh',
        overflowY: 'auto',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2>@{targetUsername}'s Feed</h2>
          <button className="btn" onClick={onClose} style={{ padding: '0.5rem 1rem' }}>Close</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>Loading feed...</div>
        ) : feed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            {statusMessage || 'No recent posts found on this account.'}
          </div>
        ) : (
          <>
            {statusMessage && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {statusMessage}
              </div>
            )}
            <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Found {counts.all} posts ({counts.videos} reels, {counts.images} photos, {counts.carousels} carousels)
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {[
                ['ALL', `All (${counts.all})`],
                ['VIDEO', `Reels (${counts.videos})`],
                ['IMAGE', `Photos (${counts.images})`],
                ['CAROUSEL_ALBUM', `Carousels (${counts.carousels})`],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setFilter(value as FeedFilter)}
                  style={{ padding: '0.5rem 0.9rem' }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {visibleFeed.map(media => (
                <div key={media.id} className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {renderMedia(media)}
                  <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      <span>{getMediaTypeLabel(media.media_type)}</span>
                      <span>{formatDate(media.timestamp)}</span>
                    </div>
                    {media.provider && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: 0 }}>
                        {media.provider}
                      </div>
                    )}
                    <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {media.caption || 'No caption'}
                    </p>
                    {media.permalink && (
                      <a href={media.permalink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        Open on Instagram
                      </a>
                    )}

                    {media.media_type === 'VIDEO' && media.provider !== 'browser' && (
                      <button
                        className="btn btn-primary"
                        style={{ width: '100%', backgroundColor: media.isSynced ? '#4ade80' : undefined }}
                        onClick={() => handleRepost(media)}
                        disabled={media.isSynced || repostingId === media.id}
                      >
                        {repostingId === media.id
                          ? 'Downloading...'
                          : media.isSynced
                            ? 'Already Reposted'
                            : 'Repost to My Page'}
                      </button>
                    )}
                    {media.media_type === 'VIDEO' && media.provider === 'browser' && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Preview only. Open on Instagram or use Apify to fetch the video file.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
