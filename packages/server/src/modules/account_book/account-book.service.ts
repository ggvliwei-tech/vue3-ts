// 导入依赖注入装饰器和未找到异常
import { Injectable, NotFoundException } from '@nestjs/common';
// 导入 Repository 注入装饰器
import { InjectRepository } from '@nestjs/typeorm';
// 导入 TypeORM 仓储接口，用于数据库操作
import { Repository } from 'typeorm';
// 导入 bcrypt 加密库，用于密码哈希
import * as bcrypt from 'bcrypt';
// 导入账本实体类
import { AccountBookEntity } from './entities/account-book.entity';
// 导入创建账本 DTO
import { CreateAccountBookDto } from './dto/create-account-book.dto';
// 导入更新账本 DTO
import { UpdateAccountBookDto } from './dto/update-account-book.dto';

// 标记为可注入的服务
@Injectable()
export class AccountBookService {
  // 构造函数注入依赖
  constructor(
    // 注入 AccountBookEntity 的 Repository，用于数据库操作
    @InjectRepository(AccountBookEntity)
    private readonly accountBookRepo: Repository<AccountBookEntity>,
  ) {}

  // 新增账本记录
  async create(dto: CreateAccountBookDto, userId: number) {
    // 使用 bcrypt 对密码进行哈希加密，saltRounds=10
    const hashPwd = await bcrypt.hash(dto.loginPassword, 10);
    // 创建账本实体实例，将加密后的密码替换原始密码，并关联用户 ID
    const record = this.accountBookRepo.create({
      ...dto,                    // 展开 DTO 数据
      loginPassword: hashPwd,    // 使用加密后的密码
      userId,                    // 关联创建人用户 ID
      createdAt: Date.now(),     // 创建时间
      updatedAt: Date.now(),     // 更新时间
    });
    // 将账本实体保存到数据库
    return this.accountBookRepo.save(record);
  }

  // 分页查询当前用户的账本列表
  async findAll(userId: number, page = 1, limit = 10) {
    // 计算跳过的记录数：(页码 - 1) × 每页数量
    const skip = (page - 1) * limit;
    // 查询当前用户的账本数据和总数
    const [list, total] = await this.accountBookRepo.findAndCount({
      where: { userId },                // 筛选当前用户的数据
      skip,                             // 跳过的记录数
      take: limit,                      // 每页数量
      order: { updatedAt: 'DESC' },     // 按更新时间倒序排列
    });
    // 返回分页结果
    return {
      list,     // 当前页数据列表
      total,    // 总记录数
      page,     // 当前页码
      limit,    // 每页数量
    };
  }

  // 根据 ID 和用户 ID 查询单条账本记录
  async findOne(id: number, userId: number) {
    // 根据 ID 和用户 ID 联合查询，确保只能查看自己的记录
    const item = await this.accountBookRepo.findOneBy({ id, userId });
    // 如果记录不存在，抛出未找到异常
    if (!item) throw new NotFoundException('记录不存在');
    return item;
  }

  // 更新账本记录
  async update(id: number, dto: UpdateAccountBookDto, userId: number) {
    // 先查询记录是否存在，并验证属于当前用户
    const item = await this.findOne(id, userId);

    // 如果传了新密码则加密，否则沿用旧密码
    if (dto.loginPassword) {
      dto.loginPassword = await bcrypt.hash(dto.loginPassword, 10);
    }

    // 将 DTO 中的字段合并到实体对象，同时更新 updatedAt
    Object.assign(item, dto, { updatedAt: Date.now() });
    // 保存更新后的实体到数据库
    return this.accountBookRepo.save(item);
  }

  // 删除账本记录
  async remove(id: number, userId: number) {
    // 先查询记录是否存在，并验证属于当前用户
    await this.findOne(id, userId);
    // 根据 ID 删除记录
    await this.accountBookRepo.delete(id);
    // 返回删除成功消息
    return { msg: '删除成功' };
  }
}
