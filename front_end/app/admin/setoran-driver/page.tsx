'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { AlertCircle, CheckCircle, Wallet, PackageCheck, Receipt } from 'lucide-react';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import { formatMoneyId, parseMoneyInput } from '@/lib/money';

type CodInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  // `expected_total` from API is the outstanding amount (net_total - amount_received).
  expected_total: number;
  net_total?: number;
  amount_received?: number;
  created_at?: string | null;
  order_ids: string[];
  customer_names: string[];
  requires_retur_handover: boolean;
  pending_handover_id: number | null;
};

type HandoverItemRow = {
  retur_id: string;
  qty: number;
  product?: { id: string; name: string; sku: string; unit: string } | null;
};

type HandoverRow = {
  handover_id: number;
  invoice_id: string;
  status: 'submitted' | 'received';
  submitted_at?: string | null;
  note?: string | null;
  items: HandoverItemRow[];
};

type DriverDepositRow = {
  driver: { id: string; name: string; whatsapp_number?: string; debt: number };
  cod_invoices_pending: CodInvoiceRow[];
  retur_handovers_pending: HandoverRow[];
  balance_adjustments?: {
    total_outstanding: number;
    entries: Array<{
      id: string;
      direction: 'debt' | 'credit' | string;
      reason: string;
      amount: number;
      note: string | null;
      created_at: string | null;
    }>;
  } | null;
  totals: { cod_invoice_count: number; cod_expected_total: number; handover_count: number; retur_item_count: number };
};

