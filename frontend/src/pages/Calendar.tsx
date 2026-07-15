import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface Post {
  id: string;
  caption: string;
  status: string;
  scheduledTime: string;
  media: { url: string };
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

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Calendar</h1>
      </div>
      
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3>Upcoming Scheduled Posts</h3>
        </div>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            No upcoming posts scheduled.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {posts.map(post => (
              <li key={post.id} style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
                <strong>{new Date(post.scheduledTime).toLocaleString()}</strong> - {post.caption}
                <span style={{ float: 'right', color: 'var(--accent-primary)' }}>{post.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
