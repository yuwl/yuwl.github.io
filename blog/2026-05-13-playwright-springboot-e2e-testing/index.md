---
slug: playwright-springboot-e2e-testing
title: 使用 Playwright 自动化测试 Spring Boot 前后端分离项目
authors: [yuwl]
tags: [playwright, springboot, testing, automation]
---

在前后端分离的项目中，前端通过 REST API 与后端通信，传统的单元测试很难覆盖完整的用户交互流程。**Playwright** 是微软开源的端对端（E2E）测试框架，支持 Chromium、Firefox 和 WebKit，天然适合测试这类场景。

本文将以一个典型的 Spring Boot + Vue/React 前后端分离项目为例，演示如何搭建 Playwright 测试环境，编写测试用例，并与 CI 流程集成。

<!-- truncate -->

## 项目结构概览

```
project-root/
├── backend/          # Spring Boot 后端
│   ├── src/
│   └── pom.xml
├── frontend/         # Vue / React 前端
│   ├── src/
│   └── package.json
└── e2e/              # Playwright 测试目录
    ├── tests/
    ├── playwright.config.ts
    └── package.json
```

前端运行在 `http://localhost:5173`（Vite 默认端口），后端运行在 `http://localhost:8080`，前端通过 `/api` 代理转发请求到后端。

---

## 一、环境准备

### 1. 启动 Spring Boot 后端

确保后端可以正常运行，并提供 REST 接口，例如：

```java
// UserController.java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody LoginRequest req) {
        // 验证用户名密码逻辑
        Map<String, Object> result = new HashMap<>();
        result.put("token", "mock-jwt-token");
        result.put("username", req.getUsername());
        return ResponseEntity.ok(result);
    }

    @GetMapping("/profile")
    public ResponseEntity<UserProfile> profile(@RequestHeader("Authorization") String token) {
        // 验证 token 并返回用户信息
        return ResponseEntity.ok(new UserProfile("Alice", "alice@example.com"));
    }
}
```

### 2. 初始化 Playwright 项目

在项目根目录的 `e2e/` 文件夹下初始化：

```bash
cd e2e
npm init playwright@latest
```

安装向导会询问你使用 TypeScript 还是 JavaScript，选择 **TypeScript**，并选择将测试放在 `tests/` 目录。

---

## 二、配置 Playwright

