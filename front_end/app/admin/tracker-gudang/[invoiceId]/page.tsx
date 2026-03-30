'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Upload, ArrowLeft, CheckCircle2, XCircle, Truck, Camera, RefreshCw, User, Phone } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { notifyAlert, notifyOpen } from '@/lib/notify';
import type { InvoiceDetailResponse } from '@/lib/apiTypes';

type Condition = 'ok' | 'damaged' | 'missing';

type CheckRow = {
  product_id: string;
  product_name: string;
  qty_expected: number;
  qty_checked: number;
  condition: Condition;
  note: string;
  evidence: File | null;
};

const normalizeText = (value: unknown) => String(value || '').trim();
const toNonNegativeInt = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
};

const normalizeProofImageUrl = (raw?: string | null) => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;
  if (val.startsWith('http://') || val.startsWith('https://')) return val;
  if (val.startsWith('/uploads/')) return val;
  if (val.startsWith('uploads/')) return `/${val}`;
  const normalizedSlash = val.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('uploads/')) return `/${normalizedSlash}`;
  const uploadsIndex = normalizedSlash.indexOf('/uploads/');
  if (uploadsIndex >= 0) return normalizedSlash.slice(uploadsIndex);
  return val;
};

const getInvoiceItems = (invoiceData?: InvoiceDetailResponse | null): any[] => {
  if (Array.isArray((invoiceData as any)?.InvoiceItems)) return (invoiceData as any).InvoiceItems as any[];
  if (Array.isArray((invoiceData as any)?.Items)) return (invoiceData as any).Items as any[];
  return [];
};

const buildExpectedRows = (invoice: InvoiceDetailResponse | null): CheckRow[] => {
  if (!invoice) return [];
  const map = new Map<string, CheckRow>();
  const items = getInvoiceItems(invoice);

  items.forEach((row: any) => {
    const orderItem = row?.OrderItem || {};
    const product = orderItem?.Product || row?.Product || {};
    const productId = normalizeText(orderItem?.product_id || row?.product_id || product?.id);
    if (!productId) return;
    const name = String(product?.name || row?.product_name || 'Produk');
    const qty = toNonNegativeInt(row?.qty ?? row?.allocated_qty ?? row?.quantity ?? 0);
    if (qty <= 0) return;
    const prev = map.get(productId) || {
      product_id: productId,
      product_name: name,
      qty_expected: 0,
      qty_checked: 0,
      condition: 'ok' as const,
      note: '',
      evidence: null,
    };
    prev.qty_expected += qty;
    map.set(productId, prev);
  });

  return Array.from(map.values())
    .map((row) => ({ ...row, qty_checked: row.qty_expected, evidence: null }))
    .sort((a, b) => b.qty_expected - a.qty_expected);
};

type CameraTarget =
  | { kind: 'header' }
  | { kind: 'item'; productId: string };

