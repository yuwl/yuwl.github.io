import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './tool.module.css';

// 在这里添加工具，category 可分组
const tools = [
  {
    category: '文本处理',
    items: [
      {
        title: 'OCR 识别',
        description: '图片文字识别',
        link: '/tool/ocr',
        internal: true,
      },
      {
        title: '语音合成',
        description: '文字转语音播放',
        link: '/tools/speech-synthesis.html',
        internal: false,
      },
    ],
  },
];

function ToolCard({title, description, link, internal}) {
  const linkProps = internal
    ? {component: Link, to: link}
    : {href: link, target: '_blank', rel: 'noopener noreferrer'};

  return internal ? (
    <Link to={link} className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.cardDesc}>{description}</div>
    </Link>
  ) : (
    <a href={link} target="_blank" rel="noopener noreferrer" className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.cardDesc}>{description}</div>
    </a>
  );
}

export default function ToolPage() {
  return (
    <Layout title="工具箱" description="实用小工具集合">
      <div className={styles.page}>
        <div className="container">
          <Heading as="h1" className={styles.pageTitle}>工具箱</Heading>
          <p className={styles.pageSubtitle}>一些常用的小工具</p>

          {tools.map((group) => (
            <div key={group.category} className={styles.group}>
              <Heading as="h2" className={styles.groupTitle}>{group.category}</Heading>
              <div className={styles.grid}>
                {group.items.map((tool) => (
                  <ToolCard key={tool.title} {...tool} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
