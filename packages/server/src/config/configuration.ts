// 环境变量读取辅助函数：读取指定 key 的值，不存在则抛出错误
const getEnv = (key: string): string => { // 定义获取环境变量的辅助函数
  const val = process.env[key]; // 从 process.env 对象中读取指定 key 的环境变量
  if (!val) { // 如果环境变量值为空
    throw new Error(`环境变量 ${key} 未在 .env 文件中配置，请检查！`); // 抛出错误提示用户检查 .env 配置
  }
  return val; // 返回获取到的环境变量值
};

export default () => ({ // 导出配置函数，NestJS ConfigModule 会调用此函数加载配置
  APP_PORT: parseInt(process.env.APP_PORT || '3000', 10), // 应用端口号，从环境变量读取，默认 3000
  DB_HOST: getEnv('DB_HOST'), // 数据库主机地址（必填）
  DB_PORT: parseInt(getEnv('DB_PORT') || '3306', 10), // 数据库端口号，默认 3306
  DB_USER: getEnv('DB_USER'), // 数据库用户名（必填）
  DB_PWD: getEnv('DB_PWD'), // 数据库密码（必填）
  DB_NAME: getEnv('DB_NAME'), // 数据库名称（必填）

  JWT_ACCESS_SECRET: getEnv('JWT_ACCESS_SECRET'), // Access Token 签名密钥（必填）
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '30m', // Access Token 过期时间，默认 30 分钟
  JWT_REFRESH_SECRET: getEnv('JWT_REFRESH_SECRET'), // Refresh Token 签名密钥（必填）
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d', // Refresh Token 过期时间，默认 7 天

  OSS_REGION: process.env.OSS_REGION || '', // OSS 所在区域（选填）
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID || '', // OSS 访问密钥 ID（选填）
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET || '', // OSS 访问密钥 Secret（选填）
  OSS_BUCKET: process.env.OSS_BUCKET || '', // OSS Bucket 名称（选填）
  OSS_BASE_URL: process.env.OSS_BASE_URL || '', // OSS 基础 URL（选填）
  OSS_CDN_DOMAIN: process.env.OSS_CDN_DOMAIN || '', // CDN 域名前缀（选填）
  OSS_UPLOAD_FOLDER: process.env.OSS_UPLOAD_FOLDER || 'uploads', // OSS 上传文件夹前缀，默认 uploads

  CORS_ORIGINS: getEnv('CORS_ORIGINS').split(',').map(s => s.trim()), // CORS 跨域白名单，逗号分隔并去除空格
});

