// 注入装饰器
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
// 注入 TypeORM Repository
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Like } from 'typeorm'
// 权限实体
import { PermissionEntity } from '../../rbac/entities/permission.entity'
// 角色-权限关联实体
import { RolePermissionEntity } from '../../rbac/entities/role-permission.entity'
// DTO
import { CreatePermissionDto } from './dto/create-permission.dto'
import { UpdatePermissionDto } from './dto/update-permission.dto'

/**
 * 权限管理服务
 *
 * 职责：
 *  - 权限 CRUD
 *  - 删除时同步清理 sys_role_permission 关联
 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermRepo: Repository<RolePermissionEntity>,
  ) {}

  /**
   * 分页查询权限列表
   */
  async findAll(page = 1, pageSize = 20, filters?: { keyword?: string; module?: string }) {
    const qb = this.permRepo.createQueryBuilder('p')
    if (filters?.keyword) {
      qb.andWhere('p.code LIKE :kw OR p.name LIKE :kw', { kw: `%${filters.keyword}%` })
    }
    if (filters?.module) {
      qb.andWhere('p.module = :module', { module: filters.module })
    }
    qb.orderBy('p.module', 'ASC').addOrderBy('p.createTime', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  /**
   * 全部权限（按模块分组，前端权限树使用）
   */
  async findAllGroupedByModule(): Promise<Record<string, PermissionEntity[]>> {
    const all = await this.permRepo.find({ order: { module: 'ASC', createTime: 'ASC' } })
    return all.reduce((acc, p) => {
      if (!acc[p.module]) acc[p.module] = []
      acc[p.module].push(p)
      return acc
    }, {} as Record<string, PermissionEntity[]>)
  }

  /**
   * 查询所有模块（用于筛选下拉框）
   */
  async findAllModules(): Promise<string[]> {
    const rows = await this.permRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.module', 'module')
      .where("p.module <> ''")
      .getRawMany<{ module: string }>()
    return rows.map((r) => r.module)
  }

  /**
   * 权限详情
   */
  async findOne(id: number) {
    const perm = await this.permRepo.findOne({ where: { id } })
    if (!perm) throw new NotFoundException(`权限不存在：id=${id}`)
    return perm
  }

  /**
   * 创建权限
   */
  async create(dto: CreatePermissionDto): Promise<PermissionEntity> {
    const exists = await this.permRepo.findOne({ where: { code: dto.code } })
    if (exists) throw new ConflictException(`权限编码已存在：${dto.code}`)

    const perm = this.permRepo.create({
      code: dto.code,
      name: dto.name,
      module: dto.module,
      description: dto.description,
      createTime: Date.now(),
    })
    return this.permRepo.save(perm)
  }

  /**
   * 更新权限（不允许改 code，code 是身份标识）
   */
  async update(id: number, dto: UpdatePermissionDto): Promise<PermissionEntity> {
    const perm = await this.permRepo.findOne({ where: { id } })
    if (!perm) throw new NotFoundException(`权限不存在：id=${id}`)
    Object.assign(perm, dto)
    return this.permRepo.save(perm)
  }

  /**
   * 删除权限
   * - 同步清理 sys_role_permission 关联
   * - 注意：删除后所有角色失去该权限，需提醒 admin
   */
  async remove(id: number): Promise<void> {
    const perm = await this.permRepo.findOne({ where: { id } })
    if (!perm) throw new NotFoundException(`权限不存在：id=${id}`)

    // 查该权限被多少角色持有
    const usageCount = await this.rolePermRepo.count({ where: { permissionId: id } })
    if (usageCount > 0) {
      throw new BadRequestException(`该权限被 ${usageCount} 个角色引用，请先解除绑定`)
    }

    await this.permRepo.delete({ id })
  }
}
