import { StorageService } from './StorageService';
import { LocalStorageProvider } from './LocalStorageProvider';
import { S3StorageProvider } from './S3StorageProvider';

const useS3 = process.env.NODE_ENV === 'production' && process.env.AWS_ACCESS_KEY_ID;

export const storageProvider: StorageService = useS3 
  ? new S3StorageProvider() 
  : new LocalStorageProvider();
