# 减脂日记（PWA）

自用的饮食与运动打卡应用。纯前端，数据存在手机浏览器本地（IndexedDB），安装到 iPhone 主屏幕后离线可用。
需求文档见上级目录 `02-需求文档PRD.md`。

## 本地开发

需要 Node 20 以上（本机用 nvm：`nvm use 22.15.0`）。

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 规则引擎 + 端到端服务测试
npm run build      # 产物在 dist/
```

## 目录

- `src/domain/constants.ts` 所有规则阈值（PRD 第 7 节）
- `src/domain/types.ts` 数据模型（PRD 第 6 节）
- `src/domain/db.ts` Dexie 数据库、预置数据、备份导入导出
- `src/domain/rules/` 纯函数规则：`budget`（热量预算）、`trend`（趋势判断）、`schedule`（自动排期）、`mealPlan`（饮食计划生成）
- `src/services/planService.ts` 每日计划生成的编排
- `src/services/ingredients.ts` 现有食材管理及饮食计划候选筛选
- `src/pages/` 页面：今日、运动、趋势、我的及各设置页

## 有啥吃啥

在「我的 → 有啥吃啥」添加手边有的食材，用完后移除，不需要按周维护，也不记录购买数量。
自动生成饮食计划和替换食物只使用现有食材；没有现有食材时会留空并提示补充，不会回退到整个食物库。
更新食材后，点击「重排今天」更新今日饮食计划，已有饮食打卡保留。手动记餐仍可从整个食物库添加。
旧购物清单中每种食材最近一次的「已买」状态（不含未来周）会自动带入；现有食材状态随 JSON 备份和恢复。

## 部署到 DevFile

1. 运行 `npm run build`，生成 `dist/`。
2. 在 DevFile 选择文件夹上传并选中 `dist/`，或把 `dist/` 内的全部内容压缩成 ZIP 后上传。
   ZIP 顶层应直接包含 `index.html`、`assets/`、`manifest.webmanifest`、`sw.js` 及图标，不要只上传 HTML，也不要额外套一层 `dist/`。
3. 默认资源路径为 `./`，让脚本、样式和 PWA 文件从项目所在目录加载。
4. 使用平台生成的访问链接。若资源仍返回 403，检查浏览器「网络」中的完整资源地址，以及平台是否允许这些文件类型和 Service Worker。

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库，把 `app/` 目录推上去（或整个项目目录）。
2. 仓库 Settings → Pages → Source 选 GitHub Actions。
3. `.github/workflows/pages.yml` 已写好，推送到 `main` 后自动构建发布。
   构建时 `VITE_BASE` 设为 `/<仓库名>/`，工作流里已按仓库名自动填。
4. 发布地址形如 `https://<用户名>.github.io/<仓库名>/`，用 iPhone Safari 打开，分享 → 添加到主屏幕。

## iPhone 上的限制

- 读不到 Apple 健康，小米体脂秤读数手动输入。
- 没有定时提醒，训练时间请在 iPhone 时钟里设闹钟。
- 删除主屏幕图标或清理 Safari 数据会丢数据，每周在「我的 → 数据与设置」导出一次 JSON。
