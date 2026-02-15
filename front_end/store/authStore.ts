import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const WEB_CHAT_SESSION_KEY = 'web_chat_session_id';
const WEB_CHAT_GUEST_KEY = 'web_chat_guest_id';

interface User {
    id: string;
    name: string;
    email?: string | null;
    role: string;
    whatsapp_number?: string;
    phone?: string;
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    login: (token: string, user: User) => void;
    logout: () => void;
    updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            login: (token, user) => {
                if (typeof window !== 'undefined') {
                    localStorage.setItem('token', token);
                }
                set({ token, user, isAuthenticated: true });
            },
            logout: () => {
                if (typeof window !== 'undefined') {
                    localStorage.removeItem('token');
                    localStorage.removeItem(WEB_CHAT_SESSION_KEY);
                    localStorage.removeItem(WEB_CHAT_GUEST_KEY);
                    window.dispatchEvent(new CustomEvent('webchat:close'));
                }
                set({ token: null, user: null, isAuthenticated: false });
            },
            updateUser: (user) => {
                set({ user });
            },
        }),
        {
            name: 'auth-storage',
            skipHydration: true, // Fix hydration mismatch
        }
    )
);