编辑 `e2e/playwright.config.ts`：

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  // 在测试前自动启动前端开发服务器
  webServer: {
    command: 'npm run dev',
    cwd: '../frontend',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

`webServer` 配置让 Playwright 在运行测试前自动启动前端服务，非常方便。

:::tip
如果后端也需要自动启动，可以在 `webServer` 中配置为数组，同时启动前后端两个服务。
:::

---

## 三、编写测试用例

### 3.1 登录流程测试

```typescript
// e2e/tests/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('用户认证', () => {
  test('正确的用户名密码应能成功登录', async ({ page }) => {
    await page.goto('/login');

    // 填写登录表单
    await page.getByLabel('用户名').fill('alice');
    await page.getByLabel('密码').fill('password123');
    await page.getByRole('button', { name: '登录' }).click();

    // 验证跳转到首页且显示欢迎信息
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText('欢迎，alice')).toBeVisible();
  });

  test('错误密码应显示错误提示', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('用户名').fill('alice');
    await page.getByLabel('密码').fill('wrongpassword');
    await page.getByRole('button', { name: '登录' }).click();

    await expect(page.getByText('用户名或密码错误')).toBeVisible();
    await expect(page).toHaveURL('/login'); // 应留在登录页
  });
});
```

### 3.2 需要认证的页面测试

对于需要登录才能访问的页面，使用 Playwright 的 `storageState` 实现登录态复用，避免每个测试都重复登录。

首先创建一个全局 setup 文件：

```typescript
// e2e/tests/global-setup.ts
import { chromium } from '@playwright/test';

async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/login');
  await page.getByLabel('用户名').fill('alice');
  await page.getByLabel('密码').fill('password123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/dashboard');

  // 保存登录态到文件
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
  await browser.close();
}

export default globalSetup;
```

在 `playwright.config.ts` 中注册：

```typescript
export default defineConfig({
  globalSetup: require.resolve('./tests/global-setup'),
  // ...
});
```

然后在需要认证的测试中复用：

```typescript
// e2e/tests/user-profile.spec.ts
import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

test('用户信息页面应显示正确的个人资料', async ({ page }) => {
  await page.goto('/profile');

  await expect(page.getByText('Alice')).toBeVisible();
  await expect(page.getByText('alice@example.com')).toBeVisible();
});
```

### 3.3 Mock 后端接口（可选）

在某些场景下，后端可能还未就绪，可以用 Playwright 的路由拦截功能 Mock API：

```typescript
test('当接口返回错误时应显示友好提示', async ({ page }) => {
  // 拦截后端 API 并返回 500 错误
  await page.route('**/api/users/profile', (route) => {
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Internal Server Error' }),
    });
  });

  await page.goto('/profile');

  await expect(page.getByText('服务暂时不可用，请稍后再试')).toBeVisible();
});
```

---

## 四、运行测试

```bash
# 运行所有测试（有界面）
npx playwright test --headed

# 无界面运行（适合 CI）
npx playwright test

# 只运行某个测试文件
npx playwright test tests/auth.spec.ts

# 查看 HTML 测试报告
npx playwright show-report
```

---

## 五、与 Spring Boot 集成测试

对于需要真实后端数据的场景，推荐在 Spring Boot 中使用 **H2 内存数据库** + **TestContainers** 启动一个测试专用实例。

在后端 `src/test/resources/application-test.properties` 中配置：

```properties
spring.datasource.url=jdbc:h2:mem:testdb
spring.datasource.driver-class-name=org.h2.Driver
spring.jpa.hibernate.ddl-auto=create-drop
# 固定测试端口
server.port=8080
```

通过 `maven` 在测试前启动后端：

```bash
# 方式一：手动在两个终端中分别启动
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=test
cd frontend && npm run dev

# 方式二：在 playwright.config.ts 的 webServer 数组中配置
webServer: [
  {
    command: 'mvn spring-boot:run -Dspring-boot.run.profiles=test',
    cwd: '../backend',
    url: 'http://localhost:8080/actuator/health',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: 'npm run dev',
    cwd: '../frontend',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
],
```

---

## 六、CI/CD 集成（GitHub Actions）

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build & Start Spring Boot backend
        run: |
          cd backend
          mvn package -DskipTests
          java -jar target/*.jar --spring.profiles.active=test &

      - name: Install frontend dependencies
        run: cd frontend && npm ci

      - name: Install Playwright & browsers
        run: cd e2e && npm ci && npx playwright install --with-deps

      - name: Run Playwright tests
        run: cd e2e && npx playwright test

      - name: Upload test report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: e2e/playwright-report/
          retention-days: 7
```

---

## 七、最佳实践总结

| 实践 | 说明 |
|------|------|
| **Page Object 模式** | 将页面操作封装为类，提高测试可维护性 |
| **复用登录态** | 用 `storageState` 避免重复登录，加快测试速度 |
| **数据隔离** | 每个测试使用独立的测试账号或在测试前后清理数据 |
| **优先用语义化选择器** | 使用 `getByRole`、`getByLabel` 而非 CSS 选择器，更贴近用户视角 |
| **Mock 不稳定的接口** | 第三方支付、短信验证码等接口应 Mock，避免不稳定性 |
| **并行执行** | Playwright 默认并行运行测试文件，合理拆分测试文件可大幅提速 |

---

## 总结

Playwright 凭借其强大的 API、自动等待机制和跨浏览器支持，非常适合测试 Spring Boot 前后端分离项目的完整用户流程。结合 `webServer` 自动启动服务和 `storageState` 复用登录态，可以将 E2E 测试的维护成本降到最低，同时保证测试的可靠性。

希望本文能帮助你快速上手 Playwright，为你的项目建立完善的自动化测试体系！
