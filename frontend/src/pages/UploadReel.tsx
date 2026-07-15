import React, { useState } from 'react';
import Layout from '../components/Layout';
import { useNavigate } from 'react-router-dom';

export default function UploadReel() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    try {
      alert('File upload started...');
      
      setTimeout(() => {
        setUploading(false);
        navigate('/media');
      }, 1500);
    } catch (err) {
      console.error(err);
      setUploading(false);
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Upload Reel</h1>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <form onSubmit={handleUpload}>
          <div className="input-group">
            <label className="input-label" htmlFor="videoFile">Select Video (MP4, MOV)</label>
            <input 
              id="videoFile"
              type="file"
              accept="video/mp4,video/quicktime"
              className="input-field" 
              onChange={handleFileChange}
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary" disabled={!file || uploading}>
            {uploading ? 'Uploading...' : 'Upload Video'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
