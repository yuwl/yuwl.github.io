---
slug: deploy-docusaurus-to-github-pages
title: 将 Docusaurus 网站部署到 GitHub Pages
authors: [yuwl]
tags: [docusaurus, github-pages, git, deploy]
---

本文记录将 Docusaurus 网站部署到 GitHub Pages 的完整过程，包括 Git 多账号配置、SSH 认证、以及源码与部署分支分离的最佳实践。

<!-- truncate -->

## 准备工作

### 1. 修改 docusaurus.config.js

确保以下字段配置正确：

```js
url: 'https://yuwl.github.io/',
baseUrl: '/',                        // User Site 用 /，Project Site 用 /仓库名/
organizationName: 'yuwl',            // GitHub 用户名
projectName: 'yuwl.github.io',       // 仓库名
deploymentBranch: 'gh-pages',        // 部署目标分支
```

> **User Site vs Project Site**
> - 仓库名为 `<username>.github.io` → User Site，`baseUrl: '/'`
> - 普通仓库（如 `my-blog`）→ Project Site，`baseUrl: '/my-blog/'`

### 2. 确认 .gitignore

Docusaurus 项目默认已包含 `.gitignore`，会排除以下内容，无需手动配置：

```
node_modules/   # 依赖包
build/          # 打包产物（deploy 命令会自动处理）
.docusaurus/    # 缓存文件
```

---

## Git 配置（多账号环境）

如果本机已有公司 Git 账号的全局配置，只需在本项目中设置**局部配置**，不影响全局：

```powershell
git init
git config user.name "yuwl"
git config user.email "你的GitHub邮箱"
```

不加 `--global` 的配置只对当前项目生效，局部配置优先级高于全局配置。

### 查看配置

```powershell
# 查看全局配置
git config --global --list

# 查看当前项目配置
git config --local --list

# 查看最终生效的配置
git config --list
```

---

## 配置代理（可选）

如需翻墙访问 GitHub，可只为本项目设置局部代理：

```powershell
git config http.proxy http://127.0.0.1:7890
git config https.proxy http://127.0.0.1:7890
```

同样不加 `--global`，只对当前项目生效。

---

## 推送源码到远程仓库

由于远程仓库 `master` 分支已有旧内容，为避免覆盖，将 Docusaurus 源码推送到新分支 `docusaurus`：

```powershell
git add .
git commit -m "init: docusaurus site"
git remote add origin git@github.com:yuwl/yuwl.github.io.git

# 推送到新分支，不影响 master
git push -u origin master:docusaurus
```

这样远程分支结构为：
- `master` — 旧内容（保留）
- `docusaurus` — Docusaurus 源码备份
- `gh-pages` — 部署后自动创建，存放打包后的静态文件

---

## 配置 SSH 认证

GitHub 已不支持密码方式推送，推荐使用 SSH。

### 1. 检查是否已有 SSH key

```powershell
ls ~/.ssh
```

如果已有 `id_ed25519.pub` 或 `id_rsa.pub` 可跳过下一步。

### 2. 生成 SSH key

```powershell
ssh-keygen -t ed25519 -C "你的GitHub邮箱"
```

一路回车即可。`-t ed25519` 指定使用 Ed25519 算法（现代椭圆曲线算法，安全性高、速度快，GitHub 推荐）。

### 3. 将公钥添加到 GitHub

```powershell
cat ~/.ssh/id_ed25519.pub
```

复制输出内容，前往 `https://github.com/settings/ssh/new` 粘贴保存。

### 4. 测试 SSH 连接

```powershell
ssh -T git@github.com
```

看到 `Hi yuwl!` 说明配置成功。

### 5. 修改远程地址为 SSH

```powershell
git remote set-url origin git@github.com:yuwl/yuwl.github.io.git
```

---

## 执行部署

```powershell
$env:USE_SSH="true"; npm run deploy
```

`npm run deploy` 会自动：
1. 执行 `npm run build` 打包
2. 将 `build/` 目录内容推送到远程 `gh-pages` 分支（自动创建）

---

## 开启 GitHub Pages

1. 进入仓库 `https://github.com/yuwl/yuwl.github.io/settings/pages`
2. Source 选择 `gh-pages` 分支，目录选 `/ (root)`
3. 保存，稍等 1-2 分钟

访问 `https://yuwl.github.io/` 即可看到网站上线。

---

## 后续更新流程

每次修改内容后，执行以下命令重新部署：

```powershell
# 更新源码备份（可选）
git add .
git commit -m "docs: 更新内容"
git push

# 重新部署
$env:USE_SSH="true"; npm run deploy
```
