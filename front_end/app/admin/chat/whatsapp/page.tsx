"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw, LogOut, CheckCircle, AlertCircle, Loader2, Link2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import AdminChatTabs from '@/components/chat/AdminChatTabs';

const getPersistApi = () => (useAuthStore as any).persist;

export default function WhatsappConfigPage() {
  const { user, isAuthenticated } = useAuthStore();
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = getPersistApi();
    return persistApi?.hasHydrated?.() ?? false;
  });
  const canManageWhatsapp = !!user && ['super_admin', 'kasir'].includes(user.role);
  const [status, setStatus] = useState<string>('STOPPED');
  const [qr, setQr] = useState<string | null>(null);
  const [waMeta, setWaMeta] = useState<{
    initializing_for_ms?: number;
    last_error?: string | null;
    reconnect_in_ms?: number;
    auto_reconnect_enabled?: boolean;
    last_disconnect_reason?: string | null;
  }>({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const persistApi = getPersistApi();
    if (!persistApi) {
      setHydrated(true);
      return;
    }

    const unsub = persistApi.onFinishHydration?.(() => setHydrated(true));
    setHydrated(persistApi.hasHydrated?.() ?? true);

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }

    if (user && !['super_admin', 'kasir'].includes(user.role)) {
      router.push('/');
      return;
    }

    fetchStatus();

    const socket = getSocket();
    socket.on('wa:qr', (newQr: string) => {
      setQr(newQr);
      setStatus('SCAN_NEEDED');
    });
    socket.on('wa:ready', () => {
      setStatus('READY');
      setQr(null);
    });
    socket.on('wa:status', (newStatus: string) => {
      setStatus(newStatus);
      if (newStatus === 'DISCONNECTED' || newStatus === 'AUTH_FAILURE' || newStatus === 'ERROR') {
        setQr(null);
      }
    });

    return () => {
      socket.off('wa:qr');
      socket.off('wa:ready');
      socket.off('wa:status');
    };
  }, [hydrated, isAuthenticated, user, router]);

  const fetchStatus = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.whatsapp.getStatus();
      const currentStatus = res.data?.status || 'STOPPED';
      setStatus(currentStatus);
      setWaMeta(res.data?.meta || {});

      const qrRes = await api.whatsapp.getQr();
      const qrCode = typeof qrRes.data?.qr === 'string' ? qrRes.data.qr : null;
      setWaMeta(qrRes.data?.meta || res.data?.meta || {});

      if (qrCode) {
        setQr(qrCode);
        setStatus('SCAN_NEEDED');
      } else if (currentStatus === 'READY') {
        setQr(null);
      }
    } catch (error) {
      console.error('Error fetching WA status:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'READY') return;
    const timer = setInterval(() => fetchStatus(true), 3500);
    return () => clearInterval(timer);
  }, [status]);

  const handleLogout = async () => {
    if (!confirm('Apakah Anda yakin ingin logout dari WhatsApp?')) return;
    try {
      await api.whatsapp.logout();
      await fetchStatus();
    } catch (error) {
      console.error('Error logging out WA:', error);
    }
  };

  const handleConnect = async (force = false) => {
    try {
      setConnecting(true);
      setQr(null);
      const res = await api.whatsapp.connect(force);
      if (res.data?.status) setStatus(res.data.status);
      await fetchStatus();
    } catch (error) {
      console.error('Error connecting WhatsApp:', error);
    } finally {
      setConnecting(false);
    }
  };

  if (!hydrated || !isAuthenticated) return null;

  const reconnectSeconds = Math.ceil((waMeta.reconnect_in_ms || 0) / 1000);

  return (
    <div className="container mx-auto p-4 max-w-5xl py-10 min-h-[80vh] space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 leading-tight">Konfigurasi WhatsApp</h1>
        <p className="text-gray-500 mt-1">Halaman ini khusus untuk mengelola koneksi WhatsApp.</p>
      </div>

      <AdminChatTabs />

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm text-blue-900">
          Kanal WhatsApp dikelola oleh <b>Super Admin</b> dan <b>Admin Pemasaran</b> (role kasir). Role operasional lain hanya memakai chat aplikasi.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Card className="shadow-xl border-none bg-gradient-to-br from-white to-gray-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              Connection Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-6">
              {status === 'READY' ? (
                <div className="relative mb-4">
                  <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-20"></div>
                  <div className="relative bg-green-100 p-4 rounded-full">
                    <CheckCircle className="text-green-600 h-12 w-12" />
                  </div>
                </div>
              ) : ['INITIALIZING', 'AUTHENTICATED', 'QR_RECEIVED'].includes(status) ? (
                <div className="bg-blue-100 p-4 rounded-full mb-4">
                  <Loader2 className="text-blue-600 h-12 w-12 animate-spin" />
                </div>
              ) : (
                <div className="bg-amber-100 p-4 rounded-full mb-4">
                  <AlertCircle className="text-amber-600 h-12 w-12" />
                </div>
              )}

              <h2 className="text-2xl font-black text-gray-800 uppercase tracking-tight">
                {status.replace(/_/g, ' ')}
              </h2>
              {status !== 'READY' && (
                <div className="mt-2 text-center space-y-1">
                  <p className="text-xs text-slate-500">
                    {waMeta.last_error
                      ? `Error: ${waMeta.last_error}`
                      : `Initializing: ${Math.round((waMeta.initializing_for_ms || 0) / 1000)} detik`}
                  </p>
                  {waMeta.auto_reconnect_enabled && reconnectSeconds > 0 && ['DISCONNECTED', 'AUTH_FAILURE', 'ERROR'].includes(status) && (
                    <p className="text-[11px] text-emerald-700 font-semibold">
                      Auto reconnect dalam {reconnectSeconds} detik...
                    </p>
                  )}
                  {status === 'DISCONNECTED' && waMeta.last_disconnect_reason && (
                    <p className="text-[11px] text-slate-500">
                      Reason: {waMeta.last_disconnect_reason}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-8 w-full space-y-2">
                {canManageWhatsapp && (
                  <>
                    {status !== 'READY' && (
                      <>
                        <Button
                          onClick={() => handleConnect(false)}
                          className="w-full flex items-center justify-center gap-2 rounded-xl"
                          disabled={connecting || loading}
                        >
                          <Link2 className={`h-4 w-4 ${connecting ? 'animate-pulse' : ''}`} />
                          {connecting ? 'Connecting...' : 'Connect WhatsApp'}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleConnect(true)}
                          className="w-full"
                          disabled={connecting || loading}
                        >
                          Reset & Connect
                        </Button>
                      </>
                    )}
                    {status === 'READY' && (
                      <Button
                        variant="destructive"
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-2 rounded-xl"
                      >
                        <LogOut className="h-4 w-4" />
                        Putuskan Koneksi
                      </Button>
                    )}
                  </>
                )}
                <Button
                  variant="ghost"
                  onClick={() => fetchStatus(false)}
                  className="w-full flex items-center justify-center gap-2"
                  disabled={loading}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh Status
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {qr && status !== 'READY' ? (
          <Card className="shadow-xl border border-primary/20 bg-white overflow-hidden">
            <div className="bg-primary/5 py-3 px-6 border-b border-primary/10">
              <p className="text-xs font-bold text-primary uppercase tracking-widest">Scan QR</p>
            </div>
            <CardContent className="p-8">
              <div className="flex flex-col items-center gap-6">
                <div className="bg-white p-6 rounded-2xl shadow border border-slate-200">
                  <QRCodeSVG value={qr} size={220} />
                </div>
                <p className="text-sm text-slate-600 text-center">
                  Buka WhatsApp di HP, pilih <b>Linked Devices</b>, lalu scan QR ini.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-xl border border-slate-200 bg-white">
            <CardContent className="py-16 px-8 text-center space-y-3">
              <p className="text-lg font-black text-slate-900">QR Code Belum Tersedia</p>
              <p className="text-sm text-slate-600">
                Klik Connect WhatsApp untuk memulai service dan menampilkan QR.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
