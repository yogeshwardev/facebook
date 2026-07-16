import { StorageService } from './StorageService';
import fs from 'fs/promises';
import path from 'path';

export class LocalStorageProvider implements StorageService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor() {
    // Ensure upload directory exists
    fs.mkdir(this.uploadDir, { recursive: true }).catch(console.error);
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'media'): Promise<string> {
    const targetDir = path.join(this.uploadDir, folder);
    await fs.mkdir(targetDir, { recursive: true });

    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const targetPath = path.join(targetDir, filename);

    await fs.copyFile(file.path, targetPath);
    await fs.unlink(file.path); // Remove temp file

    // Return a local URL accessible via static route (proxied under /api)
    return `/api/uploads/${folder}/${filename}`;
  }

  async deleteFile(fileUrl: string): Promise<boolean> {
    try {
      if (!fileUrl.startsWith('/api/uploads/')) return false;
      const relativePath = fileUrl.replace('/api/uploads/', '');
      const fullPath = path.join(this.uploadDir, relativePath);
      await fs.unlink(fullPath);
      return true;
    } catch (e) {
      return false;
    }
  }
}