export default function TrackerGudangCheckPage() {
  const allowed = useRequireRoles(['super_admin', 'checker_gudang'], '/admin/orders');
  const router = useRouter();
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = normalizeText(params?.invoiceId);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetailResponse | null>(null);
  const [latestHandover, setLatestHandover] = useState<any | null>(null);

  const [rows, setRows] = useState<CheckRow[]>([]);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<'pass' | 'fail'>('pass');
  const [evidence, setEvidence] = useState<File | null>(null);

  const [checkConfirmStep, setCheckConfirmStep] = useState<1 | 2 | null>(null);

  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    setCameraReady(false);
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* ignore */ }
      });
    }
    streamRef.current = null;
    if (videoRef.current) {
      try { (videoRef.current as any).srcObject = null; } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!cameraTarget) {
      stopCamera();
      setCameraError('');
      return;
    }
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser tidak mendukung akses kamera.');
      return;
    }

    let cancelled = false;
    setCameraError('');
    setCameraReady(false);

    void (async () => {
      try {
        stopCamera();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacingMode },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        (video as any).srcObject = stream;
        await video.play();
        if (!cancelled) setCameraReady(true);
      } catch (error: any) {
        console.error('Camera access failed:', error);
        setCameraError(String(error?.message || 'Gagal mengakses kamera. Cek izin kamera di browser.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraFacingMode, cameraTarget, stopCamera]);

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const width = Number(video.videoWidth || 0);
    const height = Number(video.videoHeight || 0);
    if (!width || !height) {
      notifyAlert('Kamera belum siap. Tunggu sebentar lalu coba lagi.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
    if (!blob) {
      notifyAlert('Gagal mengambil foto.');
      return;
    }

    const timestamp = Date.now();
    const fileName = cameraTarget?.kind === 'item'
      ? `checker-item-${cameraTarget.productId}-${timestamp}.jpg`
      : `checker-${invoiceId}-${timestamp}.jpg`;
    const file = new File([blob], fileName, { type: 'image/jpeg' });

    if (!cameraTarget) return;
    if (cameraTarget.kind === 'header') {
      setEvidence(file);
    } else {
      const productId = cameraTarget.productId;
      setRows((prev) => prev.map((row) => row.product_id === productId ? { ...row, evidence: file } : row));
    }

    setCameraTarget(null);
  }, [cameraTarget, invoiceId]);

  const mismatchCount = useMemo(() => {
    return rows.filter((r) => r.qty_checked !== r.qty_expected || r.condition !== 'ok').length;
  }, [rows]);
  const effectiveResult = useMemo<'pass' | 'fail'>(() => (mismatchCount > 0 ? 'fail' : result), [mismatchCount, result]);

  const canSubmit = useMemo(() => {
    if (!invoiceId) return false;
    if (busy) return false;
    if (!invoice) return false;
    if (rows.length === 0) return false;
    return true;
  }, [busy, invoice, invoiceId, rows.length]);

  const itemEvidenceCount = useMemo(() => rows.filter((row) => Boolean(row.evidence)).length, [rows]);

  const load = useCallback(async () => {
    if (!allowed || !invoiceId) return;
    setLoading(true);
    try {
      const [invoiceRes, latestRes] = await Promise.allSettled([
        api.invoices.getById(invoiceId),
        api.deliveryHandovers.latest(invoiceId),
      ]);
      const invoiceData =
        invoiceRes.status === 'fulfilled' ? (invoiceRes.value?.data as InvoiceDetailResponse | null) : null;
      const latestData =
        latestRes.status === 'fulfilled' ? (latestRes.value?.data as any) : null;

      setInvoice(invoiceData || null);
      setLatestHandover(latestData?.handover || null);
      setRows(buildExpectedRows(invoiceData || null));
    } catch (error) {
      console.error('Failed to load tracker gudang page:', error);
      setInvoice(null);
      setLatestHandover(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [allowed, invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmitCheck = async () => {
    if (!canSubmit) return;
    const trimmedNote = note.trim();
    const hasMismatch = mismatchCount > 0;

    try {
      setBusy(true);
      setCheckConfirmStep(null);
      const payload = new FormData();
      payload.append('invoice_id', invoiceId);
      if (trimmedNote) payload.append('note', trimmedNote);
      payload.append('result', effectiveResult);
      const itemEvidenceFiles: File[] = [];
      const itemEvidenceMap: Record<string, number> = {};

      payload.append('items', JSON.stringify(rows.map((r) => {
        if (r.evidence) {
          const idx = itemEvidenceFiles.length;
          itemEvidenceFiles.push(r.evidence);
          itemEvidenceMap[r.product_id] = idx;
        }
        return {
        product_id: r.product_id,
        qty_checked: r.qty_checked,
        condition: r.condition,
        note: r.note.trim() || null,
        };
      })));

      if (Object.keys(itemEvidenceMap).length > 0) {
        payload.append('item_evidence_map', JSON.stringify(itemEvidenceMap));
      }
      itemEvidenceFiles.forEach((file) => payload.append('item_evidences', file));
      if (evidence) payload.append('evidence', evidence);

      const res = await api.deliveryHandovers.check(payload);
      const message = String((res.data as any)?.message || 'Checking tersimpan.');
      notifyOpen({ variant: effectiveResult === 'pass' ? 'success' : 'warning', title: 'Checker', message });
      setEvidence(null);
      setRows((prev) => prev.map((row) => ({ ...row, evidence: null })));
      if (effectiveResult === 'fail' && !trimmedNote) {
        notifyAlert('Disarankan isi catatan agar jelas mismatch/masalahnya.');
      }
      await load();
	    } catch (error: any) {
	      console.error('Submit checking failed:', error);
	      const message = String(error?.response?.data?.message || error?.message || 'Gagal menyimpan checking.');
	      const requestId = String(error?.response?.data?.request_id || '').trim();
	      notifyAlert(requestId ? `${message} (request_id: ${requestId})` : message);
	    } finally {
	      setBusy(false);
	    }
	  };

  const handleHandover = async () => {
    const handoverId = Number(latestHandover?.id || 0);
    if (!handoverId) {
      notifyAlert('Handover tidak ditemukan untuk invoice ini.');
      return;
    }
    try {
      setBusy(true);
      await api.deliveryHandovers.handover(handoverId);
      notifyOpen({ variant: 'success', title: 'Handover', message: 'Berhasil: status invoice menjadi shipped.' });
      router.push('/admin/orders');
	    } catch (error: any) {
	      console.error('Handover failed:', error);
	      const message = String(error?.response?.data?.message || error?.message || 'Gagal handover ke driver.');
	      const requestId = String(error?.response?.data?.request_id || '').trim();
	      notifyAlert(requestId ? `${message} (request_id: ${requestId})` : message);
	    } finally {
	      setBusy(false);
	    }
	  };

  if (!allowed) return null;

  const courierId = normalizeText((invoice as any)?.courier_id || (invoice as any)?.Courier?.id);
  const courierName = normalizeText((invoice as any)?.Courier?.name);
  const courierPhone = normalizeText((invoice as any)?.Courier?.whatsapp_number || (invoice as any)?.Courier?.phone || (invoice as any)?.Courier?.phone_number);
  const shipmentStatus = normalizeText((invoice as any)?.shipment_status).toLowerCase();
  const canHandover = shipmentStatus === 'checked' && String(latestHandover?.status || '').toLowerCase() === 'checked_passed' && Boolean(courierId);
  const latestEvidenceUrl = normalizeProofImageUrl(typeof latestHandover?.evidence_url === 'string' ? latestHandover.evidence_url : null);
  const latestItemEvidenceRows = Array.isArray(latestHandover?.Items) ? (latestHandover.Items as any[]) : [];
  const latestItemEvidences = latestItemEvidenceRows
    .map((row: any) => ({
      id: String(row?.id || ''),
      productName: String(row?.Product?.name || '').trim(),
      productId: normalizeText(row?.product_id),
      evidenceUrl: normalizeProofImageUrl(typeof row?.evidence_url === 'string' ? row.evidence_url : null),
    }))
    .filter((row) => Boolean(row.evidenceUrl));

  return (
    <div className="p-6 space-y-5 pb-24">
      {checkConfirmStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-[28px] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-600">Konfirmasi Checking</p>
                <p className="mt-1 text-lg font-black text-slate-900">
                  Step {checkConfirmStep} / 2
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckConfirmStep(null)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-black uppercase text-slate-700"
                disabled={busy}
              >
                Tutup
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-700 space-y-1">
                <p>
                  Invoice: <span className="font-black">{normalizeText((invoice as any)?.invoice_number) || invoiceId}</span>
                </p>
                <p>
                  Driver: <span className="font-black">{courierName || courierId || '-'}</span>
                </p>
                <p>
                  Bukti: <span className="font-black">{evidence ? 'Ada (header)' : 'Tidak ada (header)'}</span> •
                  <span className="font-black"> {itemEvidenceCount}</span> foto item
                </p>
                <p>
                  Mismatch: <span className={`font-black ${mismatchCount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{mismatchCount}</span>
                </p>
                <p>
                  Result: <span className={`font-black ${mismatchCount > 0 ? 'text-rose-700' : effectiveResult === 'pass' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {mismatchCount > 0 ? 'fail (dipaksa karena mismatch)' : effectiveResult}
                  </span>
                </p>
                {note.trim() && (
                  <p>Catatan: <span className="font-black">{note.trim()}</span></p>
                )}
              </div>

              {checkConfirmStep === 1 ? (
                <p className="text-[11px] text-slate-500">
                  Pastikan qty & kondisi sudah benar. Step berikutnya adalah konfirmasi final untuk menyimpan checking.
                </p>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-800">
                  Aksi ini akan menyimpan checking dan mengubah status order (pass → <span className="font-black">checked</span>, fail → <span className="font-black">hold</span>).
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end border-t border-slate-100 px-5 py-4">
              {checkConfirmStep === 2 && (
                <button
                  type="button"
                  onClick={() => setCheckConfirmStep(1)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase text-slate-700"
                  disabled={busy}
                >
                  Kembali
                </button>
              )}
              {checkConfirmStep === 1 ? (
                <button
                  type="button"
                  onClick={() => setCheckConfirmStep(2)}
                  className="btn-3d rounded-2xl bg-slate-900 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-60"
                  disabled={busy}
                >
                  Lanjut Konfirmasi
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmitCheck()}
                  className="btn-3d rounded-2xl bg-cyan-600 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-60"
                  disabled={busy}
                >
                  {busy ? 'Memproses...' : 'Ya, Simpan Checking'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {cameraTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-600">Kamera Checker</p>
                <p className="text-sm font-black text-slate-900">
                  {cameraTarget.kind === 'item' ? 'Ambil foto bukti per item' : 'Ambil foto bukti checker'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCameraTarget(null)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-black uppercase text-slate-700"
              >
                Tutup
              </button>
            </div>

            <div className="bg-black">
              <video ref={videoRef} playsInline className="w-full aspect-video object-cover" />
            </div>

            <div className="space-y-2 px-4 py-4">
              {cameraError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] font-bold text-rose-700">
                  {cameraError}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setCameraFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase text-slate-700 disabled:opacity-60"
                  disabled={!cameraReady}
                >
                  <RefreshCw size={14} /> Balik Kamera
                </button>
                <button
                  type="button"
                  onClick={() => void capturePhoto()}
                  className="btn-3d inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-60"
                  disabled={!cameraReady}
                >
                  <Camera size={14} /> Ambil Foto
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Jika kamera tidak muncul, pastikan izin kamera diaktifkan untuk domain ini.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Kembali
        </Link>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-600">Tracker / Checker Gudang</p>
          <p className="text-sm font-black text-slate-900">{invoiceId ? `Invoice ${invoiceId}` : 'Invoice'}</p>
          <p className="text-[11px] text-slate-500">Status: {shipmentStatus || '-'}</p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
        </div>
      ) : !invoice ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <p className="text-sm font-black text-rose-700">Invoice tidak ditemukan atau tidak bisa diakses.</p>
        </div>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Info</p>
                <p className="mt-1 text-sm font-black text-slate-900">
                  {normalizeText((invoice as any)?.invoice_number) ? `Invoice ${String((invoice as any).invoice_number)}` : `Invoice ${invoiceId}`}
                </p>
                <div className="mt-2 space-y-1 text-[11px] text-slate-700">
                  <div className="inline-flex items-center gap-2">
                    <User size={14} className="text-slate-400" />
                    <span className="font-bold">Driver:</span>
                    <span className="font-black">{courierName || (courierId ? courierId : '-')}</span>
                  </div>
                  {courierPhone && (
                    <div className="inline-flex items-center gap-2">
                      <Phone size={14} className="text-slate-400" />
                      <span className="font-bold">Kontak:</span>
                      <span className="font-black">{courierPhone}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-700">
                  Item {rows.length}
                </span>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black ${
                  mismatchCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  Mismatch {mismatchCount}
                </span>
              </div>
            </div>

            {latestHandover && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-700 space-y-2">
                <div>
                  Handover terakhir: <span className="font-black">{String(latestHandover.status || '-')}</span>
                  {latestHandover.checked_at ? (
                    <span className="ml-2 text-slate-500">({new Date(latestHandover.checked_at).toLocaleString('id-ID')})</span>
                  ) : null}
                </div>
                {latestEvidenceUrl ? (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Bukti Checker (Header)</p>
                    <Image
                      src={latestEvidenceUrl}
                      alt="Bukti checker (header)"
                      width={960}
                      height={540}
                      className="w-full max-h-56 object-contain rounded-xl bg-white border border-slate-200"
                    />
                  </div>
                ) : null}
                {latestItemEvidences.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Bukti Item ({latestItemEvidences.length})</p>
                    <div className="grid grid-cols-2 gap-2">
                      {latestItemEvidences.map((row) => (
                        <div key={row.id || `${row.productId}:${row.evidenceUrl}`} className="rounded-xl border border-slate-200 bg-white p-2">
                          <p className="text-[10px] font-bold text-slate-700 truncate">
                            {row.productName || (row.productId ? `Produk ${row.productId}` : 'Produk')}
                          </p>
                          {row.evidenceUrl ? (
                            <Image
                              src={row.evidenceUrl}
                              alt="Bukti checker (item)"
                              width={640}
                              height={360}
                              className="mt-1 w-full max-h-32 object-contain rounded-lg bg-slate-50 border border-slate-100"
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">Form Checking</p>
                <p className="text-[11px] text-slate-500">Pastikan qty & kondisi sesuai sebelum barang masuk mobil.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setResult('pass')}
                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase ${
                    result === 'pass' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
                  }`}
                  disabled={busy}
                >
                  <CheckCircle2 size={14} /> Lolos
                </button>
                <button
                  type="button"
                  onClick={() => setResult('fail')}
                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase ${
                    result === 'fail' ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
                  }`}
                  disabled={busy}
                >
                  <XCircle size={14} /> Bermasalah
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Catatan</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Contoh: Ada 1 item rusak / qty kurang / segel terbuka."
                  className="min-h-[96px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Foto Bukti (opsional)</label>
                <div className="relative group">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => setEvidence(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    disabled={busy}
                  />
                  <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-8 group-hover:border-cyan-300 group-hover:bg-cyan-50/30 transition-all">
                    <Upload size={24} className="text-slate-400 group-hover:text-cyan-600 mb-2" />
                    <p className="text-xs font-bold text-slate-600">
                      {evidence ? evidence.name : 'Klik untuk pilih file (galeri)'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">Maks 5MB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => (busy ? null : setCameraTarget({ kind: 'header' }))}
                  className="btn-3d mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-60"
                  disabled={busy}
                >
                  <Camera size={14} /> Buka Kamera
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[1fr_90px_90px_130px] gap-2 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span>Produk</span>
                <span className="text-right">Expected</span>
                <span className="text-right">Checked</span>
                <span>Kondisi</span>
              </div>
              <div className="divide-y divide-slate-100">
                {rows.map((row, idx) => {
                  const hasMismatch = row.qty_checked !== row.qty_expected || row.condition !== 'ok';
                  return (
                    <div key={row.product_id} className="px-4 py-3 space-y-2">
                      <div className="grid grid-cols-[1fr_90px_90px_130px] gap-2 items-start">
                        <div>
                          <p className="text-sm font-black text-slate-900 leading-tight">{row.product_name}</p>
                          <p className="text-[10px] text-slate-400 break-all">{row.product_id}</p>
                          {hasMismatch && (
                            <p className="mt-1 text-[11px] font-bold text-rose-600">Mismatch terdeteksi</p>
                          )}
                        </div>
                        <div className="text-right text-sm font-black text-slate-900">{row.qty_expected}</div>
                        <div className="text-right">
                          <input
                            type="number"
                            min={0}
                            value={row.qty_checked}
                            onChange={(e) => {
                              const next = toNonNegativeInt(e.target.value);
                              setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, qty_checked: next } : r)));
                            }}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-black text-slate-900 outline-none"
                            disabled={busy}
                          />
                        </div>
                        <div>
                          <select
                            value={row.condition}
                            onChange={(e) => {
                              const next = (e.target.value === 'damaged' ? 'damaged' : e.target.value === 'missing' ? 'missing' : 'ok') as Condition;
                              setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, condition: next } : r)));
                            }}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none"
                            disabled={busy}
                          >
                            <option value="ok">OK</option>
                            <option value="damaged">Rusak</option>
                            <option value="missing">Kurang</option>
                          </select>
                        </div>
                      </div>
                      <input
                        value={row.note}
                        onChange={(e) => {
                          const next = e.target.value;
                          setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, note: next } : r)));
                        }}
                        placeholder="Catatan item (opsional)"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none"
                        disabled={busy}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-bold text-slate-600">
                          Foto item (opsional){row.evidence ? `: ${row.evidence.name}` : ''}
                        </p>
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, evidence: file } : r)));
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            disabled={busy}
                          />
                          <span className="inline-flex items-center justify-center rounded-xl bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-700 border border-slate-200">
                            Pilih File
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => (busy ? null : setCameraTarget({ kind: 'item', productId: row.product_id }))}
                        className="btn-3d inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-60"
                        disabled={busy}
                      >
                        <Camera size={14} /> Ambil Foto Item (Kamera)
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setCheckConfirmStep(1)}
                disabled={!canSubmit}
                className="btn-3d inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50"
              >
                {busy ? 'Memproses...' : 'Simpan Checking'}
              </button>
              <button
                type="button"
                onClick={() => void handleHandover()}
                disabled={!canHandover || busy}
                className="btn-3d inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50"
              >
                <Truck size={14} /> {busy ? 'Memproses...' : 'Handover (Set Shipped)'}
              </button>
            </div>

            {!courierId && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-700">
                Invoice belum ditugaskan ke driver. Assign driver dulu dari Proses Gudang.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
