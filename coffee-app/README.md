# 咖啡店点单系统

单店咖啡奶茶点单系统：顾客端微信小程序 + 商家端独立网页 + Node.js 后端。

## 项目结构

```
coffee-app/
├── server/          # 后端 API (Node.js + Express + SQLite)
├── mini-program/    # 微信小程序 (原生开发) ✅
└── merchant-web/    # 商家管理网页 (React + Vite) ✅
```

## 技术栈

- **后端**: Node.js 24+, Express 5, node:sqlite (内置)
- **数据库**: SQLite (WAL 模式)
- **商家端**: React 18, Vite 5, React Router 6
- **小程序**: Taro 4, React 18 [待开发]

## 本地开发

### 启动后端

```bash
cd server
npm install
node src/index.js
# 服务监听 http://localhost:3000
```

### 启动商家管理网页

```bash
cd merchant-web
npm install
npm run dev
# 打开 http://localhost:5173
# 默认管理员密码: admin123
```

### API 测试

```bash
cd server
node test-api.js    # API 测试 (19 个，含 auth)
node test-e2e.js    # 端到端流程测试 (14 个)
node test-auth.js   # 隐私/隔离测试 (18 个)
```

## API 接口

### 认证

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /api/sessions | 小程序登录（用 wx.login code 换 session token） |
| DELETE | /api/sessions | 注销 |

### 商品（公开）

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/products | 商品列表（支持 ?category=&availableOnly=） |
| GET | /api/products/:id | 商品详情 |
| POST | /api/products | 创建商品（商家） |
| PATCH | /api/products/:id | 更新商品（商家） |
| DELETE | /api/products/:id | 删除商品（商家） |

### 顾客订单（需要登录 token，只能看自己的订单）

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /api/orders | 创建订单（生成取餐号） |
| GET | /api/orders | 我的订单列表 |
| GET | /api/orders/:id | 我的订单详情 |
| PATCH | /api/orders/:id/status | 取消订单 / 模拟支付 |

### 商家管理（需要 merchant token，能看所有订单）

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/merchant/orders | 所有订单 |
| GET | /api/merchant/orders/:id | 任意订单详情 |
| PATCH | /api/merchant/orders/:id/status | 更新任意订单状态 |

## 订单状态流转

```
pending ──► paid ──► preparing ──► ready ──► completed
   │          │          │
   └──────────┴──────────┴──► cancelled
```

## 取餐号规则

按日顺序：`YYYYMMDD-NNN`，每日从 `001` 开始。

例：`20260628-001`、`20260628-002`

## 数据库

| 表 | 说明 |
|----|------|
| products | 商品 |
| orders | 订单 |
| order_items | 订单商品 |
| daily_counter | 每日取餐号计数 |

数据文件：`server/data/coffee.db`

## 待开发

- [x] ~~微信小程序前端~~ ✅ 原生版本已完成
- [x] ~~微信登录接入~~ ✅ 支持真实 WeChat auth + mock 模式
- [ ] 微信支付集成（当前使用模拟支付）
- [ ] 商户号申请与配置
- [ ] 云服务器部署

## 配置微信 AppID/Secret

参见 [server/WECHAT-SETUP.md](server/WECHAT-SETUP.md)

简述：
1. 从 mp.weixin.qq.com 获取 AppID 和 AppSecret
2. 在 `server/.env` 中配置 `WECHAT_APPID` 和 `WECHAT_SECRET`
3. 设置 `USE_REAL_WECHAT_AUTH=true` 启用真实登录
4. 开发期可以保持 `false` 用 mock 模式

## 部署注意事项

1. SQLite 数据库文件需定期备份
2. 生产环境建议将端口绑定到 127.0.0.1 + nginx 反向代理
3. HTTPS 必需（小程序要求）
4. 商家网页部署后需配置 CORS_ORIGIN
