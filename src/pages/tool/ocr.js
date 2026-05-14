import React from 'react';
import Layout from '@theme/Layout';

export default function Hello() {
  return (
    <Layout title="ocr" description="ocr React Page">
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '50vh',
          fontSize: '20px',
        }}>
            <a href='/tool'>back</a>
        <p>
          Edit <code>pages/ocr.js</code> and save to reload.
        </p>
      </div>
    </Layout>
  );
}