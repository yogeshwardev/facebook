import React, { useState, useRef, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface Media {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
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

  return (
    <Layout>
      <div className="page-header">
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
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {media.map((item) => (
            <div key={item.id} className="card" style={{ padding: '0', overflow: 'hidden' }}>
              <video src={item.url} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover' }} controls />
              <div style={{ padding: '1rem' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.fileName}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
