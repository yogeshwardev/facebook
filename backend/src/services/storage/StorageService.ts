export interface StorageService {
  uploadFile(file: Express.Multer.File, folder?: string): Promise<string>;
  deleteFile(fileUrl: string): Promise<boolean>;
}
