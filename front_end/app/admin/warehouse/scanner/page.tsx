'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const BARCODE_DETECTOR_FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'];

export default function InventoryScannerPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang'], '/admin');
  const [sku, setSku] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanSource, setScanSource] = useState<'manual' | 'camera' | 'device' | null>(null);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [scannerHint, setScannerHint] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const lastCameraCodeRef = useRef('');
  const lastCameraCodeAtRef = useRef(0);
  const keyboardBufferRef = useRef('');
  const lastKeyboardTsRef = useRef(0);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraRunning(false);
  }, []);

  const lookupProduct = useCallback(async (rawCode: string, source: 'manual' | 'camera' | 'device') => {
    const code = rawCode.trim();
    if (!code) return;
    try {
      setLoading(true);
      setScanSource(source);
      setSku(code);
      const res = await api.admin.inventory.scanBySku(code);
      setResult(res.data);
      setScannerHint('');
    } catch (error) {
      console.error('Scan failed:', error);
      setResult(null);
      setScannerHint(`Kode "${code}" tidak ditemukan.`);
    } finally {
      setLoading(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser tidak mendukung akses kamera.');
      return;
    }

    const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!detectorCtor) {
      setCameraError('Barcode detector belum didukung browser ini. Gunakan alat scan USB/Bluetooth.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      detectorRef.current = new detectorCtor({ formats: BARCODE_DETECTOR_FORMATS });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraRunning(true);

      scanIntervalRef.current = window.setInterval(async () => {
        if (detectBusyRef.current) return;
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (!video || !detector || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

        detectBusyRef.current = true;
        try {
          const results = await detector.detect(video);
          const code = results[0]?.rawValue?.trim();
          if (!code) return;

          const now = Date.now();
          if (code === lastCameraCodeRef.current && now - lastCameraCodeAtRef.current < 1500) return;

          lastCameraCodeRef.current = code;
          lastCameraCodeAtRef.current = now;
          await lookupProduct(code, 'camera');
        } catch {
          // Keep scanning on transient detector errors.
        } finally {
          detectBusyRef.current = false;
        }
      }, 300);
    } catch (error) {
      console.error('Camera init failed:', error);
      stopCamera();
      setCameraError('Tidak bisa mengakses kamera. Pastikan izin kamera diberikan.');
    }
  }, [lookupProduct, stopCamera]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const now = Date.now();
      if (now - lastKeyboardTsRef.current > 120) {
        keyboardBufferRef.current = '';
      }
      lastKeyboardTsRef.current = now;

      if (event.key === 'Enter') {
        const code = keyboardBufferRef.current.trim();
        keyboardBufferRef.current = '';
        if (code.length >= 3) {
          void lookupProduct(code, 'device');
        }
        return;
      }

      if (event.key.length === 1) {
        keyboardBufferRef.current += event.key;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lookupProduct]);

  if (!allowed) return null;

  const handleManualLookup = async () => {
    if (!sku.trim()) return;
    await lookupProduct(sku, 'manual');
  };

  return (
    <div className="warehouse-page">
      <div>
        <div className="warehouse-breadcrumb">
          <Link href="/admin" className="hover:text-emerald-500 transition-colors">Warehouse</Link>
          <span>/</span>
          <span className="text-slate-900">SKU Scanner</span>
        </div>
        <h1 className="warehouse-title">Scanner Alat & Produk</h1>
        <p className="warehouse-subtitle">Gunakan kamera atau barcode scanner untuk pengecekan cepat detail item gudang.</p>
      </div>

      <div className="warehouse-panel bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2">
          <div className="flex gap-2">
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Input SKU/barcode lalu Enter"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleManualLookup();
                }
              }}
            />
            <button onClick={handleManualLookup} disabled={loading} className="px-4 bg-emerald-600 text-white rounded-2xl text-sm font-bold">
              <ScanLine size={16} />
            </button>
          </div>
          <div className="flex gap-2">
            {!cameraRunning ? (
              <button
                onClick={() => void startCamera()}
                className="inline-flex items-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold"
              >
                <Camera size={16} />
                Aktifkan Kamera
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="inline-flex items-center gap-2 px-4 py-3 bg-rose-600 text-white rounded-2xl text-sm font-bold"
              >
                <CameraOff size={16} />
                Matikan Kamera
              </button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-950">
          <video ref={videoRef} className="w-full max-h-[320px] object-cover" muted playsInline />
          {!cameraRunning && (
            <div className="p-3 text-xs text-slate-300 bg-slate-900">
              Kamera belum aktif. Klik <span className="font-bold">Aktifkan Kamera</span> untuk scan langsung dari kamera.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
          <p className="font-bold inline-flex items-center gap-2"><Keyboard size={14} /> Mode Alat Scan (USB/Bluetooth)</p>
          <p>Arahkan fokus di halaman ini, lalu scan. Kebanyakan alat scan akan mengetik kode + Enter otomatis.</p>
        </div>

        {cameraError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {cameraError}
          </div>
        )}

        {scannerHint && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {scannerHint}
          </div>
        )}

        {result && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <p className="text-sm font-bold text-slate-900">{result.name}</p>
            <p className="text-xs text-slate-600 mt-1">SKU: {result.sku}</p>
            <p className="text-xs text-slate-600">Stok: {result.stock_quantity}</p>
            <p className="text-xs text-slate-600">Harga: Rp {Number(result.price || 0).toLocaleString('id-ID')}</p>
            {scanSource && (
              <p className="text-xs text-emerald-700 mt-2">Sumber scan: {scanSource === 'manual' ? 'manual' : scanSource === 'camera' ? 'kamera' : 'alat scan'}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
