import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartItem {
    id: string;
    productId: string;
    productName: string;
    price: number;
    quantity: number;
    imageUrl?: string;
}

interface CartState {
    items: CartItem[];
    totalItems: number;
    totalPrice: number;
    setCart: (items: CartItem[]) => void;
    addItem: (item: CartItem) => void;
    updateItem: (id: string, quantity: number) => void;
    removeItem: (id: string) => void;
    clearCart: () => void;
    getTotalItems: () => number;
    getTotalPrice: () => number;
}

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],
            totalItems: 0,
            totalPrice: 0,

            setCart: (items) => {
                const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
                const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
                set({ items, totalItems, totalPrice });
            },

            addItem: (item) => {
                const items = [...get().items];
                const existingIndex = items.findIndex((i) => i.productId === item.productId);

                if (existingIndex >= 0) {
                    items[existingIndex].quantity += item.quantity;
                } else {
                    items.push(item);
                }

                get().setCart(items);
            },

            updateItem: (id, quantity) => {
                const items = get().items.map((item) =>
                    item.id === id ? { ...item, quantity } : item
                );
                get().setCart(items);
            },

            removeItem: (id) => {
                const items = get().items.filter((item) => item.id !== id);
                get().setCart(items);
            },

            clearCart: () => {
                set({ items: [], totalItems: 0, totalPrice: 0 });
            },

            getTotalItems: () => get().totalItems,
            getTotalPrice: () => get().totalPrice,
        }),
        {
            name: 'cart-storage',
            storage: {
                getItem: (name) => {
                    const str = sessionStorage.getItem(name);
                    return str ? JSON.parse(str) : null;
                },
                setItem: (name, value) => {
                    sessionStorage.setItem(name, JSON.stringify(value));
                },
                removeItem: (name) => sessionStorage.removeItem(name),
            },
            skipHydration: true, // Fix hydration mismatch
        }
    )
);
