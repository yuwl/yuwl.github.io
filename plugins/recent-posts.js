// @ts-check
const fs = require('fs');
const path = require('path');

/**
 * 简单解析 Markdown front matter，返回 key-value 对象
 */
function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  match[1].split('\n').forEach((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      result[key] = val;
    }
  });
  return result;
}

/**
 * 提取 front matter 之后的第一段文字作为摘要
 */
function extractExcerpt(content) {
  const body = content.replace(/^---[\s\S]*?---\r?\n/, '');
  const lines = body.split('\n');
  for (const line of lines) {
    const text = line.replace(/<!--.*?-->/g, '').replace(/[#*`>[\]]/g, '').trim();
    if (text.length > 10) return text.slice(0, 80) + (text.length > 80 ? '…' : '');
  }
  return '';
}

/**
 * Docusaurus 插件：在构建时读取 blog 目录，将最近 N 篇文章暴露为全局数据
 */
module.exports = function recentPostsPlugin(context, options) {
  const { count = 3 } = options || {};

  return {
    name: 'recent-posts-plugin',

    async loadContent() {
      const blogDir = path.join(context.siteDir, 'blog');
      const posts = [];

      /** 处理单个 md/mdx 文件，dirname 是父文件夹名（用于提取日期） */
      function handleFile(filePath, baseName) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const fm = parseFrontMatter(content);
        if (!fm.title) return;

        const dateMatch = baseName.match(/^(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '';
        const slug = fm.slug || baseName.replace(/\.(md|mdx)$/, '');
        const description = fm.description || extractExcerpt(content);

        posts.push({ title: fm.title, date, slug, description });
      }

      const items = fs.readdirSync(blogDir);
      for (const item of items) {
        // 跳过非文章文件
        if (item === 'authors.yml' || item === 'tags.yml') continue;

        const fullPath = path.join(blogDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // 文件夹形式的博客文章，如 2021-08-26-welcome/index.md
          for (const ext of ['index.md', 'index.mdx']) {
            const indexFile = path.join(fullPath, ext);
            if (fs.existsSync(indexFile)) {
              handleFile(indexFile, item);
              break;
            }
          }
        } else if (/\.(md|mdx)$/.test(item)) {
          handleFile(fullPath, item);
        }
      }

      // 按日期降序，取最近 count 篇
      posts.sort((a, b) => b.date.localeCompare(a.date));
      return posts.slice(0, count);
    },

    async contentLoaded({ content, actions }) {
      actions.setGlobalData(content);
    },
  };
};
