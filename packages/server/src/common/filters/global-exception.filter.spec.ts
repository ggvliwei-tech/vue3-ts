/**
 * GlobalExceptionFilter 单元测试
 *
 * 测试目标：
 *  1. BusinessException 透传业务码 + 自定义 msg/data
 *  2. 内置 HttpException（BadRequest/NotFound/Unauthorized 等）正确映射
 *  3. ValidationPipe 的 message 数组 → PARAM_INVALID + errors
 *  4. TypeORM QueryFailedError + ER_DUP_ENTRY → CONFLICT
 *  5. 未知 Error → INTERNAL_ERROR 兜底
 *  6. 响应头 X-Request-Id 必填且不为空
 *  7. X-Request-Id 入参透传
 *  8. 时间戳 timestamp 是 number
 */

import { HttpException, HttpStatus, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { QueryFailedError } from 'typeorm'
import { GlobalExceptionFilter } from './global-exception.filter'
import { BusinessCode } from '../enums/business-code.enum'
import { BusinessException } from '../exceptions/business.exception'

// ========== 构造 ArgumentsHost mock ==========
function mockHost(req: any = {}): any {
  const res: any = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
    __mockRes: res,
  }
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter

  beforeEach(() => {
    filter = new GlobalExceptionFilter()
  })

  describe('BusinessException', () => {
    it('应透传业务码、msg、data', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      const ex = new BusinessException(BusinessCode.FORBIDDEN, '权限不足', { hint: 'no-access' })
      filter.catch(ex, host as any)

      const res = host.__mockRes
      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN)
      const body = res.json.mock.calls[0][0]
      expect(body.code).toBe(BusinessCode.FORBIDDEN)
      expect(body.msg).toBe('权限不足')
      expect(body.data).toEqual({ hint: 'no-access' })
      expect(body.requestId).toMatch(/^req_/)
      expect(typeof body.timestamp).toBe('number')
    })
  })

  describe('NestJS 内置 HttpException', () => {
    it('BadRequestException → 400 + 业务码 PARAM_INVALID', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      filter.catch(new BadRequestException('参数错误'), host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(host.__mockRes.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
      expect(body.msg).toBe('参数错误')
    })

    it('NotFoundException → 404', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      filter.catch(new NotFoundException('用户不存在'), host as any)
      expect(host.__mockRes.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
      expect(host.__mockRes.json.mock.calls[0][0].msg).toBe('用户不存在')
    })

    it('UnauthorizedException → 401', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      filter.catch(new UnauthorizedException('请先登录'), host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(host.__mockRes.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED)
      expect(body.msg).toBe('请先登录')
    })

    it('ValidationPipe 错误数组 → PARAM_INVALID + data.errors', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      const validationErr = new HttpException(
        { message: ['name 不能为空', 'phone 格式错误'], error: 'Bad Request', statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      )
      filter.catch(validationErr, host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.code).toBe(BusinessCode.PARAM_INVALID)
      expect(body.msg).toBe('name 不能为空; phone 格式错误')
      expect(body.data).toEqual({ errors: ['name 不能为空', 'phone 格式错误'] })
    })
  })

  describe('TypeORM QueryFailedError', () => {
    it('通用 DB 错误 → DATABASE_ERROR 500', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      const err = new QueryFailedError('SELECT 1', [], new Error('connection lost'))
      filter.catch(err, host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.code).toBe(BusinessCode.DATABASE_ERROR)
      expect(host.__mockRes.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
    })

    it('ER_DUP_ENTRY 唯一约束冲突 → CONFLICT 200/409', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      const driverErr = { code: 'ER_DUP_ENTRY', errno: 1062, sqlMessage: "Duplicate entry 'alice' for key 'username'" }
      const err = new QueryFailedError('INSERT ...', [], driverErr as any)
      // QueryFailedError 在我们的代码里用 (exception as any).driverError 访问
      ;(err as any).driverError = driverErr
      filter.catch(err, host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.code).toBe(BusinessCode.CONFLICT)
      expect(body.msg).toMatch(/已存在/)
    })
  })

  describe('未知错误', () => {
    it('未捕获的 Error → INTERNAL_ERROR 500', () => {
      const host = mockHost({ headers: {}, url: '/api/x' })
      filter.catch(new Error('something blew up'), host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.code).toBe(BusinessCode.INTERNAL_ERROR)
      expect(host.__mockRes.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR)
    })

    it('非 Error 抛出值（如字符串）也应被兜底处理', () => {
      const host = mockHost({ headers: {}, url: '/api/x' })
      filter.catch('raw string error', host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.code).toBe(BusinessCode.INTERNAL_ERROR)
    })
  })

  describe('requestId 行为', () => {
    it('入参 X-Request-Id 应被透传', () => {
      const host = mockHost({ headers: { 'x-request-id': 'client-supplied-id-123' }, url: '/x' })
      filter.catch(new BadRequestException('xxx'), host as any)
      expect(host.__mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-supplied-id-123')
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.requestId).toBe('client-supplied-id-123')
    })

    it('未提供时应自动生成', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      filter.catch(new Error('x'), host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body.requestId).toMatch(/^req_[a-z0-9_]+$/)
    })
  })

  describe('响应格式', () => {
    it('应包含 code/msg/data/requestId/timestamp 五个字段', () => {
      const host = mockHost({ headers: {}, url: '/x' })
      filter.catch(new BadRequestException('test'), host as any)
      const body = host.__mockRes.json.mock.calls[0][0]
      expect(body).toHaveProperty('code')
      expect(body).toHaveProperty('msg')
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('requestId')
      expect(body).toHaveProperty('timestamp')
    })
  })
})