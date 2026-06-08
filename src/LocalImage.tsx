import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

const imageCache: Record<string, string> = {};

interface LocalImageProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  onClick?: React.MouseEventHandler;
}

export default function LocalImage({ src, alt = '', className, style, onClick }: LocalImageProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const currentSrcRef = useRef(src);

  useEffect(() => {
    currentSrcRef.current = src;

    if (!src) {
      setError('No source provided');
      return;
    }

    if (src.startsWith('data:')) {
      setDataUrl(src);
      setError('');
      return;
    }

    if (src.startsWith('http://') || src.startsWith('https://')) {
      setError('');
      return;
    }

    if (imageCache[src]) {
      setDataUrl(imageCache[src]!);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    invoke<string>('read_image_base64', { path: src })
      .then((result) => {
        if (cancelled) return;
        if (currentSrcRef.current !== src) return;
        imageCache[src] = result;
        setDataUrl(result);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        if (currentSrcRef.current !== src) return;
        console.error(`[LocalImage] Failed to load ${src}:`, err);
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) {
    return <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#444', color: '#aaa', fontSize: 11 }}>No src</div>;
  }

  if (src.startsWith('http://') || src.startsWith('https://')) {
    return <img src={src} alt={alt} className={className} style={style} onClick={onClick} onError={(e) => { console.error('[LocalImage] HTTP image failed:', src, e); setError('HTTP load failed'); }} />;
  }

  if (loading) {
    return (
      <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={className}
        style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#333', color: '#ff6b6b', fontSize: 10, padding: 8, gap: 4 }}
        title={error}
      >
        <div>Failed</div>
        <div style={{ fontSize: 9, color: '#888', wordBreak: 'break-all', textAlign: 'center' }}>{error.substring(0, 80)}</div>
      </div>
    );
  }

  if (!dataUrl) {
    return <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222' }} />;
  }

  return <img src={dataUrl} alt={alt} className={className} style={style} onClick={onClick} />;
}
