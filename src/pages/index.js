import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {usePluginData} from '@docusaurus/useGlobalData';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

function HeroSection() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <Heading as="h1" className={styles.heroTitle}>
          Hi, I'm <span className={styles.highlight}>{siteConfig.title}</span> 👋
        </Heading>
        <p className={styles.heroSubtitle}>记录学习与实践 · Java 后端开发</p>
        <div className={styles.heroCta}>
          <Link className="button button--primary button--lg" to="/docs/tutorial/intro">
            浏览文档
          </Link>
        </div>
      </div>
    </header>
  );
}

function PostCard({title, date, slug, description}) {
  return (
    <Link to={`/blog/${slug}`} className={styles.postCard}>
      <div className={styles.postMeta}>{date}</div>
      <Heading as="h3" className={styles.postTitle}>{title}</Heading>
      <p className={styles.postDesc}>{description}</p>
    </Link>
  );
}

function RecentPosts() {
  const posts = usePluginData('recent-posts-plugin');
  return (
    <section className={styles.section}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>最近文章</Heading>
        <div className={styles.postGrid}>
          {posts.map((post, idx) => (
            <PostCard key={idx} {...post} />
          ))}
        </div>
        <div className={styles.viewAll}>
          <Link to="/blog" className="button button--outline button--primary">
            查看全部博客 →
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="TigerYu 的个人技术博客与笔记">
      <HeroSection />
      <main>
        <RecentPosts />
      </main>
    </Layout>
  );
}
