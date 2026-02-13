# Migunani Motor - Frontend

> **Mobile-First** Next.js 14 frontend application untuk sistem Migunani Motor

## 🚀 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 (Mobile-First)
- **State Management**: Zustand
- **Data Fetching**: Axios + TanStack Query
- **Real-time**: Socket.io Client
- **Form Handling**: React Hook Form + Zod

## 📱 Mobile-First Features

### Design Principles
- ✅ **Touch-optimized UI**: Minimum 44px touch targets
- ✅ **Bottom Navigation**: Thumb-friendly navigation di bagian bawah layar
- ✅ **Progressive Enhancement**: Didesain untuk mobile, enhanced untuk desktop
- ✅ **Responsive Grid**: 1 column (mobile) → 2 (tablet) → 3-4 (desktop)

### Performance Optimizations
- ⚡ Lazy-loaded images dengan Next.js Image
- ⚡ Turbopack untuk fast refresh
- ⚡ CSS variables untuk theming
- ⚡ Touch-action optimization

## 🏗️ Project Structure

```
front_end/
├── app/                      # Next.js App Router
│   ├── layout.tsx           # Root layout dengan Header, Footer, BottomNav
│   ├── page.tsx             # Homepage
│   ├── auth/                # Authentication pages
│   │   ├── login/
│   │   └── register/
│   ├── catalog/             # Product catalog
│   ├── cart/                # Shopping cart
│   ├── checkout/            # Checkout flow
│   ├── orders/              # Order history & tracking
│   └── admin/               # Admin dashboard
│       ├── inventory/
│       ├── orders/
│       ├── finance/
│       ├── pos/
│       └── chat/
├── components/
│   ├── ui/                  # Reusable UI components
│   │   ├── Button.tsx       # Touch-friendly buttons
│   │   └── Card.tsx         # Card components
│   ├── layout/              # Layout components
│   │   ├── Header.tsx       # Sticky header dengan mobile menu
│   │   ├── Footer.tsx       # Footer
│   │   └── BottomNav.tsx    # Mobile-only bottom navigation
│   └── product/             # Product-related components
│       ├── ProductCard.tsx  # Product card
│       └── ProductGrid.tsx  # Responsive grid
├── lib/
│   ├── api.ts               # Axios client + API methods
│   ├── socket.ts            # Socket.io client
│   └── utils.ts             # Utility functions
└── store/
    ├── authStore.ts         # Auth state
    └── cartStore.ts         # Cart state
```

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+ 
- npm/yarn/pnpm
- Backend server running on http://localhost:5000

### Installation

```bash
cd front_end
npm install
```

### Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_WS_URL=http://localhost:5000
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) di browser Anda.

### Build for Production

```bash
npm run build
npm start
```

## 📋 Available Pages

### Public Pages
- `/` - Homepage dengan featured products
- `/catalog` - Product catalog dengan search & filter
- `/catalog/[id]` - Product detail page
- `/auth/login` - Login page
- `/auth/register` - Registration page

### Customer Pages (Requires Auth)
- `/cart` - Shopping cart
- `/checkout` - Checkout flow
- `/orders` - Order history
- `/orders/[id]` - Order detail & tracking
- `/profile` - User profile

### Admin Pages (Requires Admin Role)
- `/admin` - Dashboard
- `/admin/inventory` - Inventory management
- `/admin/orders` - Order management
- `/admin/finance` - Finance & reporting
- `/admin/pos` - POS system
- `/admin/chat` - WhatsApp chat management

## 🎨 Design System

### Colors (CSS Variables)
```css
--brand-primary: #1e40af;      /* Blue */
--brand-secondary: #f59e0b;    /* Amber */
--brand-accent: #10b981;       /* Green */
```

### Touch Targets
- Minimum: 44px × 44px
- Large: 56px × 56px

### Breakpoints
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

## 🔌 API Integration

Backend API endpoints sudah dikonfigurasi di `lib/api.ts`:

```typescript
import { api } from '@/lib/api';

// Example: Get products
const products = await api.catalog.getProducts();

// Example: Add to cart
await api.cart.addToCart({ productId: '123', quantity: 1 });
```

## 🔄 State Management

### Auth Store (Zustand)
```typescript
import { useAuthStore } from '@/store/authStore';

const { user, isAuthenticated, login, logout } = useAuthStore();
```

### Cart Store (Zustand)
```typescript
import { useCartStore } from '@/store/cartStore';

const { items, totalItems, addItem, removeItem } = useCartStore();
```

## 🎯 Next Steps

⬜ Implement remaining pages (cart, checkout, admin)
⬜ Add swipeable components for mobile gestures
⬜ Implement WhatsApp chat widget
⬜ Add image upload for payment proofs
⬜ PWA configuration (manifest.json, service worker)
⬜ Add loading states & skeletons
⬜ Implement error boundaries
⬜ Add unit tests

## 📱 Mobile Testing

### Browser DevTools
1. Open Chrome DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Select mobile device preset atau custom resolution

### Testing Checklist
- ✅ Bottom navigation visible di mobile
- ✅ Touch targets minimal 44px
- ✅ Responsive grid (1 → 2 → 3-4 columns)
- ✅ Forms dengan input besar untuk mobile
- ✅ Sticky headers & search bars

## 🤝 Contributing

Pastikan mengikuti mobile-first approach:
1. Design untuk mobile first
2. Test di mobile breakpoint
3. Enhance untuk tablet/desktop
4. Gunakan touch-friendly components

## 📄 License

© 2026 Migunani Motor. All rights reserved.
