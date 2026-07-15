import { Router } from 'express';
import multer from 'multer';
import { uploadMedia, getMediaLibrary } from '../controllers/media.controller';
import { authenticate } from '../middleware/auth';
import os from 'os';

const router = Router();
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

router.post('/upload', authenticate, upload.single('file'), uploadMedia);
router.get('/', authenticate, getMediaLibrary);

export default router;