export default function AdminSetoranDriverPage() {
  const allowed = useRequireRoles(['kasir', 'super_admin'], '/admin');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DriverDepositRow[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');

  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Record<string, boolean>>({});
  const [amountReceivedInput, setAmountReceivedInput] = useState<string>('');
  const [selectedHandoverIds, setSelectedHandoverIds] = useState<Record<string, boolean>>({});
  const [handoverNotes, setHandoverNotes] = useState<Record<string, string>>({});
  const [handoverQty, setHandoverQty] = useState<Record<string, Record<string, string>>>({});

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const sanitizeAmountInput = useCallback((value: string) => {
    // Allow digits plus separators for localized input like "260.750,56".
    return String(value || '').replace(/[^\d.,\-\s]/g, '');
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    try {
      if (!silent) setLoading(true);
      const res = await api.admin.driverDeposit.getList();
      const list = Array.isArray(res.data) ? (res.data as DriverDepositRow[]) : [];
      setRows(list);
      if (!selectedDriverId && list.length > 0) {
        setSelectedDriverId(list[0].driver.id);
      } else if (selectedDriverId && !list.some((r) => r.driver.id === selectedDriverId)) {
        setSelectedDriverId(list[0]?.driver.id || '');
      }
    } catch (error) {
      console.error('Failed to load driver deposit list:', error);
      if (!silent) setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedDriverId]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: () => load({ silent: true }),
    domains: ['cod', 'retur', 'order', 'admin'],
    pollIntervalMs: 10000,
  });

  const selectedDriver = useMemo(() => rows.find((r) => r.driver.id === selectedDriverId) || null, [rows, selectedDriverId]);

  useEffect(() => {
    if (!selectedDriverId) return;
    setSelectedInvoiceIds({});
    setSelectedHandoverIds({});
    setHandoverNotes({});
    setAmountReceivedInput('');
    setFeedback(null);
  }, [selectedDriverId]);

  useEffect(() => {
    if (!selectedDriver) return;
    setHandoverQty((prev) => {
      const next = { ...prev };
      selectedDriver.retur_handovers_pending.forEach((h) => {
        const hk = String(h.handover_id);
        const existing = next[hk];
        const items: Record<string, string> = existing ? { ...existing } : {};
        h.items.forEach((it) => {
          const key = String(it.retur_id);
          if (items[key] !== undefined) return;
          items[key] = String(Math.max(0, Math.trunc(Number(it.qty || 0))));
        });
        next[hk] = items;
      });
      return next;
    });
  }, [selectedDriver]);

  const selectedInvoiceIdList = useMemo(() => {
    return Object.entries(selectedInvoiceIds).filter(([, v]) => v).map(([k]) => k);
  }, [selectedInvoiceIds]);

  const selectedHandoverIdList = useMemo(() => {
    return Object.entries(selectedHandoverIds).filter(([, v]) => v).map(([k]) => k);
  }, [selectedHandoverIds]);

  const hasSelectedCod = selectedInvoiceIdList.length > 0;
  const hasSelectedHandover = selectedHandoverIdList.length > 0;
  const outstandingDebt = useMemo(() => {
    const raw = selectedDriver?.balance_adjustments?.total_outstanding;
    const n = Number(raw || 0);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [selectedDriver?.balance_adjustments?.total_outstanding]);

  const expectedSelectedTotal = useMemo(() => {
    if (!selectedDriver) return 0;
    const byId = new Map(selectedDriver.cod_invoices_pending.map((inv) => [String(inv.invoice_id), inv]));
    return selectedInvoiceIdList.reduce((sum, id) => sum + Number(byId.get(id)?.expected_total || 0), 0);
  }, [selectedDriver, selectedInvoiceIdList]);

  const amountReceived = useMemo(() => {
    const parsed = parseMoneyInput(amountReceivedInput);
    return parsed === null ? 0 : parsed;
  }, [amountReceivedInput]);
  const diff = useMemo(() => Math.round((amountReceived - expectedSelectedTotal) * 100) / 100, [amountReceived, expectedSelectedTotal]);

  const depositKindLabel = useMemo(() => {
    const payingDebtOnly = !hasSelectedCod && !hasSelectedHandover && outstandingDebt > 0 && amountReceived > 0;
    if (payingDebtOnly) return 'Bayar utang';
    if (hasSelectedCod && hasSelectedHandover) return 'Uang + Barang';
    if (hasSelectedCod) return 'Uang saja';
    if (hasSelectedHandover) return 'Barang saja';
    return 'Belum dipilih';
  }, [amountReceived, hasSelectedCod, hasSelectedHandover, outstandingDebt]);

  const canSelectInvoice = useCallback((inv: CodInvoiceRow) => {
    if (!inv.requires_retur_handover) return true;
    const handoverId = inv.pending_handover_id;
    if (!handoverId) return false;
    return Boolean(selectedHandoverIds[String(handoverId)]);
  }, [selectedHandoverIds]);

  const handleConfirm = async () => {
    if (!selectedDriver) return;
    setFeedback(null);

    const invoiceIds = selectedInvoiceIdList;
    const handoverIds = selectedHandoverIdList.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
    const hasDebtPayment = invoiceIds.length === 0 && amountReceived > 0 && outstandingDebt > 0;

    if (invoiceIds.length === 0 && handoverIds.length === 0 && !hasDebtPayment) {
      setFeedback({ type: 'error', message: 'Pilih minimal 1 invoice COD atau 1 handover retur.' });
      return;
    }
    if (invoiceIds.length > 0 && amountReceived <= 0) {
      setFeedback({ type: 'error', message: 'Masukkan nominal uang diterima untuk settlement COD.' });
      return;
    }
    if (invoiceIds.length === 0 && amountReceived > 0 && outstandingDebt <= 0) {
      setFeedback({ type: 'error', message: 'Nominal uang sudah diisi, tapi tidak ada invoice COD dipilih dan tidak ada utang driver yang bisa dibayarkan.' });
      return;
    }

    const handoversPayload = handoverIds.map((handoverId) => {
      const handover = selectedDriver.retur_handovers_pending.find((h) => Number(h.handover_id) === Number(handoverId));
      const hk = String(handoverId);
      const draft = handoverQty[hk] || {};
      const items = (handover?.items || []).map((it) => {
        const claimed = Math.max(0, Math.trunc(Number(it.qty || 0)));
        const raw = draft[String(it.retur_id)] ?? String(claimed);
        const received = Math.trunc(Number(raw));
        return { retur_id: String(it.retur_id), qty_received: received };
      });
      for (const it of items) {
        const claimed = Math.max(0, Math.trunc(Number(handover?.items?.find((x) => String(x.retur_id) === String(it.retur_id))?.qty || 0)));
        if (!Number.isFinite(it.qty_received) || it.qty_received < 0 || it.qty_received > claimed) {
          throw new Error('Qty diterima tidak valid. Pastikan 0..qty klaim driver.');
        }
      }
      return {
        handover_id: handoverId,
        note: typeof handoverNotes[hk] === 'string' ? handoverNotes[hk] : undefined,
        items,
      };
    });

    try {
      setSubmitting(true);
      await api.admin.driverDeposit.confirm({
        driver_id: selectedDriver.driver.id,
        cod: invoiceIds.length > 0 ? { invoice_ids: invoiceIds, amount_received: amountReceived } : undefined,
        debt_payment_amount: hasDebtPayment ? amountReceived : undefined,
        handovers: handoversPayload.length > 0 ? handoversPayload : undefined,
      });
      setFeedback({ type: 'success', message: 'Setoran Driver berhasil diproses.' });
      await load({ silent: true });
      setSelectedInvoiceIds({});
      setSelectedHandoverIds({});
      setAmountReceivedInput('');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      const message = String(err?.response?.data?.message || err?.message || 'Gagal memproses setoran driver.');
      setFeedback({ type: 'error', message });
    } finally {
      setSubmitting(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Setoran Driver</h1>
          <p className="text-xs text-slate-500 mt-1">Gabungkan terima uang COD dan terima barang retur (handover) dalam satu halaman.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/riwayat-setoran-driver"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700 hover:bg-slate-50"
          >
            <Receipt size={16} />
            Riwayat
          </Link>
        </div>
      </div>

      {feedback && (
        <div className={`rounded-2xl border p-4 text-sm font-bold ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          {feedback.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-700">
              <Wallet size={18} className="text-amber-700" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-500">Driver</span>
            </div>
            <span className="text-lg font-black text-slate-900">{rows.length}</span>
          </div>

          {loading && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">Memuat daftar driver...</div>
          )}

          {!loading && rows.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
              Tidak ada setoran COD / retur handover yang menunggu.
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((r) => {
                const active = r.driver.id === selectedDriverId;
                return (
                  <button
                    key={r.driver.id}
                    type="button"
                    onClick={() => setSelectedDriverId(r.driver.id)}
                    className={`w-full text-left rounded-2xl border p-4 transition ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-900'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black truncate">{r.driver.name || 'Driver'}</p>
                        <p className={`text-[11px] mt-1 ${active ? 'text-white/70' : 'text-slate-500'}`}>
                          COD: <span className="font-black">{r.totals.cod_invoice_count}</span> · Retur: <span className="font-black">{r.totals.handover_count}</span>
                        </p>
                      </div>
                      <div className={`text-right shrink-0 ${active ? 'text-white/80' : 'text-slate-700'}`}>
                        <p className="text-[10px] font-black uppercase tracking-widest">Debt</p>
                        <p className="text-sm font-black">{new Intl.NumberFormat('id-ID').format(Number(r.driver.debt || 0))}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selectedDriver && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600">
              Pilih driver untuk memproses setoran.
            </div>
          )}

          {selectedDriver && (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Driver</p>
                    <p className="text-lg font-black text-slate-900">{selectedDriver.driver.name}</p>
                    <p className="text-xs text-slate-500 mt-1">{selectedDriver.driver.whatsapp_number || '-'}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Debt Exposure</p>
                    <p className="text-lg font-black text-slate-900 mt-1">{new Intl.NumberFormat('id-ID').format(Number(selectedDriver.driver.debt || 0))}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Snapshot dari perhitungan exposure driver.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Utang Belum Lunas</p>
                    <p className="text-lg font-black text-slate-900 mt-1">{new Intl.NumberFormat('id-ID').format(Number(selectedDriver.balance_adjustments?.total_outstanding || 0))}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Dari selisih shortage COD (open).</p>
                  </div>
                </div>

                {Array.isArray(selectedDriver.balance_adjustments?.entries) && selectedDriver.balance_adjustments!.entries.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Detail Penyesuaian</p>
                    <div className="mt-2 space-y-2">
                      {selectedDriver.balance_adjustments!.entries.slice(0, 5).map((e) => (
                        <div key={e.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-slate-900 truncate">{e.reason}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{e.note || '-'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{e.direction}</p>
                            <p className={`text-xs font-black ${e.direction === 'debt' ? 'text-rose-700' : e.direction === 'credit' ? 'text-emerald-700' : 'text-slate-700'}`}>
                              {new Intl.NumberFormat('id-ID').format(Number(e.amount || 0))}
                            </p>
                          </div>
                        </div>
                      ))}
                      {selectedDriver.balance_adjustments!.entries.length > 5 && (
                        <p className="text-[11px] text-slate-500">+{selectedDriver.balance_adjustments!.entries.length - 5} item lagi (lihat Riwayat untuk lengkap).</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet size={18} className="text-amber-700" />
                    <p className="text-sm font-black text-slate-900">COD Pending</p>
                  </div>
                  <p className="text-xs font-bold text-slate-500">Pilih invoice COD yang akan disettle</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700 flex items-center justify-between gap-3">
                  <span>Setoran kali ini:</span>
                  <span className="font-black">{depositKindLabel}</span>
                </div>

                {selectedDriver.cod_invoices_pending.length === 0 && (
                  <p className="text-sm font-bold text-slate-500">
                    Tidak ada invoice COD pending.
                    {outstandingDebt > 0 ? (
                      <span className="block text-[11px] mt-2 text-slate-500">
                        Driver masih punya utang outstanding <span className="font-black">{new Intl.NumberFormat('id-ID').format(outstandingDebt)}</span>. Isi “Uang Diterima” untuk membayarnya.
                      </span>
                    ) : null}
                  </p>
                )}

                {selectedDriver.cod_invoices_pending.length > 0 && (
                  <div className="space-y-2">
                    {selectedDriver.cod_invoices_pending.map((inv) => {
                      const disabled = !canSelectInvoice(inv);
                      const checked = Boolean(selectedInvoiceIds[String(inv.invoice_id)]);
                      const warning = inv.requires_retur_handover && disabled;
                      const netTotal = Number(inv.net_total || 0);
                      const alreadyReceived = Number(inv.amount_received || 0);
                      const outstanding = Number(inv.expected_total || 0);
                      return (
                        <label key={inv.invoice_id} className={`block rounded-2xl border p-4 ${warning ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setSelectedInvoiceIds((prev) => ({ ...prev, [String(inv.invoice_id)]: next }));
                                  }}
                                />
                                <div className="min-w-0">
                                  <p className="text-sm font-black text-slate-900 truncate">{inv.invoice_number || String(inv.invoice_id).slice(-8).toUpperCase()}</p>
                                  <p className="text-[11px] text-slate-500 mt-1 truncate">
                                    Customer: {(inv.customer_names || []).join(', ') || '-'} · Orders: {(inv.order_ids || []).length}
                                  </p>
                                </div>
                              </div>
                              {warning && (
                                <div className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-700">
                                  <AlertCircle size={14} />
                                  Butuh penerimaan retur handover dulu (centang handover terkait).
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sisa</p>
                              <p className="text-sm font-black text-slate-900">{new Intl.NumberFormat('id-ID').format(outstanding)}</p>
                              {(netTotal > 0 || alreadyReceived > 0) && (
                                <div className="mt-2 space-y-0.5">
                                  <p className="text-[10px] font-bold text-slate-500">Total: <span className="font-black text-slate-700">{new Intl.NumberFormat('id-ID').format(netTotal)}</span></p>
                                  <p className="text-[10px] font-bold text-slate-500">Sudah: <span className="font-black text-slate-700">{new Intl.NumberFormat('id-ID').format(alreadyReceived)}</span></p>
                                </div>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Uang Diterima</label>
                    <input
                      value={amountReceivedInput}
                      onChange={(e) => {
                        setAmountReceivedInput(sanitizeAmountInput(e.target.value));
                      }}
                      onBlur={() => {
                        const parsed = parseMoneyInput(amountReceivedInput);
                        setAmountReceivedInput(parsed && parsed > 0 ? formatMoneyId(parsed, { maximumFractionDigits: 2 }) : '');
                      }}
                      placeholder="Contoh: 260.750,56"
                      className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900"
                      inputMode="decimal"
                    />
                    {hasSelectedCod ? (
                      <p className="text-[11px] text-slate-500 mt-2">Selisih akan dicatat sebagai utang/piutang driver.</p>
                    ) : outstandingDebt > 0 ? (
                      <p className="text-[11px] text-slate-500 mt-2">Tidak ada invoice COD dipilih. Nominal ini akan dipakai untuk membayar utang driver (outstanding: <span className="font-black">{new Intl.NumberFormat('id-ID').format(outstandingDebt)}</span>).</p>
                    ) : (
                      <p className="text-[11px] text-slate-500 mt-2">Jika ada penerimaan uang, centang invoice COD dulu. Jika setoran hanya barang retur, nominal uang bisa dikosongkan.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ringkasan</p>
                    {hasSelectedCod ? (
                      <>
                        <p className="text-xs font-bold text-slate-700 mt-2">Expected: <span className="font-black">{new Intl.NumberFormat('id-ID').format(expectedSelectedTotal)}</span></p>
                        <p className="text-xs font-bold text-slate-700">Received: <span className="font-black">{new Intl.NumberFormat('id-ID').format(amountReceived)}</span></p>
                        <p className={`text-xs font-bold ${diff === 0 ? 'text-slate-700' : (diff < 0 ? 'text-rose-700' : 'text-emerald-700')}`}>
                          Diff: <span className="font-black">{new Intl.NumberFormat('id-ID').format(diff)}</span>
                        </p>
                      </>
                    ) : outstandingDebt > 0 ? (
                      <>
                        <p className="text-xs font-bold text-slate-700 mt-2">Outstanding debt: <span className="font-black">{new Intl.NumberFormat('id-ID').format(outstandingDebt)}</span></p>
                        <p className="text-xs font-bold text-slate-700">Paying: <span className="font-black">{new Intl.NumberFormat('id-ID').format(amountReceived)}</span></p>
                        <p className="text-xs font-bold text-slate-700">Remaining: <span className="font-black">{new Intl.NumberFormat('id-ID').format(Math.max(0, Math.round((outstandingDebt - amountReceived) * 100) / 100))}</span></p>
                      </>
                    ) : (
                      <p className="text-xs font-bold text-slate-600 mt-2">Tidak ada settlement uang pada setoran ini.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PackageCheck size={18} className="text-violet-700" />
                    <p className="text-sm font-black text-slate-900">Retur Handover</p>
                  </div>
                  <p className="text-xs font-bold text-slate-500">Terima barang retur dari driver (auto completed & masuk stok)</p>
                </div>

                {selectedDriver.retur_handovers_pending.length === 0 && (
                  <p className="text-sm font-bold text-slate-500">Tidak ada handover retur pending.</p>
                )}

                {selectedDriver.retur_handovers_pending.length > 0 && (
                  <div className="space-y-2">
                    {selectedDriver.retur_handovers_pending.map((handover) => {
                      const hk = String(handover.handover_id);
                      const checked = Boolean(selectedHandoverIds[hk]);
                      return (
                        <div key={handover.handover_id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <label className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => setSelectedHandoverIds((prev) => ({ ...prev, [hk]: e.target.checked }))}
                                />
                                <div className="min-w-0">
                                  <p className="text-sm font-black text-slate-900 truncate">Handover #{handover.handover_id}</p>
                                  <p className="text-[11px] text-slate-500 mt-1 truncate">Invoice: {String(handover.invoice_id || '').slice(-8).toUpperCase()} · Items: {handover.items.length}</p>
                                </div>
                              </label>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</p>
                              <p className="text-xs font-black text-slate-900">{handover.status}</p>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                            {handover.items.map((it) => {
                              const claimed = Math.max(0, Math.trunc(Number(it.qty || 0)));
                              const current = handoverQty[hk]?.[String(it.retur_id)] ?? String(claimed);
                              return (
                                <div key={it.retur_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-black text-slate-900 truncate">{it.product?.name || 'Produk'}</p>
                                    <p className="text-[10px] text-slate-500 truncate">SKU: {it.product?.sku || '-'} · Retur: {String(it.retur_id).slice(-8).toUpperCase()}</p>
                                    <p className="text-[10px] text-slate-500">Qty klaim: <span className="font-black">{claimed}</span> {it.product?.unit || ''}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty Diterima</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max={claimed}
                                      value={current}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setHandoverQty((prev) => ({
                                          ...prev,
                                          [hk]: { ...(prev[hk] || {}), [String(it.retur_id)]: val }
                                        }));
                                      }}
                                      className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 text-right"
                                      disabled={!checked}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Catatan</label>
                            <input
                              value={handoverNotes[hk] ?? ''}
                              onChange={(e) => setHandoverNotes((prev) => ({ ...prev, [hk]: e.target.value }))}
                              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900"
                              placeholder="Opsional"
                              disabled={!checked}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting || (!selectedDriver)}
                className="w-full rounded-[28px] bg-slate-900 text-white px-5 py-4 font-black text-sm hover:bg-black disabled:opacity-60 disabled:hover:bg-slate-900 flex items-center justify-center gap-2"
              >
                {submitting ? 'Memproses...' : (
                  <>
                    <CheckCircle size={18} />
                    Konfirmasi Setoran Driver
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
