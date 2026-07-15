import { StorageService } from './StorageService';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';

export class S3StorageProvider implements StorageService {
  private s3Client: S3Client;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.AWS_BUCKET_NAME || '';
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'media'): Promise<string> {
    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const key = `${folder}/${filename}`;

    const fileBuffer = await fs.readFile(file.path);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: file.mimetype,
      })
    );

    await fs.unlink(file.path); // Clean temp file

    return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  async deleteFile(fileUrl: string): Promise<boolean> {
    try {
      const url = new URL(fileUrl);
      const key = url.pathname.substring(1); // Remove leading slash
      
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key
        })
      );
      return true;
    } catch (e) {
      return false;
    }
  }
}
