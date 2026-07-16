import React, { useState, useRef, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface Media {
  id: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export default function MediaLibrary() {
  const [isUploading, setIsUploading] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMedia();
  }, []);

  const fetchMedia = async () => {
    try {
      const res = await api.get('/media');
      if (res.data.success) {
        setMedia(res.data.data.media);
      }
    } catch (err) {
      console.error('Failed to fetch media', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        setMedia(prev => [res.data.data.media, ...prev]);
      }
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

  return (
    <Layout>
      <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        <h1 className="page-title">Media Library</h1>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          style={{ display: 'none' }} 
          accept="video/*"
        />
        <button 
          className="btn btn-primary" 
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          style={{ width: '100%' }}
        >
          {isUploading ? 'Uploading...' : 'Upload New Reel'}
        </button>
      </div>

      {media.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>No Media Found</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Upload videos to your library to start scheduling reels.
          </p>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {media.map((item) => (
            <div key={item.id} className="card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <video 
                src={item.fileUrl} 
                style={{ width: '100%', aspectRatio: '9/16', objectFit: 'contain', backgroundColor: '#000' }} 
                controls 
                preload="metadata"
              />
              <div style={{ padding: '1rem' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Uploaded</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatDate(item.createdAt)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
