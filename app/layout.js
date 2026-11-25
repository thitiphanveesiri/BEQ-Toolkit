import './globals.css';

export const metadata = { title: 'BEQ HAIR CLINIC Toolkit', description: 'ระบบจัดการภาพคนไข้และติดตามผล', robots: { index: false, follow: false }, icons: { icon: '/logo-mark.jpg' } };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

const themeInit = "try{var t=localStorage.getItem('beq-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
