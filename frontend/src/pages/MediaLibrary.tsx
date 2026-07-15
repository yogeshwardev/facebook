import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Link } from 'react-router-dom';

interface Media {
  id: string;
  fileUrl: string;
  uploadStatus: string;
  createdAt: string;
}

export default function MediaLibrary() {
  const [mediaItems, setMediaItems] = useState<Media[]>([]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Media Library</h1>
        <Link to="/upload" className="btn btn-primary" style={{ width: 'auto' }}>
          Upload New Reel
        </Link>
      </div>

      {mediaItems.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>No Media Found</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            You haven't uploaded any videos yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3">
          {mediaItems.map(media => (
            <div key={media.id} className="card" style={{ overflow: 'hidden', padding: 0 }}>
              <video src={media.fileUrl} controls style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover' }} />
              <div style={{ padding: '1rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--success)' }}>{media.uploadStatus}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
