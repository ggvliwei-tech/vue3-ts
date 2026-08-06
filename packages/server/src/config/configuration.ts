// 环境变量读取辅助函数：读取指定 key 的值，如果不存在则抛出错误
const getEnv = (key: string): string => {
  const val = process.env[key]; // 从 process.env 中获取环境变量
  if (!val) {
    // 如果变量不存在，抛出错误提示需要检查 .env 配置
    throw new Error(`环境变量 ${key} 未在 .env 文件中配置，请检查！`);
  }
  return val; // 返回环境变量值
};

// 导出配置函数，NestJS ConfigModule 会调用此函数加载配置
export default () => ({
  // 应用端口号，默认 3000，转换为数字类型
  APP_PORT: parseInt(process.env.APP_PORT || '3000', 10),
  // 数据库主机地址（必填）
  DB_HOST: getEnv('DB_HOST'),
  // 数据库端口号，默认 3306，转换为数字类型
  DB_PORT: parseInt(getEnv('DB_PORT') || '3306', 10),
  // 数据库用户名（必填）
  DB_USER: getEnv('DB_USER'),
  // 数据库密码（必填）
  DB_PWD: getEnv('DB_PWD'),
  // 数据库名称（必填）
  DB_NAME: getEnv('DB_NAME'),

  // JWT 相关配置（双 Token 机制）
  JWT_ACCESS_SECRET: getEnv('JWT_ACCESS_SECRET'),              // Access Token 签名密钥（必填）
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '30m',  // Access Token 过期时间，默认 30 分钟
  JWT_REFRESH_SECRET: getEnv('JWT_REFRESH_SECRET'),            // Refresh Token 签名密钥（必填）
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d', // Refresh Token 过期时间，默认 7 天

  // 阿里云 OSS 配置（选填，未配置时降级为本地存储）
  OSS_REGION: process.env.OSS_REGION || '',                       // OSS 所在区域
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID || '',         // OSS 访问密钥 ID
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET || '', // OSS 访问密钥 Secret
  OSS_BUCKET: process.env.OSS_BUCKET || '',                       // OSS Bucket 名称
  OSS_BASE_URL: process.env.OSS_BASE_URL || '',                   // OSS 基础 URL
  OSS_CDN_DOMAIN: process.env.OSS_CDN_DOMAIN || '',               // CDN 域名前缀
  OSS_UPLOAD_FOLDER: process.env.OSS_UPLOAD_FOLDER || 'uploads',  // OSS 上传文件夹前缀
});

