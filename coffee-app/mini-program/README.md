# 微信小程序 - 咖啡点单

原生微信小程序（不使用 Taro），5 个页面 + 完整 API 集成。

## 文件结构

```
mini-program/
├── app.js              # 小程序入口、全局数据、购物车管理
├── app.json            # 全局配置（页面、tabBar、窗口）
├── app.wxss            # 全局样式
├── project.config.json # 微信开发者工具项目配置
├── sitemap.json        # SEO 配置
├── images/             # tabBar 图标
│   ├── menu.png / menu-active.png
│   ├── cart.png / cart-active.png
│   └── orders.png / orders-active.png
├── utils/
│   ├── api.js          # API 调用封装（含模拟支付）
│   └── format.js       # 时间/状态格式化
└── pages/
    ├── menu/           # 菜单浏览页
    ├── cart/           # 购物车 + 下单
    ├── order-success/  # 下单成功页（含取餐号）
    ├── order-list/     # 订单列表
    └── order-detail/   # 订单详情（含状态追踪）
```

## 在微信开发者工具中运行

### 1. 下载开发者工具

[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

### 2. 注册小程序 AppID

- 访问 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册
- 个人主体即可（用于开发测试）
- 复制 AppID

### 3. 修改 project.config.json

将 `appid` 字段替换为你的真实 AppID：

```json
{
  "appid": "wx1234567890abcdef"  // ← 改这里
}
```

> 测试也可以用「游客模式」(touristappid)，但部分 API 受限。

### 4. 导入项目

打开微信开发者工具 → 导入项目 → 选择本目录

### 5. 配置后端地址

**模拟器调试**：`http://localhost:3000` 默认即可。

**真机预览**：需改为电脑的局域网 IP：
1. 在电脑上运行 `ipconfig` 查看局域网 IP（如 `192.168.1.100`）
2. 修改 `app.js` 中的 `apiBase`：
   ```javascript
   apiBase: 'http://192.168.1.100:3000/api'
   ```
3. 关闭 Windows 防火墙或添加入站规则允许 3000 端口

### 6. 启动后端

```powershell
cd f:\Code\cherycode\coffee-app\server
node src/index.js
```

### 7. 启动开发者工具编译

点击「编译」按钮即可在模拟器中预览。

## 测试流程

| 步骤 | 操作 |
|------|------|
| 1 | 进入「菜单」页 → 看到 15 个商品（3 个分类） |
| 2 | 点击「+ 加入」加入购物车 → 底部购物车栏出现 |
| 3 | 切换到「购物车」tab → 调整数量或删除 |
| 4 | （可选）输入备注，如「少冰」 |
| 5 | 点击「提交订单」 → 弹出模拟支付框 |
| 6 | 确定支付 → 跳转到成功页，显示取餐号 |
| 7 | 切换到「我的订单」 → 看到刚才的订单 |

## 商家联动测试

1. 浏览器打开 [http://localhost:5173](http://localhost:5173)（商家管理）
2. 登录密码：`admin123`
3. 在「订单管理」中能看到小程序刚下的订单
4. 点击「标记已支付」→「开始制作」→「完成制作」→「已取餐」
5. **回到小程序**：下拉刷新订单详情，状态会实时更新

## 模拟支付说明

当前使用 `utils/api.js` 中的 `mockPay()` 函数，弹出确认框模拟支付成功。

**接入真实微信支付**：
1. 申请微信支付商户号
2. 在后端实现 `/api/wechat/pay` 统一下单接口
3. 在 `mockPay()` 处替换为：
   ```javascript
   wx.requestPayment({
     timeStamp, nonceStr, package, signType, paySign
   })
   ```
4. 处理支付回调，更新订单状态为 `paid`

## 调试技巧

| 问题 | 排查 |
|------|------|
| 模拟器白屏 | 检查后端是否启动、API 地址是否正确 |
| 报「不在以下 request 合法域名列表中」 | 开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」 |
| 真机无法访问 API | 确认是同一局域网、IP 正确、端口开放 |
| 购物车数据丢失 | 确认 `wx.setStorageSync('cart')` 调用正常 |

## 待办

- [ ] 接入真实微信支付
- [ ] 添加商品图片（当前用 emoji 占位）
- [ ] 添加订单推送通知（小程序订阅消息）
- [ ] 优化加载状态和错误提示
