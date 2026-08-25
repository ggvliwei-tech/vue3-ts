// 导入 NestJS 模块装饰器
import { Module } from '@nestjs/common';
// 导入 TypeORM 模块，用于注册实体 Repository
import { TypeOrmModule } from '@nestjs/typeorm';
// 导入账本服务，处理业务逻辑
import { AccountBookService } from './account-book.service';
// 导入账本控制器，处理 HTTP 请求
import { AccountBookController } from './account-book.controller';
// 导入账本实体类，映射数据库表
import { AccountBookEntity } from './entities/account-book.entity';

// 账本模块定义，封装账本相关功能
@Module({
  imports: [
    // 注册 AccountBookEntity 实体到当前模块
    TypeOrmModule.forFeature([AccountBookEntity]),
  ],
  // 注册控制器，处理路由和请求
  controllers: [AccountBookController],
  // 注册服务，处理数据库操作和业务逻辑
  providers: [AccountBookService],
})
// 导出账本模块类
export class AccountBookModule {}
