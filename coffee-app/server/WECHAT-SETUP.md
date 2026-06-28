# 微信小程序登录配置指南

## 一、获取 AppID 和 AppSecret

### 1. 注册小程序账号

访问 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 立即注册 → 小程序

需要：
- 邮箱（未被微信注册过）
- 主体类型：个人 / 企业
- 主体认证：个人需身份证；企业需营业执照

### 2. 获取 AppID

登录后台 → **开发管理** → **开发设置** → 找到 **AppID(小程序ID)**

```
AppID: wx1234567890abcdef   ← 复制保存
```

### 3. 获取 AppSecret

同一页面 → **AppSecret(小程序密钥)** → 点击"生成"

```
AppSecret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   ← 仅生成时可见！
```

⚠️ **安全提示**：
- AppSecret 等同于密码，**绝对不能提交到 git**
- 丢失后只能重置（旧的立即失效）
- 生产环境建议配置 IP 白名单（在"开发设置"页面）

### 4. 配置小程序项目

编辑 `coffee-app/mini-program/project.config.json`：

```json
{
  "appid": "wx1234567890abcdef"  // ← 填入你的 AppID
}
```

---

## 二、配置后端环境变量

### 1. 创建 `.env` 文件

```powershell
cd F:\Code\cherycode\coffee-app\server
Copy-Item .env.example .env
```

### 2. 编辑 `.env`

```bash
# 微信小程序登录
WECHAT_APPID=wx1234567890abcdef
WECHAT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# true=真实微信登录；false=本地 mock（无需凭据）
USE_REAL_WECHAT_AUTH=true
```

⚠️ **不要把 `.env` 提交到 git**。`.gitignore` 已经默认忽略它。

---

## 三、运行模式

### Mock 模式（本地开发，无凭据）

```bash
USE_REAL_WECHAT_AUTH=false
# 或不设置
```

后端会从 `code` 字符串派生一个稳定的 mock openid。同一个 `code` 总是得到同一个 openid，方便测试。

### Real 模式（生产环境）

```bash
USE_REAL_WECHAT_AUTH=true
WECHAT_APPID=wx...
WECHAT_SECRET=...
```

流程：
```
小程序 wx.login()  →  拿到 code
        ↓
POST /api/sessions  body: { code }
        ↓
后端调用  api.weixin.qq.com/sns/jscode2session
        ↓
用 appid + secret + js_code 换取真实 openid
        ↓
生成 session token，存库
        ↓
返回  { token, openid }  给小程序
```

---

## 四、测试

### 验证 mock 模式

```powershell
cd F:\Code\cherycode\coffee-app\server
node test-wechat.js
```

应该看到：
```
✓ Config endpoint reports useRealWechat=false
✓ Config does NOT leak actual secret value
✓ Missing code rejected (400)
✓ Login with code returns token + openid=...
✓ Mock mode: same code → same openid
✓ Empty code handled gracefully
```

### 验证真实模式

启动后端并访问：
```
http://localhost:3000/api/sessions/config
```

返回：
```json
{
  "data": {
    "useRealWechat": true,
    "appIdConfigured": true,
    "secretConfigured": true
  }
}
```

然后用真实的小程序扫码登录测试。

---

## 五、安全检查清单

- [x] `.env` 在 `.gitignore` 中
- [x] `GET /api/sessions/config` 不返回 secret 值
- [x] 真实 secret 只在后端使用，从不返回给客户端
- [x] `session_key` 不返回给客户端（仅服务端用于解密数据）
- [x] AppSecret 在生产环境配置 IP 白名单
- [x] HTTPS 必需（小程序要求）
- [x] AppSecret 不在日志中打印

---

## 六、常见问题

### Q1: 报错 `40029 - invalid code`

code 只能使用一次，且 5 分钟内有效。如果用户在小程序反复调用 `wx.login()`，旧 code 立即失效。

解决：只在真正需要时才调用 `wx.login()`（如 token 失效时）。

### Q2: 报错 `errcode=45011 - 频率限制`

每个小程序每分钟 1000 次 `code2Session` 调用上限。本地开发不要循环测试。

### Q3: 报错 `invalid ip`

IP 白名单限制（如果设置过）。后端服务器 IP 需要添加到白名单。

### Q4: 开发期间没有 AppID

可以先使用 mock 模式（`USE_REAL_WECHAT_AUTH=false`）。同一个 code 派生稳定的 mock openid，订单数据可持久化测试。

### Q5: 如何重置 AppSecret？

后台 → 开发管理 → 开发设置 → AppSecret → 重置。

**注意**：重置后所有现有用户的 session 立即失效（因为服务端用 secret 校验 code）。

---

## 七、生产部署建议

### 1. 使用 HTTPS

小程序要求 HTTPS。开发期间可在开发者工具勾选"不校验合法域名"。

### 2. 配置 IP 白名单

在微信公众平台 → 开发管理 → 开发设置 → AppSecret 配置 IP 白名单。

### 3. 环境变量管理

- **不要**把 `.env` 提交到 git
- 使用部署平台的 secret 管理（如 Docker secrets、云服务商 secret manager）
- 不同环境（dev/staging/prod）使用不同的 AppID

### 4. 监控告警

监控以下指标：
- `/api/sessions` 错误率（特别是 40029 比例）
- 微信 `code2Session` API 调用延迟
- 异常高频登录（同 IP 短时间内多次登录）
