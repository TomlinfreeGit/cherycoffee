# 咖啡店点单系统

单店咖啡奶茶点单系统：顾客端微信小程序 + 商家端独立网页 + Node.js 后端。

> 详细文档见 [coffee-app/README.md](coffee-app/README.md)

## 项目结构

```
cherycode/
├── coffee-app/
│   ├── server/         # 后端 API (Node.js + Express + SQLite)
│   ├── mini-program/   # 微信小程序（原生开发）
│   └── merchant-web/   # 商家管理网页 (React + Vite)
└── openspec/           # OpenSpec 变更与规格（开发流程）
```

## 技术栈

- **后端**: Node.js 24+, Express 5, 内置 `node:sqlite`
- **数据库**: SQLite (WAL 模式)
- **商家端**: React 18, Vite 5, React Router 6
- **小程序**: 微信原生（不使用 Taro）
- **认证**: 微信 `wx.login` + 自管 session token
- **支付**: 模拟支付（待集成微信支付）

## 快速开始

```powershell
# 1. 启动后端（端口 3000）
cd coffee-app\server
npm install
node src/index.js

# 2. 启动商家管理网页（端口 5173）
cd ..\merchant-web
npm install
npm run dev

# 3. 启动微信小程序
# 用微信开发者工具打开 coffee-app\mini-program 目录
```

## 默认账号

| 角色 | 账号 | 密码 |
|------|------|------|
| 商家 | (任意用户名) | `admin123` |

商家账号配置见 `coffee-app/server/.env` 中的 `MERCHANT_USERNAME` / `MERCHANT_PASSWORD`。

## 主要功能

- ☕ 商品浏览（按分类：意式咖啡 / 其他饮品 / 创意特调）
- 🛒 购物车与下单（取餐号 + 自提）
- 👤 微信一键登录
- 📦 商家接单 / 状态管理 / 顾客信息查询
- 📷 商品图片上传
- 📊 订单搜索（按手机号、姓名）

## 开发流程

使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理需求与变更：

```powershell
# 探索需求
/opsx:explore

# 提议新变更
/opsx:propose 描述你想要的改动

# 实施变更中的任务
/opsx:apply <change-name>
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [coffee-app/README.md](coffee-app/README.md) | 完整项目文档（API、数据库、部署） |
| [coffee-app/server/WECHAT-SETUP.md](coffee-app/server/WECHAT-SETUP.md) | 微信 AppID/Secret 配置 |
| [openspec/](openspec/) | 需求规格与变更记录 |

## 测试

```powershell
cd coffee-app\server
node test-api.js      # API 测试
node test-e2e.js      # 端到端流程测试
node test-auth.js     # 隐私 / 隔离测试
node test-wechat.js   # 微信登录测试
node test-upload.js   # 图片上传测试
node test-customer.js # 顾客信息测试
node test-fallback.js # 网络故障容错测试
```

## 部署注意事项

1. SQLite 数据库文件需定期备份
2. 生产环境建议将端口绑定到 127.0.0.1 + nginx 反向代理
3. HTTPS 必需（小程序要求）
4. 商家网页部署后需配置 `CORS_ORIGIN`

## License

Private / Internal use only.
