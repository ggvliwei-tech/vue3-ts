// 文件上传结果接口，定义上传成功后的返回数据结构
export interface UploadResult {
  filePath: string; // 文件存储的相对路径
  url: string;      // 文件可访问的完整 URL
  saveName: string; // 服务器保存的文件名
}

// 文件存储策略接口，定义上传和删除的抽象方法
export interface FileStorage {
  // 上传文件方法，接收文件对象和可选的文件夹标识，返回上传结果
  upload(file: Express.Multer.File, folder?: string): Promise<UploadResult>;
  // 删除文件方法，接收文件路径，返回是否删除成功
  delete(filePath: string): Promise<boolean>;
}
