import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface Post {
  id: string;
  caption: string;
  status: string;
  scheduledTime: string;
  media: { fileUrl: string };
}

export default function Calendar() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await api.get('/posts');
      if (res.data.success) {
        setPosts(res.data.data.posts);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PUBLISHED': return '#4ade80'; // Green
      case 'FAILED': return '#f87171'; // Red
      case 'SCHEDULED': return '#60a5fa'; // Blue
      default: return 'var(--text-secondary)';
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Calendar</h1>
      </div>
      
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h3>Upcoming Scheduled Posts</h3>
        </div>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            No upcoming posts scheduled.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {posts.map(post => (
              <div key={post.id} style={{ 
                display: 'flex', 
                gap: '1rem', 
                padding: '1rem', 
                border: '1px solid var(--glass-border)',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                alignItems: 'center',
                flexWrap: 'wrap'
              }}>
                <video 
                  src={post.media?.fileUrl} 
                  style={{ width: '80px', height: '142px', objectFit: 'cover', borderRadius: '8px', backgroundColor: '#000' }} 
                  muted
                  controls
                />
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--accent-primary)' }}>
                    {formatDate(post.scheduledTime)}
                  </div>
                  <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {post.caption || 'No caption'}
                  </p>
                  <span style={{ 
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem', 
                    borderRadius: '999px', 
                    fontSize: '0.85rem', 
                    fontWeight: 600,
                    backgroundColor: `${getStatusColor(post.status)}20`,
                    color: getStatusColor(post.status) 
                  }}>
                    {post.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
