/**
 * auth-storage 单元测试
 *
 * 这一层是 token / userInfo 的唯一读写入口，前端所有鉴权判断都建立在它之上。
 * 历史缺陷正是"写 A 读 B"：AuthStore 写 sessionStorage，而拦截器 / 路由守卫 /
 * websocket / SSE 全读 localStorage，于是新标签页必然走到 /403 且无法自愈。
 * 因此这里锁死两件事：
 *  - 读写必须落在同一组命名空间键（auth.token / auth.userInfo）上
 *  - 旧键迁移必须完整执行，且不覆盖较新的状态
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
  clearAuth,
  getToken,
  getTokenExp,
  getUserInfo,
  getUserIdFromToken,
  migrateLegacyStorage,
  parseJwt,
  setToken,
  setUserInfo,
} from '../src/auth-storage'
import { makeJwt } from './helpers'

describe('auth-storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('token 读写', () => {
    it('写入后能读回，且落在命名空间键上', () => {
      setToken('abc.def.ghi')

      expect(getToken()).toBe('abc.def.ghi')
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('abc.def.ghi')
    })

    it('不再写入旧的裸键 token（否则又会"写 A 读 B"）', () => {
      setToken('abc')

      expect(localStorage.getItem('token')).toBeNull()
    })

    it('写入空字符串等同清除', () => {
      setToken('abc')
      setToken('')

      expect(getToken()).toBe('')
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    })

    it('未登录时返回空字符串而非 null', () => {
      expect(getToken()).toBe('')
    })
  })

  describe('userInfo 读写', () => {
    it('序列化后能原样读回', () => {
      const info = {
        id: 7,
        username: 'alice',
        roles: ['admin'],
        permissions: ['user:list'],
      }

      setUserInfo(info)

      expect(getUserInfo()).toEqual(info)
    })

    it('存的是 JSON 而非 [object Object]', () => {
      setUserInfo({ id: 1, username: 'bob' })

      expect(localStorage.getItem(USER_STORAGE_KEY)).toBe('{"id":1,"username":"bob"}')
    })

    it('内容损坏时返回 null 而不是抛错', () => {
      localStorage.setItem(USER_STORAGE_KEY, '{不是合法 JSON')

      expect(getUserInfo()).toBeNull()
    })

    it('传 null 等同清除', () => {
      setUserInfo({ id: 1, username: 'bob' })
      setUserInfo(null)

      expect(getUserInfo()).toBeNull()
    })
  })

  it('clearAuth 同时清空 token 与 userInfo', () => {
    setToken('abc')
    setUserInfo({ id: 1, username: 'bob' })

    clearAuth()

    expect(getToken()).toBe('')
    expect(getUserInfo()).toBeNull()
  })

  describe('parseJwt', () => {
    it('能解析 payload', () => {
      const token = makeJwt({ sub: 42, username: 'alice', exp: 1735689600 })

      expect(parseJwt(token)).toMatchObject({
        sub: 42,
        username: 'alice',
        exp: 1735689600,
      })
    })

    it('能正确解码 base64url 中的 - 和 _', () => {
      // 该 payload 的标准 base64 同时含 + 和 /，作为 base64url 时是 - 和 _；
      // 若按普通 base64 解码会得到错误结果
      const token = makeJwt({ sub: 999, username: '~~~???' })
      expect(token).toMatch(/-|_/)

      expect(parseJwt(token)).toMatchObject({ sub: 999, username: '~~~???' })
    })

    it('兼容 "Bearer " 前缀', () => {
      expect(parseJwt(`Bearer ${makeJwt({ sub: 42 })}`)?.sub).toBe(42)
    })

    it('格式非法时返回 null 而不是抛错', () => {
      expect(parseJwt('not-a-jwt')).toBeNull()
      expect(parseJwt('a.b')).toBeNull()
      expect(parseJwt('a.b.c.d')).toBeNull()
    })

    it('空值返回 null', () => {
      expect(parseJwt('')).toBeNull()
      expect(parseJwt(null)).toBeNull()
      expect(parseJwt(undefined)).toBeNull()
    })
  })

  describe('基于 token 的派生读取', () => {
    it('getTokenExp 返回毫秒时间戳（JWT 内是秒）', () => {
      setToken(makeJwt({ sub: 1, exp: 1735689600 }))

      expect(getTokenExp()).toBe(1735689600 * 1000)
    })

    it('无 token 时 getTokenExp 返回 0', () => {
      expect(getTokenExp()).toBe(0)
    })

    it('getUserIdFromToken 能取出 sub', () => {
      setToken(makeJwt({ sub: 77 }))

      expect(getUserIdFromToken()).toBe(77)
    })

    it('解析不出 sub 时返回 0', () => {
      setToken('garbage')

      expect(getUserIdFromToken()).toBe(0)
    })
  })

  describe('migrateLegacyStorage', () => {
    it('把旧键完整迁移到新键', () => {
      const token = makeJwt({ sub: 55 })
      localStorage.setItem('token', token)
      localStorage.setItem('username', 'legacy-user')
      localStorage.setItem('roles', JSON.stringify(['admin', 'user']))
      localStorage.setItem('permissions', JSON.stringify(['user:list']))

      migrateLegacyStorage()

      expect(getToken()).toBe(token)
      expect(getUserInfo()).toEqual({
        // 旧数据没有单独存 id，必须从 token 的 sub 还原
        id: 55,
        username: 'legacy-user',
        roles: ['admin', 'user'],
        permissions: ['user:list'],
      })
    })

    it('迁移后旧键一律清除', () => {
      localStorage.setItem('token', makeJwt({ sub: 1 }))
      localStorage.setItem('username', 'legacy-user')

      migrateLegacyStorage()

      for (const key of ['token', 'username', 'roles', 'permissions']) {
        expect(localStorage.getItem(key)).toBeNull()
      }
    })

    it('没有任何旧数据时也清掉旧键，且不产生新数据', () => {
      migrateLegacyStorage()

      expect(getToken()).toBe('')
      expect(getUserInfo()).toBeNull()
      for (const key of ['token', 'username', 'roles', 'permissions']) {
        expect(localStorage.getItem(key)).toBeNull()
      }
    })

    it('新键已有数据时不覆盖（避免冲掉用户已刷新过的较新状态）', () => {
      setToken('new-token')
      localStorage.setItem('token', 'legacy-token')

      migrateLegacyStorage()

      expect(getToken()).toBe('new-token')
    })

    it('旧 token 解析不出 sub 时 id 记 0，而不是抛错', () => {
      localStorage.setItem('token', 'not-a-jwt')
      localStorage.setItem('username', 'legacy-user')

      migrateLegacyStorage()

      expect(getToken()).toBe('not-a-jwt')
      expect(getUserInfo()?.id).toBe(0)
    })

    it('旧 roles 不是合法 JSON 时退化为空数组', () => {
      localStorage.setItem('token', makeJwt({ sub: 1 }))
      localStorage.setItem('roles', '不是数组')

      migrateLegacyStorage()

      expect(getUserInfo()?.roles).toEqual([])
    })
  })
})
